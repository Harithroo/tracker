import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "./supabase/fetch-all";
import { computeStreak, daysAgoIso } from "./utils";

export interface WeekSummary {
  episodes: number;
  minutes: number;
  streakDays: number;
}

/** This-week (rolling 7 days) activity plus the running streak, for the Home page's summary band. */
export async function getWeekSummary(
  supabase: SupabaseClient,
  userId: string
): Promise<WeekSummary> {
  const cutoff = daysAgoIso(7);

  const [weekEpisodes, weekMovies, allEpisodeDates, allMovieDates] = await Promise.all([
    supabase
      .from("episode_watches")
      .select("runtime_minutes")
      .eq("user_id", userId)
      .gte("watched_at", cutoff)
      .then(({ data }) => data ?? []),
    supabase
      .from("library_items")
      .select("runtime_minutes")
      .eq("user_id", userId)
      .eq("media_type", "movie")
      .not("finished_at", "is", null)
      .gte("finished_at", cutoff)
      .then(({ data }) => data ?? []),
    fetchAllRows<{ watched_at: string }>((from, to) =>
      supabase
        .from("episode_watches")
        .select("watched_at, id")
        .eq("user_id", userId)
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<{ finished_at: string }>((from, to) =>
      supabase
        .from("library_items")
        .select("finished_at, id")
        .eq("user_id", userId)
        .eq("media_type", "movie")
        .not("finished_at", "is", null)
        .order("id")
        .range(from, to)
    ),
  ]);

  const minutes =
    weekEpisodes.reduce((sum, e) => sum + (e.runtime_minutes ?? 0), 0) +
    weekMovies.reduce((sum, m) => sum + (m.runtime_minutes ?? 0), 0);

  const activityDates = [
    ...allEpisodeDates.map((e) => e.watched_at.slice(0, 10)),
    ...allMovieDates.map((m) => m.finished_at.slice(0, 10)),
  ];

  return {
    episodes: weekEpisodes.length,
    minutes,
    streakDays: computeStreak(activityDates),
  };
}
