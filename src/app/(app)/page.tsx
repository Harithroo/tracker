import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getShow, getTrending } from "@/lib/tmdb/client";
import { episodeKey, nextEpisode } from "@/lib/progress";
import { epCode, yearOf } from "@/lib/utils";
import type { LibraryItem, WatchStatus } from "@/types/library";
import type { TmdbSearchResult } from "@/lib/tmdb/types";
import { PosterCard } from "@/components/media/PosterCard";
import { MediaRow, RowItem } from "@/components/media/MediaRow";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { data: watchingData } = await supabase
    .from("library_items")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "watching")
    .order("updated_at", { ascending: false })
    .limit(100);
  const allWatching = (watchingData ?? []) as LibraryItem[];

  // Rank by actual watch recency (aggregated view), and only surface shows
  // touched in the last two months — stale ones stay in the library.
  const tvIds = allWatching.filter((i) => i.media_type === "tv").map((i) => i.tmdb_id);
  const watchedCounts = new Map<number, number>();
  const lastWatched = new Map<number, string>();
  if (tvIds.length > 0) {
    const { data: counts } = await supabase
      .from("episode_watch_counts")
      .select("tmdb_show_id, watched_count, last_watched_at")
      .eq("user_id", userId)
      .in("tmdb_show_id", tvIds);
    for (const row of counts ?? []) {
      watchedCounts.set(row.tmdb_show_id, row.watched_count);
      if (row.last_watched_at) lastWatched.set(row.tmdb_show_id, row.last_watched_at);
    }
  }

  const RECENT_DAYS = 60;
  const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const byRecency = [...allWatching].sort((a, b) => {
    const la = lastWatched.get(a.tmdb_id) ?? "";
    const lb = lastWatched.get(b.tmdb_id) ?? "";
    return lb.localeCompare(la);
  });
  const recent = byRecency.filter((i) => (lastWatched.get(i.tmdb_id) ?? "") >= cutoff);
  const watching = (recent.length > 0 ? recent : byRecency).slice(0, 12);
  const tvItems = watching.filter((i) => i.media_type === "tv");

  const upNext = new Map<number, string>();
  await Promise.all(
    tvItems.slice(0, 8).map(async (item) => {
      try {
        const [show, epRows] = await Promise.all([
          getShow(item.tmdb_id),
          fetchAllRows<{ season_number: number; episode_number: number }>((from, to) =>
            supabase
              .from("episode_watches")
              .select("season_number, episode_number")
              .eq("user_id", userId)
              .eq("tmdb_show_id", item.tmdb_id)
              .order("id")
              .range(from, to)
          ),
        ]);
        const watched = new Set(
          epRows.map((row) => episodeKey(row.season_number, row.episode_number))
        );
        const next = nextEpisode(show.seasons, watched);
        if (next) upNext.set(item.tmdb_id, epCode(next.season, next.episode));
      } catch {
        // TMDB unavailable — skip the badge, keep the page working
      }
    })
  );

  let trendingTv: TmdbSearchResult[] = [];
  let trendingMovies: TmdbSearchResult[] = [];
  let tmdbDown = false;
  try {
    [trendingTv, trendingMovies] = await Promise.all([
      getTrending("tv").then((r) => r.results),
      getTrending("movie").then((r) => r.results),
    ]);
  } catch {
    tmdbDown = true;
  }

  // Library status for the trending cards' indicators/quick menus
  const libraryStatus = new Map<string, WatchStatus>();
  const trendingIds = [...trendingTv, ...trendingMovies].map((t) => t.id);
  if (trendingIds.length > 0) {
    const { data: rows } = await supabase
      .from("library_items")
      .select("tmdb_id, media_type, status")
      .eq("user_id", userId)
      .in("tmdb_id", trendingIds);
    for (const row of rows ?? []) {
      libraryStatus.set(`${row.media_type}:${row.tmdb_id}`, row.status);
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-3 text-lg font-semibold">Continue Watching</h1>
        {watching.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            Nothing in progress yet.{" "}
            <Link href="/search" className="text-accent hover:text-accent-hover">
              Find something to watch →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {watching.map((item) => {
              const watchedCount = watchedCounts.get(item.tmdb_id) ?? 0;
              const progress =
                item.media_type === "tv" && item.total_episodes
                  ? (watchedCount / item.total_episodes) * 100
                  : undefined;
              return (
                <PosterCard
                  key={item.id}
                  href={`/${item.media_type}/${item.tmdb_id}`}
                  posterPath={item.poster_path}
                  title={item.title}
                  subtitle={
                    item.media_type === "tv" && item.total_episodes
                      ? `${watchedCount} / ${item.total_episodes} eps`
                      : String(item.release_year ?? "")
                  }
                  badge={upNext.get(item.tmdb_id) ?? null}
                  progress={progress}
                  quick={{
                    tmdbId: item.tmdb_id,
                    mediaType: item.media_type,
                    status: item.status,
                  }}
                />
              );
            })}
          </div>
        )}
      </section>

      {tmdbDown ? (
        <div className="rounded-xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-300">
          Couldn&apos;t reach TMDB — check that TMDB_API_TOKEN is set in
          .env.local (see README).
        </div>
      ) : (
        <>
          <MediaRow title="Trending Shows">
            {trendingTv.map((item) => (
              <RowItem key={item.id}>
                <PosterCard
                  href={`/tv/${item.id}`}
                  posterPath={item.poster_path}
                  title={item.name ?? ""}
                  subtitle={String(yearOf(item.first_air_date) ?? "")}
                  quick={{
                    tmdbId: item.id,
                    mediaType: "tv",
                    status: libraryStatus.get(`tv:${item.id}`) ?? null,
                  }}
                />
              </RowItem>
            ))}
          </MediaRow>

          <MediaRow title="Trending Movies">
            {trendingMovies.map((item) => (
              <RowItem key={item.id}>
                <PosterCard
                  href={`/movie/${item.id}`}
                  posterPath={item.poster_path}
                  title={item.title ?? ""}
                  subtitle={String(yearOf(item.release_date) ?? "")}
                  quick={{
                    tmdbId: item.id,
                    mediaType: "movie",
                    status: libraryStatus.get(`movie:${item.id}`) ?? null,
                  }}
                />
              </RowItem>
            ))}
          </MediaRow>
        </>
      )}
    </div>
  );
}
