import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getShow, getTrending } from "@/lib/tmdb/client";
import { episodeKey, nextEpisode } from "@/lib/progress";
import { epCode, yearOf } from "@/lib/utils";
import type { LibraryItem } from "@/types/library";
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
    .limit(12);
  const watching = (watchingData ?? []) as LibraryItem[];

  // Episode progress + "up next" for the shows currently being watched
  const tvItems = watching.filter((i) => i.media_type === "tv");
  const watchedByShow = new Map<number, Set<string>>();
  if (tvItems.length > 0) {
    const epRows = await fetchAllRows<{
      tmdb_show_id: number;
      season_number: number;
      episode_number: number;
    }>((from, to) =>
      supabase
        .from("episode_watches")
        .select("tmdb_show_id, season_number, episode_number")
        .eq("user_id", userId)
        .in(
          "tmdb_show_id",
          tvItems.map((i) => i.tmdb_id)
        )
        .order("id")
        .range(from, to)
    );
    for (const row of epRows) {
      const set = watchedByShow.get(row.tmdb_show_id) ?? new Set<string>();
      set.add(episodeKey(row.season_number, row.episode_number));
      watchedByShow.set(row.tmdb_show_id, set);
    }
  }

  const upNext = new Map<number, string>();
  await Promise.all(
    tvItems.slice(0, 8).map(async (item) => {
      try {
        const show = await getShow(item.tmdb_id);
        const next = nextEpisode(
          show.seasons,
          watchedByShow.get(item.tmdb_id) ?? new Set()
        );
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
              const watchedCount = watchedByShow.get(item.tmdb_id)?.size ?? 0;
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
                />
              </RowItem>
            ))}
          </MediaRow>
        </>
      )}
    </div>
  );
}
