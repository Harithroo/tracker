import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getSeason, getShow, getTrending } from "@/lib/tmdb/client";
import { getWeekSummary } from "@/lib/activity";
import { episodeKey, nextAiredEpisode } from "@/lib/progress";
import {
  daysAgoIso,
  epCode,
  formatRelativeTime,
  formatShortDuration,
  yearOf,
} from "@/lib/utils";
import type { LibraryItem, MediaSnapshot, WatchStatus } from "@/types/library";
import type { TmdbSearchResult } from "@/lib/tmdb/types";
import { PosterCard } from "@/components/media/PosterCard";
import { UpNextHero, type HeroUpNext } from "@/components/media/UpNextHero";
import { KeepWatchingRow } from "@/components/media/KeepWatchingRow";
import { MediaRow, RowItem } from "@/components/media/MediaRow";

interface UpNextInfo extends HeroUpNext {
  backdropPath: string | null;
}

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
  const cutoff = daysAgoIso(RECENT_DAYS);
  const byRecency = [...allWatching].sort((a, b) => {
    const la = lastWatched.get(a.tmdb_id) ?? "";
    const lb = lastWatched.get(b.tmdb_id) ?? "";
    return lb.localeCompare(la);
  });
  const recent = byRecency.filter((i) => (lastWatched.get(i.tmdb_id) ?? "") >= cutoff);
  const candidates = (recent.length > 0 ? recent : byRecency)
    .filter((i) => i.media_type === "tv")
    .slice(0, 16);

  // Keep only shows with an unwatched *aired* episode — fully caught-up shows
  // (waiting on new episodes) don't belong in Continue Watching.
  const upNext = new Map<number, UpNextInfo>();
  const hasAiredNext = new Set<number>();
  await Promise.all(
    candidates.map(async (item) => {
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
        const next = nextAiredEpisode(show.seasons, show.last_episode_to_air, watched);
        if (next) {
          hasAiredNext.add(item.tmdb_id);
          // Pull the up-next episode's title/runtime so the card can show it and
          // log an accurate runtime when marked watched.
          let name = "";
          let runtimeMinutes: number | null = null;
          let airDate: string | null = null;
          try {
            const season = await getSeason(item.tmdb_id, next.season);
            const ep = season.episodes.find(
              (e) => e.episode_number === next.episode
            );
            if (ep) {
              name = ep.name;
              runtimeMinutes = ep.runtime;
              airDate = ep.air_date;
            }
          } catch {
            // Episode detail unavailable — the card still shows the code.
          }
          upNext.set(item.tmdb_id, {
            seasonNumber: next.season,
            episodeNumber: next.episode,
            name,
            runtimeMinutes,
            airDate,
            code: epCode(next.season, next.episode),
            backdropPath: show.backdrop_path,
          });
        }
      } catch {
        // TMDB unavailable — keep the show visible rather than hiding it
        hasAiredNext.add(item.tmdb_id);
      }
    })
  );
  const watching = candidates.filter((i) => hasAiredNext.has(i.tmdb_id)).slice(0, 12);
  const [hero, ...rest] = watching;

  const weekSummary = await getWeekSummary(supabase, userId);

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

  function snapshotOf(item: LibraryItem): MediaSnapshot {
    return {
      title: item.title,
      posterPath: item.poster_path,
      releaseYear: item.release_year,
      runtimeMinutes: item.runtime_minutes,
      genreIds: item.genre_ids,
      totalEpisodes: item.total_episodes,
    };
  }

  return (
    <div className="space-y-8">
      {hero && upNext.has(hero.tmdb_id) ? (
        <UpNextHero
          showTmdbId={hero.tmdb_id}
          href={`/tv/${hero.tmdb_id}`}
          title={hero.title}
          posterPath={hero.poster_path}
          backdropPath={upNext.get(hero.tmdb_id)!.backdropPath}
          upNext={upNext.get(hero.tmdb_id)!}
          watchedCount={watchedCounts.get(hero.tmdb_id) ?? 0}
          totalEpisodes={hero.total_episodes}
          favorite={hero.favorite}
          lastWatchedLabel={
            lastWatched.has(hero.tmdb_id)
              ? formatRelativeTime(lastWatched.get(hero.tmdb_id)!)
              : null
          }
          snapshot={snapshotOf(hero)}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
          Nothing in progress yet.{" "}
          <Link href="/search" className="text-accent hover:text-accent-hover">
            Find something to watch →
          </Link>
        </div>
      )}

      {rest.length > 0 && (
        <section>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
              Keep watching
            </h2>
            <Link href="/library?filter=watching" className="text-[13px] text-neutral-500 hover:text-text">
              All {rest.length + 1}
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {rest.map((item) => {
              const next = upNext.get(item.tmdb_id)!;
              return (
                <KeepWatchingRow
                  key={item.id}
                  showTmdbId={item.tmdb_id}
                  href={`/tv/${item.tmdb_id}`}
                  posterPath={item.poster_path}
                  title={item.title}
                  code={next.code}
                  episodeName={next.name}
                  watchedCount={watchedCounts.get(item.tmdb_id) ?? 0}
                  totalEpisodes={item.total_episodes}
                  runtimeMinutes={next.runtimeMinutes}
                  seasonNumber={next.seasonNumber}
                  episodeNumber={next.episodeNumber}
                  snapshot={snapshotOf(item)}
                />
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          This week
        </h2>
        <div className="flex gap-2.5">
          <div className="flex-1 rounded-lg bg-neutral-900 p-3.5">
            <p className="text-[23px] font-medium tracking-tight">{weekSummary.episodes}</p>
            <p className="mt-0.5 text-xs text-neutral-500">episodes</p>
          </div>
          <div className="flex-1 rounded-lg bg-neutral-900 p-3.5">
            <p className="text-[23px] font-medium tracking-tight">
              {formatShortDuration(weekSummary.minutes)}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">watched</p>
          </div>
          <div className="flex-1 rounded-lg bg-neutral-900 p-3.5">
            <p className="text-[23px] font-medium tracking-tight text-accent-300">
              {weekSummary.streakDays}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">day streak</p>
          </div>
        </div>
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
