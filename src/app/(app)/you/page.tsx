import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { genreName } from "@/lib/tmdb/genres";
import { computeStreak, formatWatchTime, yearOf } from "@/lib/utils";
import { AccountSection } from "@/components/settings/AccountSection";

export const metadata: Metadata = { title: "You" };

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

export default async function YouPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [items, episodes, profile] = await Promise.all([
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
    supabase.from("profiles").select("username").eq("id", userId).single(),
  ]);

  const movies = items.filter((i) => i.media_type === "movie");
  const shows = items.filter((i) => i.media_type === "tv");
  const completedMovies = movies.filter((i) => i.status === "completed");
  const completedShows = shows.filter((i) => i.status === "completed");

  const movieMinutes = completedMovies.reduce((sum, m) => sum + (m.runtime_minutes ?? 0), 0);
  const episodeMinutes = episodes.reduce((sum, e) => sum + (e.runtime_minutes ?? 0), 0);
  const totalMinutes = movieMinutes + episodeMinutes;

  const avgOf = (list: ItemRow[]): string | null => {
    const ratings = list.filter((i) => i.rating !== null).map((i) => i.rating!);
    return ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : null;
  };
  const avgShowRating = avgOf(shows);

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

  const activityDates: string[] = [
    ...episodes.map((e) => e.watched_at.slice(0, 10)),
    ...completedMovies.map((m) => m.finished_at).filter((d): d is string => d !== null),
  ];
  const streak = computeStreak(activityDates);

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

  const yearCounts = new Map<string, number>();
  for (const date of activityDates) {
    yearCounts.set(date.slice(0, 4), (yearCounts.get(date.slice(0, 4)) ?? 0) + 1);
  }
  const years = [...yearCounts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const maxYear = Math.max(1, ...years.map(([, c]) => c));

  const totals = [
    { value: episodes.length.toLocaleString(), label: "Episodes watched" },
    { value: completedMovies.length.toLocaleString(), label: "Movies watched" },
    { value: formatWatchTime(totalMinutes), label: "Total watch time" },
    { value: `${streak} day${streak === 1 ? "" : "s"}`, label: "Current streak" },
    { value: avgShowRating ? `★ ${avgShowRating}` : "—", label: "Average show rating" },
    { value: items.length.toLocaleString(), label: "Titles tracked" },
  ];

  const username = profile.data?.username ?? user!.email ?? "you";
  const initial = username.slice(0, 1).toUpperCase();
  const memberSinceYear = yearOf(user!.created_at);
  const completedCount = completedMovies.length + completedShows.length;

  return (
    <div className="mx-auto max-w-lg space-y-8 md:max-w-3xl">
      <div className="flex items-center gap-3.5">
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-accent-900 text-[19px] font-medium text-accent-300">
          {initial}
        </div>
        <div className="min-w-0">
          <p className="text-[19px] font-medium">{username}</p>
          <p className="mt-0.5 text-[13px] text-neutral-600">
            {formatWatchTime(totalMinutes)} watched
            {memberSinceYear ? ` · since ${memberSinceYear}` : ""}
          </p>
        </div>
      </div>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          Last 12 months
        </h2>
        <div className="rounded-lg bg-neutral-900 px-3.5 pb-3 pt-4">
          <div className="flex h-[110px] items-end gap-1.5">
            {months.map((month, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: `${Math.max(2, (month.count / maxMonth) * 100)}%`,
                    background: i === 11 ? "var(--color-accent-300)" : "var(--color-accent-700)",
                  }}
                />
                <span className="text-[10px] text-neutral-600">{month.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          Totals
        </h2>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
          {totals.map((card) => (
            <div key={card.label} className="rounded-lg bg-neutral-900 p-3.5">
              <p className="text-[21px] font-medium tracking-tight">{card.value}</p>
              <p className="mt-0.5 text-xs text-neutral-500">{card.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-xs text-neutral-600">
          {completedCount} title{completedCount === 1 ? "" : "s"} completed overall.
        </p>
      </section>

      {topGenres.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
            Genres
          </h2>
          <div className="flex flex-col gap-2.5">
            {topGenres.map((genre) => (
              <div key={genre.name} className="flex items-center gap-2.5">
                <span className="w-[104px] shrink-0 truncate text-sm text-neutral-400">
                  {genre.name}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-900">
                  <div
                    className="h-full rounded-full bg-accent-600"
                    style={{ width: `${(genre.count / maxGenre) * 100}%` }}
                  />
                </div>
                <span className="w-[30px] shrink-0 text-right text-xs text-neutral-500">
                  {genre.count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {years.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
            By year
          </h2>
          <div className="flex flex-col gap-2.5">
            {years.map(([year, count]) => (
              <div key={year} className="flex items-center gap-2.5">
                <span className="w-12 shrink-0 text-sm text-neutral-400">{year}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-900">
                  <div
                    className="h-full rounded-full bg-accent-600"
                    style={{ width: `${(count / maxYear) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs text-neutral-500">{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          Account
        </h2>
        <AccountSection username={username} email={user!.email ?? ""} />
      </section>
    </div>
  );
}
