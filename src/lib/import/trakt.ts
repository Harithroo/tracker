import type {
  EpisodeImportItem,
  ImportItem,
  MovieImportItem,
  ShowImportItem,
} from "./types";

interface TraktIds {
  tmdb?: number;
  imdb?: string;
  tvdb?: number;
}

/**
 * Parses a Trakt account export (the zip from trakt.tv/settings/data).
 * watched-shows.json and watched-movies-N.json give the library, and
 * watched-history-N.json the individual plays. Exports vary: some ship the
 * season breakdown inside watched-shows.json, others only list the show there
 * and leave every episode number to the history files, so both are read and
 * merged.
 */
export function parseTrakt(files: Map<string, string>): ImportItem[] {
  const read = <T>(name: string): T | null => {
    const text = files.get(name);
    return text ? (JSON.parse(text) as T) : null;
  };
  const paginated = (prefix: string) =>
    [...files.keys()]
      .filter((n) => new RegExp(`^${prefix}-\\d+\\.json$`).test(n))
      .sort();

  const movies = new Map<string, MovieImportItem>();
  const shows = new Map<string, ShowImportItem>();
  const mediaKey = (ids: TraktIds, title: string) =>
    ids.tmdb ? `tmdb:${ids.tmdb}` : ids.imdb ? `imdb:${ids.imdb}` : `title:${title}`;

  // --- watched movies (paginated) -------------------------------------------
  for (const name of paginated("watched-movies")) {
    for (const entry of read<TraktWatchedMovie[]>(name) ?? []) {
      const m = entry.movie;
      movies.set(mediaKey(m.ids, m.title), {
        kind: "movie",
        tmdbId: m.ids.tmdb,
        imdbId: m.ids.imdb,
        title: m.title,
        year: m.year ?? null,
        watchedAt: entry.last_watched_at ?? null,
      });
    }
  }

  // --- watched shows ----------------------------------------------------------
  const showEpisodes = new Map<string, Map<string, EpisodeImportItem>>();
  /** Keeps the earliest watch per season/episode across both sources. */
  const addEpisode = (key: string, season: number, episode: number, watchedAt?: string | null) => {
    let byNumber = showEpisodes.get(key);
    if (!byNumber) showEpisodes.set(key, (byNumber = new Map()));
    const slot = `${season}:${episode}`;
    const existing = byNumber.get(slot);
    if (existing && (!watchedAt || (existing.watchedAt && existing.watchedAt <= watchedAt))) return;
    byNumber.set(slot, { season, episode, watchedAt: watchedAt ?? null });
  };

  const registerShow = (s: TraktMedia) => {
    const key = mediaKey(s.ids, s.title);
    if (!shows.has(key)) {
      shows.set(key, {
        kind: "show",
        tmdbId: s.ids.tmdb,
        tvdbId: s.ids.tvdb,
        imdbId: s.ids.imdb,
        title: s.title,
        year: s.year ?? null,
        episodes: [],
      });
    }
    return key;
  };

  for (const entry of read<TraktWatchedShow[]>("watched-shows.json") ?? []) {
    const key = registerShow(entry.show);
    for (const season of entry.seasons ?? []) {
      for (const ep of season.episodes ?? []) {
        addEpisode(key, season.number, ep.number, ep.last_watched_at);
      }
    }
  }

  // --- play history (paginated) ----------------------------------------------
  // The only place episode numbers appear in exports whose watched-shows.json
  // carries no season breakdown. Movie plays here back-fill anything the
  // aggregated movie pages missed.
  for (const name of paginated("watched-history")) {
    for (const entry of read<TraktHistoryEntry[]>(name) ?? []) {
      if (entry.type === "episode" && entry.show && entry.episode) {
        const { season, number } = entry.episode;
        if (typeof season !== "number" || typeof number !== "number") continue;
        addEpisode(registerShow(entry.show), season, number, entry.watched_at);
      } else if (entry.type === "movie" && entry.movie) {
        const m = entry.movie;
        const key = mediaKey(m.ids, m.title);
        const existing = movies.get(key);
        if (existing?.watchedAt) continue;
        movies.set(key, {
          ...existing,
          kind: "movie",
          tmdbId: m.ids.tmdb,
          imdbId: m.ids.imdb,
          title: m.title,
          year: m.year ?? null,
          watchedAt: entry.watched_at ?? null,
        });
      }
    }
  }

  for (const [key, byNumber] of showEpisodes) {
    const show = shows.get(key);
    if (show) show.episodes = [...byNumber.values()];
  }

  // --- watchlist --------------------------------------------------------------
  for (const entry of read<TraktWatchlistEntry[]>("lists-watchlist.json") ?? []) {
    if (entry.type === "movie" && entry.movie) {
      const key = mediaKey(entry.movie.ids, entry.movie.title);
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
      const key = mediaKey(entry.show.ids, entry.show.title);
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
    const key = mediaKey(entry.movie.ids, entry.movie.title);
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
    const existing = shows.get(mediaKey(entry.show.ids, entry.show.title));
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
  /** Absent in exports that only list the show; episodes come from history. */
  seasons?: {
    number: number;
    episodes?: { number: number; last_watched_at?: string }[];
  }[];
}
interface TraktHistoryEntry {
  watched_at?: string;
  type: "episode" | "movie" | string;
  episode?: { season?: number; number?: number };
  show?: TraktMedia;
  movie?: TraktMedia;
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
