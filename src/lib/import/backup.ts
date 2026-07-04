import type { ImportItem, ShowImportItem } from "./types";

export const BACKUP_FORMAT = "tracker-backup@1";

export interface TrackerBackup {
  format: typeof BACKUP_FORMAT;
  exportedAt: string;
  library: BackupLibraryItem[];
  episodeWatches: BackupEpisodeWatch[];
}

export interface BackupLibraryItem {
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: string;
  rating: number | null;
  favorite: boolean;
  notes: string | null;
  started_at: string | null;
  finished_at: string | null;
  title: string;
}

export interface BackupEpisodeWatch {
  tmdb_show_id: number;
  season_number: number;
  episode_number: number;
  watched_at: string;
}

/** Converts a tracker backup file back into import items. */
export function parseTrackerBackup(json: string): ImportItem[] {
  const backup = JSON.parse(json) as TrackerBackup;
  if (backup.format !== BACKUP_FORMAT) {
    throw new Error(`Unsupported backup format: ${String(backup.format)}`);
  }

  const episodesByShow = new Map<number, BackupEpisodeWatch[]>();
  for (const ep of backup.episodeWatches ?? []) {
    const list = episodesByShow.get(ep.tmdb_show_id) ?? [];
    list.push(ep);
    episodesByShow.set(ep.tmdb_show_id, list);
  }

  const items: ImportItem[] = [];
  for (const row of backup.library ?? []) {
    if (row.media_type === "movie") {
      items.push({
        kind: "movie",
        tmdbId: row.tmdb_id,
        title: row.title,
        watchedAt: row.status === "completed" ? (row.finished_at ?? null) : null,
        rating: row.rating,
        watchlist: row.status === "plan_to_watch",
      });
    } else {
      const item: ShowImportItem = {
        kind: "show",
        tmdbId: row.tmdb_id,
        title: row.title,
        rating: row.rating,
        watchlist: row.status === "plan_to_watch",
        archived: row.status === "on_hold",
        episodes: (episodesByShow.get(row.tmdb_id) ?? []).map((ep) => ({
          season: ep.season_number,
          episode: ep.episode_number,
          watchedAt: ep.watched_at,
        })),
      };
      items.push(item);
    }
  }

  // Watches for shows no longer in the library
  const libraryShowIds = new Set(
    (backup.library ?? []).filter((r) => r.media_type === "tv").map((r) => r.tmdb_id)
  );
  for (const [showId, eps] of episodesByShow) {
    if (libraryShowIds.has(showId)) continue;
    items.push({
      kind: "show",
      tmdbId: showId,
      title: `TMDB ${showId}`,
      episodes: eps.map((ep) => ({
        season: ep.season_number,
        episode: ep.episode_number,
        watchedAt: ep.watched_at,
      })),
    });
  }

  return items;
}
