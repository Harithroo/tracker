"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSeason, getShow } from "@/lib/tmdb/client";
import {
  buildEpisodeIndex,
  mapToTmdbEpisode,
  type EpisodeIndex,
} from "@/lib/tmdb/episode-map";
import { isAired } from "@/lib/utils";
import { airedEpisodeCount, episodeKey, isShowEnded, nextAiredEpisode } from "@/lib/progress";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type {
  LibraryItem,
  MediaSnapshot,
  RepairResult,
  RepairTarget,
} from "@/types/library";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Marking an episode auto-adds the show to the library as "watching", and
 * keeps status/total_episodes in sync. A show flips to "completed" only when
 * it has ended and every aired regular episode (specials excluded) is watched;
 * un-watching an aired episode after completion goes back to "watching".
 */
async function syncShowLibraryItem(
  supabase: SupabaseClient,
  userId: string,
  showTmdbId: number,
  snapshot: MediaSnapshot
) {
  const { data: item, error: itemError } = await supabase
    .from("library_items")
    .select("id, status, started_at, finished_at, total_episodes")
    .eq("user_id", userId)
    .eq("tmdb_id", showTmdbId)
    .eq("media_type", "tv")
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);

  const epRows = await fetchAllRows<{ season_number: number; episode_number: number }>(
    (from, to) =>
      supabase
        .from("episode_watches")
        .select("season_number, episode_number")
        .eq("user_id", userId)
        .eq("tmdb_show_id", showTmdbId)
        .order("id")
        .range(from, to)
  );
  const watched = epRows.length;
  const watchedSet = new Set(
    epRows.map((row) => episodeKey(row.season_number, row.episode_number))
  );

  // "Complete" means an ended show with every aired regular episode watched;
  // "caught up" (all aired watched, show still running) never demotes status.
  let isComplete = false;
  let caughtUp = false;
  try {
    const show = await getShow(showTmdbId);
    caughtUp =
      airedEpisodeCount(show.seasons, show.last_episode_to_air) > 0 &&
      nextAiredEpisode(show.seasons, show.last_episode_to_air, watchedSet) === null;
    isComplete = caughtUp && isShowEnded(show.status);
  } catch {
    // TMDB unavailable — fall back to the snapshot's episode total
    const total = snapshot.totalEpisodes;
    isComplete = total !== null && total > 0 && watched >= total;
    caughtUp = isComplete;
  }

  if (!item) {
    const { error } = await supabase.from("library_items").insert({
      user_id: userId,
      tmdb_id: showTmdbId,
      media_type: "tv",
      status: isComplete ? "completed" : "watching",
      started_at: today(),
      finished_at: isComplete ? today() : null,
      title: snapshot.title,
      poster_path: snapshot.posterPath,
      release_year: snapshot.releaseYear,
      runtime_minutes: snapshot.runtimeMinutes,
      genre_ids: snapshot.genreIds,
      total_episodes: snapshot.totalEpisodes,
    });
    if (error) throw new Error(error.message);
    return;
  }

  const update: Record<string, unknown> = {};
  if (item.total_episodes !== snapshot.totalEpisodes) {
    update.total_episodes = snapshot.totalEpisodes;
  }

  if (isComplete && item.status !== "completed") {
    update.status = "completed";
    if (!item.finished_at) update.finished_at = today();
  } else if (!caughtUp && watched > 0 && ["completed", "plan_to_watch"].includes(item.status)) {
    update.status = "watching";
    if (!item.started_at) update.started_at = today();
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase
      .from("library_items")
      .update(update)
      .eq("id", item.id);
    if (error) throw new Error(error.message);
  }
}

