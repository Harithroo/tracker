import "server-only";
import { MongoBulkWriteError } from "mongodb";
import { episodeWatches } from "./client";

export interface NewEpisodeWatch {
  user_id: string;
  tmdb_show_id: number;
  season_number: number;
  episode_number: number;
  runtime_minutes: number | null;
  watched_at?: string;
}

/**
 * Adds watches, leaving any that already exist untouched — the unique index on
 * (user, show, season, episode) is what makes "mark watched" idempotent, and an
 * existing row's original `watched_at` is the one worth keeping.
 */
export async function addEpisodeWatches(rows: NewEpisodeWatch[]): Promise<number> {
  if (rows.length === 0) return 0;
  const watches = await episodeWatches();

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((row) => {
      const key = {
        user_id: row.user_id,
        tmdb_show_id: row.tmdb_show_id,
        season_number: row.season_number,
        episode_number: row.episode_number,
      };
      return {
        updateOne: {
          filter: key,
          update: {
            $setOnInsert: {
              ...key,
              runtime_minutes: row.runtime_minutes,
              watched_at: row.watched_at ?? new Date().toISOString(),
            },
          },
          upsert: true,
        },
      };
    });
    try {
      const result = await watches.bulkWrite(batch, { ordered: false });
      inserted += result.upsertedCount;
    } catch (err) {
      // Two upserts of the same episode in flight at once: the index did its
      // job and the row exists either way.
      if (!(err instanceof MongoBulkWriteError) || err.code !== 11000) throw err;
      inserted += err.result?.upsertedCount ?? 0;
    }
  }
  return inserted;
}
