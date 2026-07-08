import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { genreName } from "@/lib/tmdb/genres";
import { formatWatchTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Stats" };

interface ItemRow {
  media_type: "movie" | "tv";
  status: string;
  rating: number | null;
  runtime_minutes: number | null;
  genre_ids: number[];
  finished_at: string | null;
}

interface EpisodeRow {
  runtime_minutes: number | null;
  watched_at: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function StatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [items, episodes] = await Promise.all([
    fetchAllRows<ItemRow>((from, to) =>
      supabase
        .from("library_items")
        .select("media_type, status, rating, runtime_minutes, genre_ids, finished_at, id")
        .eq("user_id", userId)
        .order("id")
        .range(from, to)
    ),
    fetchAllRows<EpisodeRow>((from, to) =>
      supabase
        .from("episode_watches")
        .select("runtime_minutes, watched_at, id")
        .eq("user_id", userId)
        .order("id")
        .range(from, to)
    ),
  ]);

  // Headline numbers
  const movies = items.filter((i) => i.media_type === "movie");
  const shows = items.filter((i) => i.media_type === "tv");
  const completedMovies = movies.filter((i) => i.status === "completed");
  const completedShows = shows.filter((i) => i.status === "completed");
  const watchingShows = shows.filter((i) => i.status === "watching");

  const movieMinutes = completedMovies.reduce(
    (sum, m) => sum + (m.runtime_minutes ?? 0),
    0
  );
  const episodeMinutes = episodes.reduce(
    (sum, e) => sum + (e.runtime_minutes ?? 0),
    0
  );
  const totalMinutes = movieMinutes + episodeMinutes;

  const avgOf = (list: ItemRow[]): string | null => {
    const ratings = list.filter((i) => i.rating !== null).map((i) => i.rating!);
    return ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : null;
  };
  const avgMovieRating = avgOf(movies);
  const avgShowRating = avgOf(shows);

  // Favorite genres (across the whole library)
  const genreCounts = new Map<number, number>();
  for (const item of items) {
    for (const gid of item.genre_ids ?? []) {
      genreCounts.set(gid, (genreCounts.get(gid) ?? 0) + 1);
    }
  }
  const topGenres = [...genreCounts.entries()]
    .map(([id, count]) => ({ name: genreName(id), count }))
    .filter((g): g is { name: string; count: number } => g.name !== null)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxGenre = topGenres[0]?.count ?? 1;

  // Activity dates: every episode watch + every movie finish
  const activityDates: string[] = [
    ...episodes.map((e) => e.watched_at.slice(0, 10)),
    ...completedMovies
      .map((m) => m.finished_at)
      .filter((d): d is string => d !== null),
  ];

  // Monthly activity — last 12 months
  const monthCounts = new Map<string, number>();
  for (const date of activityDates) {
    const key = date.slice(0, 7);
    monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
  }
  const months: { label: string; count: number }[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 0; i < 12; i++) {
    const key = cursor.toISOString().slice(0, 7);
    months.unshift({
      label: cursor.toLocaleDateString("en-US", { month: "short" }),
      count: monthCounts.get(key) ?? 0,
    });
    cursor.setMonth(cursor.getMonth() - 1);
  }
  const maxMonth = Math.max(1, ...months.map((m) => m.count));

  // Yearly activity
  const yearCounts = new Map<string, number>();
  for (const date of activityDates) {
    const year = date.slice(0, 4);
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
  }
  const years = [...yearCounts.entries()].sort((a, b) =>
    b[0].localeCompare(a[0])
  );
  const maxYear = Math.max(1, ...years.map(([, c]) => c));

  // Watching streak — consecutive days with activity, ending today or yesterday
  const dateSet = new Set(activityDates);
  let streak = 0;
  const day = new Date();
  if (!dateSet.has(isoDate(day))) day.setDate(day.getDate() - 1);
  while (dateSet.has(isoDate(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }

  const sections: {
    title: string;
    cards: { label: string; value: string | number; hint?: string }[];
  }[] = [
    {
      title: "Movies",
      cards: [
        { label: "Watched", value: completedMovies.length },
        {
          label: "Plan to watch",
          value: movies.filter((i) => i.status === "plan_to_watch").length,
        },
        { label: "Watch time", value: formatWatchTime(movieMinutes) },
        {
          label: "Average rating",
          value: avgMovieRating ? `★ ${avgMovieRating}` : "—",
        },
      ],
    },
    {
      title: "Shows",
      cards: [
        {
          label: "Completed",
          value: completedShows.length,
          hint: `${watchingShows.length} watching`,
        },
        { label: "Episodes watched", value: episodes.length },
        { label: "Watch time", value: formatWatchTime(episodeMinutes) },
        {
          label: "Average rating",
          value: avgShowRating ? `★ ${avgShowRating}` : "—",
        },
      ],
    },
    {
      title: "Overall",
      cards: [
        { label: "Total watch time", value: formatWatchTime(totalMinutes) },
        {
          label: "Watching streak",
          value: `${streak} day${streak === 1 ? "" : "s"}`,
        },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">Stats</h1>

      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="mb-3 text-lg font-semibold">{section.title}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {section.cards.map((card) => (
              <div
                key={card.label}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="mt-1 text-sm text-muted">
                  {card.label}
                  {card.hint ? ` · ${card.hint}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-4 text-lg font-semibold">Last 12 Months</h2>
        <div className="flex h-36 items-end gap-1.5">
          {months.map((month, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-[10px] text-muted">
                {month.count > 0 ? month.count : ""}
              </span>
              <div
                className="w-full rounded-t bg-accent/80"
                style={{
                  height: `${(month.count / maxMonth) * 100}%`,
                  minHeight: month.count > 0 ? "3px" : "1px",
                }}
              />
              <span className="text-[10px] text-muted">{month.label}</span>
            </div>
          ))}
        </div>
      </section>

      {topGenres.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-lg font-semibold">Favorite Genres</h2>
          <div className="space-y-2.5">
            {topGenres.map((genre) => (
              <div key={genre.name} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-muted">
                  {genre.name}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(genre.count / maxGenre) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right text-sm font-medium">
                  {genre.count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {years.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-lg font-semibold">By Year</h2>
          <div className="space-y-2.5">
            {years.map(([year, count]) => (
              <div key={year} className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-sm text-muted">{year}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(count / maxYear) * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right text-sm font-medium">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-muted">
        Watch time counts completed movies and every episode watched. Genres
        count everything in your library.
      </p>
    </div>
  );
}
