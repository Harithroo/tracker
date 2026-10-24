import type { ObjectId, WithId } from "mongodb";
import type { MediaType, WatchStatus } from "@/types/library";

/**
 * Timestamps are stored as ISO-8601 strings (dates as `YYYY-MM-DD`) rather than
 * BSON dates. They sort and range-compare lexicographically, which is all the
 * queries here need, and it keeps one representation from the collection all
 * the way to the rendered page and the export file.
 */

export interface ProfileDoc {
  /** Firebase Auth uid. */
  _id: string;
  username: string | null;
  avatar_url: string | null;
  email: string | null;
  created_at: string;
}

export interface LibraryItemDoc {
  /** Optional so inserts don't have to invent one; reads always carry it. */
  _id?: ObjectId;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: WatchStatus;
  rating: number | null;
  favorite: boolean;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
  title: string;
  poster_path: string | null;
  release_year: number | null;
  runtime_minutes: number | null;
  genre_ids: number[];
  total_episodes: number | null;
  created_at: string;
  updated_at: string;
}

export interface EpisodeWatchDoc {
  _id?: ObjectId;
  user_id: string;
  tmdb_show_id: number;
  season_number: number;
  episode_number: number;
  runtime_minutes: number | null;
  watched_at: string;
}

/** Turns a document's ObjectId into the string `id` the UI keys off. */
export function withId<T>(doc: WithId<T>): Omit<T, "_id"> & { id: string } {
  const { _id, ...rest } = doc;
  return { ...(rest as Omit<T, "_id">), id: _id.toHexString() };
}
