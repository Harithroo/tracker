// Normalized import model. Every source parser (Trakt, TV Time GDPR, tracker
// backup, Liberator…) produces a flat list of these; the /api/import route
// resolves them against TMDB and writes them for the signed-in user.

export interface MovieImportItem {
  kind: "movie";
  tmdbId?: number;
  imdbId?: string;
  title: string;
  year?: number | null;
  /** ISO timestamp of the watch; null/undefined = not watched */
  watchedAt?: string | null;
  rating?: number | null;
  watchlist?: boolean;
}

export interface EpisodeImportItem {
  season: number;
  episode: number;
  watchedAt?: string | null;
}

export interface ShowImportItem {
  kind: "show";
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  title: string;
  year?: number | null;
  rating?: number | null;
  watchlist?: boolean;
  archived?: boolean;
  episodes: EpisodeImportItem[];
}

export type ImportItem = MovieImportItem | ShowImportItem;

export type ImportSource = "trakt" | "tvtime-gdpr" | "tracker-backup" | "tvtime-liberator";

export interface ImportPlan {
  source: ImportSource;
  items: ImportItem[];
}

export interface ImportItemResult {
  kind: "movie" | "show";
  title: string;
  status: "imported" | "merged" | "skipped" | "unmatched" | "error";
  episodesImported?: number;
  detail?: string;
}
