import "server-only";
import { episodeWatches } from "@/lib/mongo/client";

export interface ShowWatchCount {
  /** Watched episodes, specials excluded. */
  watchedCount: number;
  lastWatchedAt: string | null;
}

/**
 * Per-show watch counts for the current user, aggregated in the database so
 * pages don't page through thousands of episode rows.
 *
 * Specials don't count: the total they get compared against — TMDB's
 * number_of_episodes — never includes them, so a show with specials logged
 * would otherwise read as "1112 / 1108".
 */
export async function getShowWatchCounts(
  userId: string,
  showIds?: number[]
): Promise<Map<number, ShowWatchCount>> {
  const counts = new Map<number, ShowWatchCount>();
  if (showIds?.length === 0) return counts;

  const rows = await (await episodeWatches())
    .aggregate<{ _id: number; watchedCount: number; lastWatchedAt: string | null }>([
      {
        $match: {
          user_id: userId,
          ...(showIds ? { tmdb_show_id: { $in: showIds } } : {}),
        },
      },
      {
        $group: {
          _id: "$tmdb_show_id",
          watchedCount: {
            $sum: { $cond: [{ $gt: ["$season_number", 0] }, 1, 0] },
          },
          lastWatchedAt: { $max: "$watched_at" },
        },
      },
    ])
    .toArray();

  for (const row of rows) {
    counts.set(row._id, {
      watchedCount: row.watchedCount,
      lastWatchedAt: row.lastWatchedAt ?? null,
    });
  }
  return counts;
}
