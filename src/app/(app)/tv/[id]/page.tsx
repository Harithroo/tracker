import { notFound } from "next/navigation";
import { requireUser } from "@/lib/firebase/admin";
import { episodeWatches, libraryItems } from "@/lib/mongo/client";
import { getSeason, getShow } from "@/lib/tmdb/client";
import { episodeKey, nextAiredEpisode } from "@/lib/progress";
import { isAired, yearOf } from "@/lib/utils";
import type { MediaSnapshot, WatchStatus } from "@/types/library";
import { DetailsHero, pickTrailer } from "@/components/media/DetailsHero";
import { CastRow } from "@/components/media/CastRow";
import { MediaRow, RowItem } from "@/components/media/MediaRow";
import { PosterCard } from "@/components/media/PosterCard";
import { LibraryControls } from "@/components/library/LibraryControls";
import { InlineEpisodes } from "@/components/library/InlineEpisodes";
import type { EpisodeRow } from "@/components/library/EpisodeList";

export default async function ShowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const showId = Number(id);
  if (!Number.isInteger(showId)) notFound();

  const { id: userId } = await requireUser();
  const items = await libraryItems();

  const [show, item, epRows] = await Promise.all([
    getShow(showId).catch(() => null),
    items.findOne(
      { user_id: userId, tmdb_id: showId, media_type: "tv" },
      { projection: { status: 1, rating: 1, favorite: 1, notes: 1, _id: 0 } }
    ),
    (await episodeWatches())
      .find({ user_id: userId, tmdb_show_id: showId })
      .project<{ season_number: number; episode_number: number }>({
        season_number: 1,
        episode_number: 1,
        _id: 0,
      })
      .toArray(),
  ]);
  if (!show) notFound();

  // Specials are excluded: TMDB's number_of_episodes doesn't count them either,
  // so including them here would push the bar past 100%.
  const totalWatched = epRows.filter((row) => row.season_number > 0).length;
  const watchedPct = show.number_of_episodes
    ? Math.min(100, Math.round((totalWatched / show.number_of_episodes) * 100))
    : 0;
  const watchedSet = new Set(epRows.map((row) => episodeKey(row.season_number, row.episode_number)));

  const snapshot: MediaSnapshot = {
    title: show.name,
    posterPath: show.poster_path,
    releaseYear: yearOf(show.first_air_date),
    runtimeMinutes: show.episode_run_time?.[0] ?? null,
    genreIds: show.genres.map((g) => g.id),
    totalEpisodes: show.number_of_episodes,
  };

  const seasons = show.seasons
    .filter((s) => s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number);

  // Default to the season holding the next unwatched aired episode, falling
  // back to the most recent season once fully caught up.
  const nextUp = nextAiredEpisode(show.seasons, show.last_episode_to_air, watchedSet);
  const defaultSeasonNumber =
    nextUp?.season ?? seasons[seasons.length - 1]?.season_number ?? 1;
  const defaultSeason = await getSeason(showId, defaultSeasonNumber).catch(() => null);
  const initialEpisodes: EpisodeRow[] =
    defaultSeason?.episodes.map((ep) => ({
      episodeNumber: ep.episode_number,
      name: ep.name,
      airDate: ep.air_date,
      runtimeMinutes: ep.runtime,
      aired: isAired(ep.air_date),
    })) ?? [];
  // Every season's watched episodes, not just the one shown first: the episode
  // list reads its ticks straight from here, so they stay correct after a
  // revalidation instead of reverting to whatever was true on first render.
  const watchedBySeason: Record<number, number[]> = {};
  for (const row of epRows) {
    (watchedBySeason[row.season_number] ??= []).push(row.episode_number);
  }

  const recommendations = show.recommendations?.results?.slice(0, 12) ?? [];

  // Library status for the recommendation cards' indicators/quick menus
  const recStatus = new Map<number, WatchStatus>();
  if (recommendations.length > 0) {
    const rows = await items
      .find({
        user_id: userId,
        media_type: "tv",
        tmdb_id: { $in: recommendations.map((r) => r.id) },
      })
      .project<{ tmdb_id: number; status: WatchStatus }>({
        tmdb_id: 1,
        status: 1,
        _id: 0,
      })
      .toArray();
    for (const row of rows) recStatus.set(row.tmdb_id, row.status);
  }

  return (
    <div className="space-y-10">
      <DetailsHero
        title={show.name}
        tagline={show.tagline}
        overview={show.overview}
        posterPath={show.poster_path}
        backdropPath={show.backdrop_path}
        meta={[
          String(yearOf(show.first_air_date) ?? ""),
          `${show.number_of_seasons} season${show.number_of_seasons === 1 ? "" : "s"}`,
          `${show.number_of_episodes} episodes`,
          show.status,
          show.vote_average ? `★ ${show.vote_average.toFixed(1)}` : null,
        ]}
        genres={show.genres}
        trailer={pickTrailer(show.videos?.results ?? [])}
        providers={show["watch/providers"]?.results?.US?.flatrate ?? []}
      >
        <LibraryControls
          tmdbId={showId}
          mediaType="tv"
          snapshot={snapshot}
          item={item}
        />
      </DetailsHero>

      <section className="space-y-3.5">
        {show.number_of_episodes > 0 && (
          <div className="rounded-lg bg-neutral-900 p-3.5">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] text-neutral-400">
                {totalWatched} of {show.number_of_episodes} episodes
              </span>
              <span className="text-[13px] font-medium text-accent-300">
                {watchedPct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${watchedPct}%` }}
              />
            </div>
          </div>
        )}

        <InlineEpisodes
          showTmdbId={showId}
          seasons={seasons.map((s) => ({
            seasonNumber: s.season_number,
            label: `S${s.season_number}`,
          }))}
          initialSeasonNumber={defaultSeasonNumber}
          initialEpisodes={initialEpisodes}
          watchedBySeason={watchedBySeason}
          snapshot={snapshot}
        />
      </section>

      <CastRow cast={show.credits?.cast ?? []} />

      {recommendations.length > 0 && (
        <MediaRow title="Similar Shows">
          {recommendations.map((rec) => (
            <RowItem key={rec.id}>
              <PosterCard
                href={`/tv/${rec.id}`}
                posterPath={rec.poster_path}
                title={rec.name ?? ""}
                subtitle={String(yearOf(rec.first_air_date) ?? "")}
                quick={{
                  tmdbId: rec.id,
                  mediaType: "tv",
                  status: recStatus.get(rec.id) ?? null,
                }}
              />
            </RowItem>
          ))}
        </MediaRow>
      )}
    </div>
  );
}
