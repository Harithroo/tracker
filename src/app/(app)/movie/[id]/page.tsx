import { notFound } from "next/navigation";
import { requireUser } from "@/lib/firebase/admin";
import { libraryItems } from "@/lib/mongo/client";
import { getMovie } from "@/lib/tmdb/client";
import { formatRuntime, yearOf } from "@/lib/utils";
import type { MediaSnapshot, WatchStatus } from "@/types/library";
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

  const { id: userId } = await requireUser();
  const items = await libraryItems();

  const [movie, item] = await Promise.all([
    getMovie(movieId).catch(() => null),
    items.findOne(
      { user_id: userId, tmdb_id: movieId, media_type: "movie" },
      { projection: { status: 1, rating: 1, favorite: 1, notes: 1, _id: 0 } }
    ),
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

  // Library status for the recommendation cards' indicators/quick menus
  const recStatus = new Map<number, WatchStatus>();
  if (recommendations.length > 0) {
    const rows = await items
      .find({
        user_id: userId,
        media_type: "movie",
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
          item={item}
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
                quick={{
                  tmdbId: rec.id,
                  mediaType: "movie",
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
