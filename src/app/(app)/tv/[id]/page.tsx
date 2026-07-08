import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getShow } from "@/lib/tmdb/client";
import { posterUrl } from "@/lib/tmdb/images";
import { yearOf } from "@/lib/utils";
import type { MediaSnapshot, WatchStatus } from "@/types/library";
import { DetailsHero, pickTrailer } from "@/components/media/DetailsHero";
import { CastRow } from "@/components/media/CastRow";
import { MediaRow, RowItem } from "@/components/media/MediaRow";
import { PosterCard } from "@/components/media/PosterCard";
import { LibraryControls } from "@/components/library/LibraryControls";

export default async function ShowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const showId = Number(id);
  if (!Number.isInteger(showId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [show, itemResult, epRows] = await Promise.all([
    getShow(showId).catch(() => null),
    supabase
      .from("library_items")
      .select("status, rating, favorite, notes")
      .eq("user_id", user!.id)
      .eq("tmdb_id", showId)
      .eq("media_type", "tv")
      .maybeSingle(),
    fetchAllRows<{ season_number: number }>((from, to) =>
      supabase
        .from("episode_watches")
        .select("season_number")
        .eq("user_id", user!.id)
        .eq("tmdb_show_id", showId)
        .order("id")
        .range(from, to)
    ),
  ]);
  if (!show) notFound();

  // Watched count per season
  const watchedPerSeason = new Map<number, number>();
  for (const row of epRows) {
    watchedPerSeason.set(
      row.season_number,
      (watchedPerSeason.get(row.season_number) ?? 0) + 1
    );
  }
  const totalWatched = epRows.length;

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
  const recommendations = show.recommendations?.results?.slice(0, 12) ?? [];

  // Library status for the recommendation cards' indicators/quick menus
  const recStatus = new Map<number, WatchStatus>();
  if (recommendations.length > 0) {
    const { data: rows } = await supabase
      .from("library_items")
      .select("tmdb_id, status")
      .eq("user_id", user!.id)
      .eq("media_type", "tv")
      .in(
        "tmdb_id",
        recommendations.map((r) => r.id)
      );
    for (const row of rows ?? []) recStatus.set(row.tmdb_id, row.status);
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
          item={itemResult.data}
        />
      </DetailsHero>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Seasons</h2>
          {show.number_of_episodes > 0 && (
            <span className="text-sm text-muted">
              {totalWatched} / {show.number_of_episodes} episodes watched
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {seasons.map((season) => {
            const watched = watchedPerSeason.get(season.season_number) ?? 0;
            const pct = (watched / season.episode_count) * 100;
            const poster = posterUrl(season.poster_path, "w185");
            return (
              <Link
                key={season.id}
                href={`/tv/${showId}/season/${season.season_number}`}
                className="flex gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-accent"
              >
                <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                  {poster && (
                    <Image
                      src={poster}
                      alt={season.name}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 self-center">
                  <p className="font-medium">{season.name}</p>
                  <p className="text-xs text-muted">
                    {[yearOf(season.air_date), `${season.episode_count} episodes`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {watched} / {season.episode_count} watched
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
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
