"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSeason, getShow } from "@/lib/tmdb/client";
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

/**
 * Marks everything up to (and including) the given episode as watched — all
 * aired regular episodes of earlier seasons plus episodes 1..N of the target
 * season. Handy for logging old shows that are partway through.
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
  const seasonNumbers = show.seasons
    .filter((s) => s.season_number > 0 && s.season_number <= input.seasonNumber)
    .map((s) => s.season_number);

  const seasons = await Promise.all(
    seasonNumbers.map((n) => getSeason(input.showTmdbId, n))
  );

  const rows = seasons.flatMap((season) =>
    season.episodes
      .filter(
        (ep) =>
          isAired(ep.air_date) &&
          (season.season_number < input.seasonNumber ||
            ep.episode_number <= input.episodeNumber)
      )
      .map((ep) => ({
        user_id: user.id,
        tmdb_show_id: input.showTmdbId,
        season_number: season.season_number,
        episode_number: ep.episode_number,
        runtime_minutes: ep.runtime,
      }))
  );

  if (rows.length > 0) {
    const { error } = await supabase.from("episode_watches").upsert(rows, {
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
