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
import type { MediaSnapshot } from "@/types/library";

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
  index: EpisodeIndex
) {
  const rows = await fetchAllRows<WatchRow>((from, to) =>
    supabase
      .from("episode_watches")
      .select("id, season_number, episode_number, runtime_minutes, watched_at")
      .eq("user_id", userId)
      .eq("tmdb_show_id", showTmdbId)
      .order("id")
      .range(from, to)
  );

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
  if (staleIds.length === 0) return;

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
  const seasons = (
    await Promise.all(
      show.seasons
        .filter((s) => s.season_number > 0 && s.episode_count > 0)
        .map((s) => getSeason(input.showTmdbId, s.season_number).catch(() => null))
    )
  ).filter((s) => s !== null);
  const index = buildEpisodeIndex(seasons);

  await reconcileEpisodeNumbering(supabase, user.id, input.showTmdbId, index);

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

  const rows = upTo
    .filter((ep) => isAired(ep.air_date))
    .map((ep) => ({
      user_id: user.id,
      tmdb_show_id: input.showTmdbId,
      season_number: ep.season_number,
      episode_number: ep.episode_number,
      runtime_minutes: ep.runtime,
    }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from("episode_watches")
      .upsert(rows.slice(i, i + 500), {
        onConflict: "user_id,tmdb_show_id,season_number,episode_number",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
  }

  await syncShowLibraryItem(supabase, user.id, input.showTmdbId, input.snapshot);
  revalidatePath("/", "layout");
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
