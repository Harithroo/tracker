import { episodeWatches, libraryItems } from "./mongo/client";
import { computeStreak, daysAgoIso } from "./utils";

export interface WeekSummary {
  episodes: number;
  minutes: number;
  streakDays: number;
}

/** This-week (rolling 7 days) activity plus the running streak, for the Home page's summary band. */
export async function getWeekSummary(userId: string): Promise<WeekSummary> {
  const cutoff = daysAgoIso(7);
  const watches = await episodeWatches();
  const items = await libraryItems();

  const [weekEpisodes, weekMovies, allEpisodeDates, allMovieDates] = await Promise.all([
    watches
      .find({ user_id: userId, watched_at: { $gte: cutoff } })
      .project<{ runtime_minutes: number | null }>({ runtime_minutes: 1, _id: 0 })
      .toArray(),
    items
      .find({
        user_id: userId,
        media_type: "movie",
        finished_at: { $ne: null, $gte: cutoff },
      })
      .project<{ runtime_minutes: number | null }>({ runtime_minutes: 1, _id: 0 })
      .toArray(),
    watches
      .find({ user_id: userId })
      .project<{ watched_at: string }>({ watched_at: 1, _id: 0 })
      .toArray(),
    items
      .find({ user_id: userId, media_type: "movie", finished_at: { $ne: null } })
      .project<{ finished_at: string }>({ finished_at: 1, _id: 0 })
      .toArray(),
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
