"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaSnapshot } from "@/types/library";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Marking an episode auto-adds the show to the library as "watching", and
 * keeps status/total_episodes in sync: all episodes watched → "completed",
 * un-watching after completion → back to "watching".
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

  const { count, error: countError } = await supabase
    .from("episode_watches")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("tmdb_show_id", showTmdbId);
  if (countError) throw new Error(countError.message);

  const watched = count ?? 0;
  const total = snapshot.totalEpisodes;
  const isComplete = total !== null && total > 0 && watched >= total;

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
      total_episodes: total,
    });
    if (error) throw new Error(error.message);
    return;
  }

  const update: Record<string, unknown> = {};
  if (item.total_episodes !== total) update.total_episodes = total;

  if (isComplete && item.status !== "completed") {
    update.status = "completed";
    if (!item.finished_at) update.finished_at = today();
  } else if (!isComplete && watched > 0 && ["completed", "plan_to_watch"].includes(item.status)) {
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
