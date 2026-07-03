import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSeason, getShow } from "@/lib/tmdb/client";
import { isAired, yearOf } from "@/lib/utils";
import type { MediaSnapshot } from "@/types/library";
import { EpisodeList, type EpisodeRow } from "@/components/library/EpisodeList";

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ id: string; seasonNumber: string }>;
}) {
  const { id, seasonNumber } = await params;
  const showId = Number(id);
  const seasonNum = Number(seasonNumber);
  if (!Number.isInteger(showId) || !Number.isInteger(seasonNum)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [show, season, watchedResult] = await Promise.all([
    getShow(showId).catch(() => null),
    getSeason(showId, seasonNum).catch(() => null),
    supabase
      .from("episode_watches")
      .select("episode_number")
      .eq("user_id", user!.id)
      .eq("tmdb_show_id", showId)
      .eq("season_number", seasonNum),
  ]);
  if (!show || !season) notFound();

  const snapshot: MediaSnapshot = {
    title: show.name,
    posterPath: show.poster_path,
    releaseYear: yearOf(show.first_air_date),
    runtimeMinutes: show.episode_run_time?.[0] ?? null,
    genreIds: show.genres.map((g) => g.id),
    totalEpisodes: show.number_of_episodes,
  };

  const episodes: EpisodeRow[] = season.episodes.map((ep) => ({
    episodeNumber: ep.episode_number,
    name: ep.name,
    airDate: ep.air_date,
    runtimeMinutes: ep.runtime,
    aired: isAired(ep.air_date),
  }));

  const watchedEpisodes = (watchedResult.data ?? []).map(
    (row) => row.episode_number
  );

  // Prev/next season navigation
  const orderedSeasons = show.seasons
    .filter((s) => s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number);
  const index = orderedSeasons.findIndex((s) => s.season_number === seasonNum);
  const prev = index > 0 ? orderedSeasons[index - 1] : null;
  const next =
    index >= 0 && index < orderedSeasons.length - 1
      ? orderedSeasons[index + 1]
      : null;

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm text-muted">
        <Link href={`/tv/${showId}`} className="hover:text-foreground">
          {show.name}
        </Link>
      </p>
      <div className="mb-1 mt-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{season.name}</h1>
        <div className="flex shrink-0 gap-2 text-sm">
          {prev && (
            <Link
              href={`/tv/${showId}/season/${prev.season_number}`}
              className="rounded-lg border border-border bg-surface px-2.5 py-1 text-muted transition-colors hover:text-foreground"
            >
              ← S{prev.season_number}
            </Link>
          )}
          {next && (
            <Link
              href={`/tv/${showId}/season/${next.season_number}`}
              className="rounded-lg border border-border bg-surface px-2.5 py-1 text-muted transition-colors hover:text-foreground"
            >
              S{next.season_number} →
            </Link>
          )}
        </div>
      </div>
      {season.overview && (
        <p className="mb-6 text-sm leading-relaxed text-muted">
          {season.overview}
        </p>
      )}

      <EpisodeList
        showTmdbId={showId}
        seasonNumber={seasonNum}
        episodes={episodes}
        watchedEpisodes={watchedEpisodes}
        snapshot={snapshot}
      />
    </div>
  );
}
