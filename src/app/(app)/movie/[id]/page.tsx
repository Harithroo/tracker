import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMovie } from "@/lib/tmdb/client";
import { formatRuntime, yearOf } from "@/lib/utils";
import type { MediaSnapshot } from "@/types/library";
import { DetailsHero, pickTrailer } from "@/components/media/DetailsHero";
import { CastRow } from "@/components/media/CastRow";
import { MediaRow, RowItem } from "@/components/media/MediaRow";
import { PosterCard } from "@/components/media/PosterCard";
import { LibraryControls } from "@/components/library/LibraryControls";

export default async function MoviePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const movieId = Number(id);
  if (!Number.isInteger(movieId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [movie, itemResult] = await Promise.all([
    getMovie(movieId).catch(() => null),
    supabase
      .from("library_items")
      .select("status, rating, favorite, notes")
      .eq("user_id", user!.id)
      .eq("tmdb_id", movieId)
      .eq("media_type", "movie")
      .maybeSingle(),
  ]);
  if (!movie) notFound();

  const snapshot: MediaSnapshot = {
    title: movie.title,
    posterPath: movie.poster_path,
    releaseYear: yearOf(movie.release_date),
    runtimeMinutes: movie.runtime,
    genreIds: movie.genres.map((g) => g.id),
    totalEpisodes: null,
  };

  const recommendations = movie.recommendations?.results?.slice(0, 12) ?? [];

  return (
    <div className="space-y-10">
      <DetailsHero
        title={movie.title}
        tagline={movie.tagline}
        overview={movie.overview}
        posterPath={movie.poster_path}
        backdropPath={movie.backdrop_path}
        meta={[
          String(yearOf(movie.release_date) ?? ""),
          formatRuntime(movie.runtime),
          movie.vote_average ? `★ ${movie.vote_average.toFixed(1)}` : null,
        ]}
        genres={movie.genres}
        trailer={pickTrailer(movie.videos?.results ?? [])}
        providers={movie["watch/providers"]?.results?.US?.flatrate ?? []}
      >
        <LibraryControls
          tmdbId={movieId}
          mediaType="movie"
          snapshot={snapshot}
          item={itemResult.data}
        />
      </DetailsHero>

      <CastRow cast={movie.credits?.cast ?? []} />

      {recommendations.length > 0 && (
        <MediaRow title="More Like This">
          {recommendations.map((rec) => (
            <RowItem key={rec.id}>
              <PosterCard
                href={`/movie/${rec.id}`}
                posterPath={rec.poster_path}
                title={rec.title ?? ""}
                subtitle={String(yearOf(rec.release_date) ?? "")}
              />
            </RowItem>
          ))}
        </MediaRow>
      )}
    </div>
  );
}