export async function setEpisodeWatched(input: {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  runtimeMinutes: number | null;
  watched: boolean;
  snapshot: MediaSnapshot;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  if (input.watched) {
    const { error } = await supabase.from("episode_watches").upsert(
      {
        user_id: user.id,
        tmdb_show_id: input.showTmdbId,
        season_number: input.seasonNumber,
        episode_number: input.episodeNumber,
        runtime_minutes: input.runtimeMinutes,
      },
      {
        onConflict: "user_id,tmdb_show_id,season_number,episode_number",
        ignoreDuplicates: true,
      }
    );
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("episode_watches")
      .delete()
      .eq("user_id", user.id)
      .eq("tmdb_show_id", input.showTmdbId)
      .eq("season_number", input.seasonNumber)
      .eq("episode_number", input.episodeNumber);
    if (error) throw new Error(error.message);
  }

  await syncShowLibraryItem(supabase, user.id, input.showTmdbId, input.snapshot);
  revalidatePath("/", "layout");
}

interface WatchRow {
  id: string;
  season_number: number;
  episode_number: number;
  runtime_minutes: number | null;
  watched_at: string;
}

/**
 * Rewrites the show's watch history into TMDB's current numbering.
 *
 * Imported histories carry their source's numbering, and TMDB re-splits seasons
 * over time, so rows can end up pointing at episodes that no longer exist. Those
 * rows are invisible in the episode list but still count towards progress, which
 * is how a finished show keeps claiming an early episode is up next. Rows that
 * can be translated are moved; rows matching no TMDB episode are dropped, since
 * there is nothing they could refer to. Specials are left alone — they don't
 * count towards progress and have no ordering to map through.
 */
async function reconcileEpisodeNumbering(
  supabase: SupabaseClient,
  userId: string,
  showTmdbId: number,
  rows: WatchRow[],
  index: EpisodeIndex
): Promise<{ moved: number; dropped: number }> {
  const staleIds: string[] = [];
  // Several stale rows can translate to the same episode; keep the earliest.
  const moved = new Map<string, { season: number; episode: number; row: WatchRow; runtime: number | null }>();
  for (const row of rows) {
    if (row.season_number <= 0) continue;
    const key = episodeKey(row.season_number, row.episode_number);
    if (index.byKey.has(key)) continue;

    staleIds.push(row.id);
    const match = mapToTmdbEpisode(index, row.season_number, row.episode_number);
    if (!match) continue;
    const target = episodeKey(match.season_number, match.episode_number);
    const existing = moved.get(target);
    if (!existing || row.watched_at < existing.row.watched_at) {
      moved.set(target, {
        season: match.season_number,
        episode: match.episode_number,
        row,
        runtime: match.runtime ?? row.runtime_minutes,
      });
    }
  }
  if (staleIds.length === 0) return { moved: 0, dropped: 0 };

  // Write the translated rows before dropping the originals, so a failure
  // partway through leaves the history intact rather than short.
  if (moved.size > 0) {
    const inserts = [...moved.values()].map((m) => ({
      user_id: userId,
      tmdb_show_id: showTmdbId,
      season_number: m.season,
      episode_number: m.episode,
      runtime_minutes: m.runtime,
      watched_at: m.row.watched_at,
    }));
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await supabase
        .from("episode_watches")
        .upsert(inserts.slice(i, i + 500), {
          onConflict: "user_id,tmdb_show_id,season_number,episode_number",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(error.message);
    }
  }

  for (let i = 0; i < staleIds.length; i += 500) {
    const { error } = await supabase
      .from("episode_watches")
      .delete()
      .eq("user_id", userId)
      .in("id", staleIds.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  return { moved: moved.size, dropped: staleIds.length - moved.size };
}

function loadWatchRows(supabase: SupabaseClient, userId: string, showTmdbId: number) {
  return fetchAllRows<WatchRow>((from, to) =>
    supabase
      .from("episode_watches")
      .select("id, season_number, episode_number, runtime_minutes, watched_at")
      .eq("user_id", userId)
      .eq("tmdb_show_id", showTmdbId)
      .order("id")
      .range(from, to)
  );
}

async function fetchSeasons(showTmdbId: number, seasonNumbers: number[]) {
  const seasons = await Promise.all(
    seasonNumbers.map((n) => getSeason(showTmdbId, n).catch(() => null))
  );
  return seasons.filter((s) => s !== null);
}

/**
 * Marks everything up to (and including) the given episode as watched, in air
 * order across seasons. The show's existing history is realigned to TMDB's
 * numbering first — otherwise this would stack a second, differently numbered
 * copy of the same episodes on top of an imported one.
 */
export async function setWatchedUpTo(input: {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  snapshot: MediaSnapshot;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const show = await getShow(input.showTmdbId);
  const index = buildEpisodeIndex(
    await fetchSeasons(
      input.showTmdbId,
      show.seasons.filter((s) => s.season_number > 0 && s.episode_count > 0).map((s) => s.season_number)
    )
  );

  const rows = await loadWatchRows(supabase, user.id, input.showTmdbId);
  await reconcileEpisodeNumbering(supabase, user.id, input.showTmdbId, rows, index);

  const targetIndex = index.order.findIndex(
    (ep) =>
      ep.season_number === input.seasonNumber && ep.episode_number === input.episodeNumber
  );
  const upTo =
    targetIndex >= 0
      ? index.order.slice(0, targetIndex + 1)
      : // Target missing from the index (a season TMDB wouldn't serve): fall back
        // to comparing numbers so the action still does something useful.
        index.order.filter(
          (ep) =>
            ep.season_number < input.seasonNumber ||
            (ep.season_number === input.seasonNumber &&
              ep.episode_number <= input.episodeNumber)
        );

  const inserts = upTo
    .filter((ep) => isAired(ep.air_date))
    .map((ep) => ({
      user_id: user.id,
      tmdb_show_id: input.showTmdbId,
      season_number: ep.season_number,
      episode_number: ep.episode_number,
      runtime_minutes: ep.runtime,
    }));

  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase
      .from("episode_watches")
      .upsert(inserts.slice(i, i + 500), {
        onConflict: "user_id,tmdb_show_id,season_number,episode_number",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
  }

  await syncShowLibraryItem(supabase, user.id, input.showTmdbId, input.snapshot);
  revalidatePath("/", "layout");
}

/** Every show in the library, oldest first — the work list for a repair run. */
export async function listShowsToRepair(): Promise<RepairTarget[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const items = await fetchAllRows<{ tmdb_id: number; title: string }>((from, to) =>
    supabase
      .from("library_items")
      .select("tmdb_id, title, id")
      .eq("user_id", user.id)
      .eq("media_type", "tv")
      .order("id")
      .range(from, to)
  );
  return items.map((item) => ({ tmdbId: item.tmdb_id, title: item.title }));
}

/**
 * Realigns one show's watch history to TMDB's numbering, pulling only as much
 * of the show as it takes to tell: the seasons the history touches are enough
 * to prove the numbering already matches, which is the answer for most shows.
 */
async function repairShow(
  supabase: SupabaseClient,
  userId: string,
  item: LibraryItem
): Promise<RepairResult> {
  const base: RepairResult = { tmdbId: item.tmdb_id, title: item.title, moved: 0, dropped: 0 };
  const rows = await loadWatchRows(supabase, userId, item.tmdb_id);
  if (rows.length === 0) return base;

  const show = await getShow(item.tmdb_id);
  const touched = [...new Set(rows.map((row) => row.season_number))];
  let seasons = await fetchSeasons(item.tmdb_id, touched);
  let index = buildEpisodeIndex(seasons);

  // Specials are never renumbered, so an odd one shouldn't drag in the rest of
  // the show on every run.
  const aligned = rows.every(
    (row) =>
      row.season_number <= 0 ||
      index.byKey.has(episodeKey(row.season_number, row.episode_number))
  );
  if (aligned) return base;

  const rest = show.seasons
    .filter((s) => s.episode_count > 0 && !touched.includes(s.season_number))
    .map((s) => s.season_number);
  if (rest.length > 0) {
    seasons = [...seasons, ...(await fetchSeasons(item.tmdb_id, rest))];
    index = buildEpisodeIndex(seasons);
  }

  const { moved, dropped } = await reconcileEpisodeNumbering(
    supabase,
    userId,
    item.tmdb_id,
    rows,
    index
  );
  if (moved > 0 || dropped > 0) {
    await syncShowLibraryItem(supabase, userId, item.tmdb_id, {
      title: item.title,
      posterPath: item.poster_path,
      releaseYear: item.release_year,
      runtimeMinutes: item.runtime_minutes,
      genreIds: item.genre_ids,
      totalEpisodes: item.total_episodes,
    });
  }
  return { ...base, moved, dropped };
}

/**
 * Repairs a batch of shows. Batching is the caller's job: a whole library can
 * mean hundreds of TMDB requests, well past what one request should carry.
 */
export async function repairShowNumbering(tmdbIds: number[]): Promise<RepairResult[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  if (tmdbIds.length === 0 || tmdbIds.length > 10) {
    throw new Error("Repair takes 1–10 shows at a time");
  }

  const { data, error } = await supabase
    .from("library_items")
    .select("*")
    .eq("user_id", user.id)
    .eq("media_type", "tv")
    .in("tmdb_id", tmdbIds);
  if (error) throw new Error(error.message);

  const results: RepairResult[] = [];
  for (const item of (data ?? []) as LibraryItem[]) {
    try {
      results.push(await repairShow(supabase, user.id, item));
    } catch (err) {
      results.push({
        tmdbId: item.tmdb_id,
        title: item.title,
        moved: 0,
        dropped: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  if (results.some((r) => r.moved > 0 || r.dropped > 0)) revalidatePath("/", "layout");
  return results;
}

export async function setSeasonWatched(input: {
  showTmdbId: number;
  seasonNumber: number;
  episodes: { episodeNumber: number; runtimeMinutes: number | null }[];
  watched: boolean;
  snapshot: MediaSnapshot;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  if (input.watched) {
    const rows = input.episodes.map((ep) => ({
      user_id: user.id,
      tmdb_show_id: input.showTmdbId,
      season_number: input.seasonNumber,
      episode_number: ep.episodeNumber,
      runtime_minutes: ep.runtimeMinutes,
    }));
    const { error } = await supabase.from("episode_watches").upsert(rows, {
      onConflict: "user_id,tmdb_show_id,season_number,episode_number",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("episode_watches")
      .delete()
      .eq("user_id", user.id)
      .eq("tmdb_show_id", input.showTmdbId)
      .eq("season_number", input.seasonNumber);
    if (error) throw new Error(error.message);
  }

  await syncShowLibraryItem(supabase, user.id, input.showTmdbId, input.snapshot);
  revalidatePath("/", "layout");
}
