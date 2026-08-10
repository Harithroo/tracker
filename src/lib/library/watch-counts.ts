import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export interface ShowWatchCount {
  /** Watched episodes, specials excluded. */
  watchedCount: number;
  lastWatchedAt: string | null;
}

/**
 * Per-show watch counts for the current user.
 *
 * The aggregate view counts every row, specials included, while the totals it
 * gets compared against — TMDB's number_of_episodes — never count specials, so
 * a show with specials logged reads as "1112 / 1108". Subtracting them here
 * rather than in the view keeps the whole fix in application code, and specials
 * are few enough that fetching them costs little next to the episode rows the
 * view exists to avoid.
 */
export async function getShowWatchCounts(
  supabase: SupabaseClient,
  userId: string,
  showIds?: number[]
): Promise<Map<number, ShowWatchCount>> {
  const counts = new Map<number, ShowWatchCount>();
  if (showIds?.length === 0) return counts;

  const [totals, specials] = await Promise.all([
    (() => {
      const query = supabase
        .from("episode_watch_counts")
        .select("tmdb_show_id, watched_count, last_watched_at")
        .eq("user_id", userId);
      return showIds ? query.in("tmdb_show_id", showIds) : query;
    })(),
    fetchAllRows<{ tmdb_show_id: number }>((from, to) => {
      const query = supabase
        .from("episode_watches")
        .select("tmdb_show_id, id")
        .eq("user_id", userId)
        .eq("season_number", 0);
      return (showIds ? query.in("tmdb_show_id", showIds) : query)
        .order("id")
        .range(from, to);
    }),
  ]);
  if (totals.error) throw new Error(totals.error.message);

  const specialCounts = new Map<number, number>();
  for (const row of specials) {
    specialCounts.set(row.tmdb_show_id, (specialCounts.get(row.tmdb_show_id) ?? 0) + 1);
  }

  for (const row of totals.data ?? []) {
    counts.set(row.tmdb_show_id, {
      watchedCount: Math.max(
        0,
        row.watched_count - (specialCounts.get(row.tmdb_show_id) ?? 0)
      ),
      lastWatchedAt: row.last_watched_at ?? null,
    });
  }
  return counts;
}
