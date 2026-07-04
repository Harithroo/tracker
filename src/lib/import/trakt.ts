import type { ImportItem, MovieImportItem, ShowImportItem } from "./types";

interface TraktIds {
  tmdb?: number;
  imdb?: string;
  tvdb?: number;
}

/**
 * Parses a Trakt account export (the zip from trakt.tv/settings/data).
 * Uses the aggregated files — watched-shows.json has every episode watch with
 * TMDB-native numbering, watched-movies-N.json every movie play.
 */
export function parseTrakt(files: Map<string, string>): ImportItem[] {
  const read = <T>(name: string): T | null => {
    const text = files.get(name);
    return text ? (JSON.parse(text) as T) : null;
  };

  const movies = new Map<string, MovieImportItem>();
  const shows = new Map<string, ShowImportItem>();
  const movieKey = (ids: TraktIds, title: string) =>
    ids.tmdb ? `tmdb:${ids.tmdb}` : ids.imdb ? `imdb:${ids.imdb}` : `title:${title}`;

  // --- watched movies (paginated) -------------------------------------------
  for (const name of [...files.keys()].filter((n) => /^watched-movies-\d+\.json$/.test(n))) {
    for (const entry of read<TraktWatchedMovie[]>(name) ?? []) {
      const m = entry.movie;
      movies.set(movieKey(m.ids, m.title), {
        kind: "movie",
        tmdbId: m.ids.tmdb,
        imdbId: m.ids.imdb,
        title: m.title,
        year: m.year ?? null,
        watchedAt: entry.last_watched_at ?? null,
      });
    }
  }

  // --- watched shows with per-episode watches --------------------------------
  for (const entry of read<TraktWatchedShow[]>("watched-shows.json") ?? []) {
    const s = entry.show;
    shows.set(movieKey(s.ids, s.title), {
      kind: "show",
      tmdbId: s.ids.tmdb,
      tvdbId: s.ids.tvdb,
      imdbId: s.ids.imdb,
      title: s.title,
      year: s.year ?? null,
      episodes: entry.seasons.flatMap((season) =>
        season.episodes.map((ep) => ({
          season: season.number,
          episode: ep.number,
          watchedAt: ep.last_watched_at ?? null,
        }))
      ),
    });
  }

  // --- watchlist --------------------------------------------------------------
  for (const entry of read<TraktWatchlistEntry[]>("lists-watchlist.json") ?? []) {
    if (entry.type === "movie" && entry.movie) {
      const key = movieKey(entry.movie.ids, entry.movie.title);
      if (!movies.has(key)) {
        movies.set(key, {
          kind: "movie",
          tmdbId: entry.movie.ids.tmdb,
          imdbId: entry.movie.ids.imdb,
          title: entry.movie.title,
          year: entry.movie.year ?? null,
          watchlist: true,
        });
      }
    } else if (entry.type === "show" && entry.show) {
      const key = movieKey(entry.show.ids, entry.show.title);
      if (!shows.has(key)) {
        shows.set(key, {
          kind: "show",
          tmdbId: entry.show.ids.tmdb,
          tvdbId: entry.show.ids.tvdb,
          title: entry.show.title,
          year: entry.show.year ?? null,
          watchlist: true,
          episodes: [],
        });
      }
    }
  }

  // --- ratings -----------------------------------------------------------------
  for (const entry of read<TraktRating[]>("ratings-movies.json") ?? []) {
    if (!entry.movie) continue;
    const key = movieKey(entry.movie.ids, entry.movie.title);
    const existing = movies.get(key);
    if (existing) existing.rating = entry.rating;
    else
      movies.set(key, {
        kind: "movie",
        tmdbId: entry.movie.ids.tmdb,
        imdbId: entry.movie.ids.imdb,
        title: entry.movie.title,
        year: entry.movie.year ?? null,
        watchedAt: entry.rated_at ?? null, // rated implies seen
        rating: entry.rating,
      });
  }
  for (const entry of read<TraktRating[]>("ratings-shows.json") ?? []) {
    if (!entry.show) continue;
    const existing = shows.get(movieKey(entry.show.ids, entry.show.title));
    if (existing) existing.rating = entry.rating;
  }

  return [...shows.values(), ...movies.values()];
}

interface TraktMedia {
  title: string;
  year?: number;
  ids: TraktIds;
}
interface TraktWatchedMovie {
  last_watched_at?: string;
  movie: TraktMedia;
}
interface TraktWatchedShow {
  show: TraktMedia;
  seasons: {
    number: number;
    episodes: { number: number; last_watched_at?: string }[];
  }[];
}
interface TraktWatchlistEntry {
  type: "movie" | "show" | string;
  movie?: TraktMedia;
  show?: TraktMedia;
}
interface TraktRating {
  rating: number;
  rated_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
}
