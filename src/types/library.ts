export type MediaType = "movie" | "tv";

export type WatchStatus =
  | "watching"
  | "completed"
  | "plan_to_watch"
  | "on_hold"
  | "dropped";

export interface LibraryItem {
  id: string;
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

export interface EpisodeWatch {
  id: string;
  user_id: string;
  tmdb_show_id: number;
  season_number: number;
  episode_number: number;
  runtime_minutes: number | null;
  watched_at: string;
}

/** TMDB snapshot captured when an item enters the library (performance cache). */
export interface MediaSnapshot {
  title: string;
  posterPath: string | null;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  genreIds: number[];
  totalEpisodes: number | null;
}

/**
 * User-selectable statuses. "completed" for shows is set automatically when
 * all aired episodes of an ended show are watched, and "dropped" only exists
 * for imported data — neither is offered in the UI.
 */
export const TV_STATUSES: WatchStatus[] = [
  "watching",
  "plan_to_watch",
  "on_hold",
];

export const MOVIE_STATUSES: WatchStatus[] = ["completed", "plan_to_watch"];

export function statusLabel(status: WatchStatus, mediaType: MediaType): string {
  const labels: Record<WatchStatus, string> = {
    watching: "Watching",
    completed: mediaType === "movie" ? "Watched" : "Completed",
    plan_to_watch: "Plan to Watch",
    on_hold: "On Hold",
    dropped: "Dropped",
  };
  return labels[status];
}
