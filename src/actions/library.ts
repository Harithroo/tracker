"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMovie, getShow } from "@/lib/tmdb/client";
import { yearOf } from "@/lib/utils";
import type { MediaSnapshot, MediaType, WatchStatus } from "@/types/library";

interface LibraryPatch {
  status?: WatchStatus;
  rating?: number | null;
  favorite?: boolean;
  notes?: string | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Creates the library row if missing (capturing the TMDB snapshot), otherwise
 * applies the patch. Rating/favoriting something not yet in the library adds it.
 */
export async function upsertLibraryItem(input: {
  tmdbId: number;
  mediaType: MediaType;
  snapshot: MediaSnapshot;
  patch: LibraryPatch;
}) {
  const { tmdbId, mediaType, snapshot, patch } = input;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: existing, error: selectError } = await supabase
    .from("library_items")
    .select("id, status, started_at, finished_at")
    .eq("user_id", user.id)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  if (existing) {
    const update: Record<string, unknown> = { ...patch };
    if (patch.status === "completed" && !existing.finished_at) {
      update.finished_at = today();
    }
    if (patch.status === "watching" && !existing.started_at) {
      update.started_at = today();
    }
    const { error } = await supabase
      .from("library_items")
      .update(update)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const status =
      patch.status ?? (mediaType === "movie" ? "completed" : "watching");
    const { error } = await supabase.from("library_items").insert({
      user_id: user.id,
      tmdb_id: tmdbId,
      media_type: mediaType,
      status,
      rating: patch.rating ?? null,
      favorite: patch.favorite ?? false,
      notes: patch.notes ?? null,
      started_at: status === "watching" ? today() : null,
      finished_at: status === "completed" ? today() : null,
      title: snapshot.title,
      poster_path: snapshot.posterPath,
      release_year: snapshot.releaseYear,
      runtime_minutes: snapshot.runtimeMinutes,
      genre_ids: snapshot.genreIds,
      total_episodes: snapshot.totalEpisodes,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/", "layout");
}

/**
 * Card quick-menu action: set a status (or remove) without the caller needing
 * snapshot data — the TMDB snapshot is fetched server-side when inserting.
 */
export async function quickSetStatus(
  tmdbId: number,
  mediaType: MediaType,
  status: WatchStatus | "remove"
) {
  if (status === "remove") {
    await removeLibraryItem(tmdbId, mediaType);
    return;
  }

  let snapshot: MediaSnapshot;
  if (mediaType === "movie") {
    const movie = await getMovie(tmdbId);
    snapshot = {
      title: movie.title,
      posterPath: movie.poster_path,
      releaseYear: yearOf(movie.release_date),
      runtimeMinutes: movie.runtime,
      genreIds: movie.genres.map((g) => g.id),
      totalEpisodes: null,
    };
  } else {
    const show = await getShow(tmdbId);
    snapshot = {
      title: show.name,
      posterPath: show.poster_path,
      releaseYear: yearOf(show.first_air_date),
      runtimeMinutes: show.episode_run_time?.[0] ?? null,
      genreIds: show.genres.map((g) => g.id),
      totalEpisodes: show.number_of_episodes,
    };
  }

  await upsertLibraryItem({ tmdbId, mediaType, snapshot, patch: { status } });
}

export async function removeLibraryItem(tmdbId: number, mediaType: MediaType) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("library_items")
    .delete()
    .eq("user_id", user.id)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType);
  if (error) throw new Error(error.message);

  revalidatePath("/", "layout");
}
