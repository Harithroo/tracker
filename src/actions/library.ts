"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/firebase/admin";
import { libraryItems } from "@/lib/mongo/client";
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
  const user = await requireUser();
  const items = await libraryItems();

  const key = { user_id: user.id, tmdb_id: tmdbId, media_type: mediaType };
  const existing = await items.findOne(key, {
    projection: { status: 1, started_at: 1, finished_at: 1 },
  });

  if (existing) {
    const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
    if (patch.status === "completed" && !existing.finished_at) {
      update.finished_at = today();
    }
    if (patch.status === "watching" && !existing.started_at) {
      update.started_at = today();
    }
    await items.updateOne({ _id: existing._id }, { $set: update });
  } else {
    const status =
      patch.status ?? (mediaType === "movie" ? "completed" : "watching");
    const now = new Date().toISOString();
    await items.insertOne({
      ...key,
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
      created_at: now,
      updated_at: now,
    });
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
  const user = await requireUser();
  await (
    await libraryItems()
  ).deleteOne({ user_id: user.id, tmdb_id: tmdbId, media_type: mediaType });

  revalidatePath("/", "layout");
}
