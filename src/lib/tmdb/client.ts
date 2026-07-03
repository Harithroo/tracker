import "server-only";
import type {
  MovieDetails,
  SeasonDetails,
  ShowDetails,
  TmdbListResponse,
  TmdbSearchResult,
} from "./types";

const TMDB_BASE = "https://api.themoviedb.org/3";
const HOUR = 60 * 60;
const DAY = 24 * HOUR;

async function tmdb<T>(
  path: string,
  {
    params = {},
    revalidate = DAY,
  }: { params?: Record<string, string>; revalidate?: number } = {}
): Promise<T> {
  const token = process.env.TMDB_API_TOKEN;
  if (!token) {
    throw new Error(
      "TMDB is not configured. Add TMDB_API_TOKEN to .env.local (see README)."
    );
  }

  const url = new URL(TMDB_BASE + path);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    next: { revalidate },
  });

  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}): ${path}`);
  }
  return res.json();
}

export function searchMulti(query: string, page = 1) {
  return tmdb<TmdbListResponse<TmdbSearchResult>>("/search/multi", {
    params: { query, page: String(page), include_adult: "false" },
    revalidate: HOUR,
  });
}

export function getMovie(id: number) {
  return tmdb<MovieDetails>(`/movie/${id}`, {
    params: { append_to_response: "credits,videos,recommendations,watch/providers" },
  });
}

export function getShow(id: number) {
  return tmdb<ShowDetails>(`/tv/${id}`, {
    params: { append_to_response: "credits,videos,recommendations,watch/providers" },
  });
}

export function getSeason(showId: number, seasonNumber: number) {
  return tmdb<SeasonDetails>(`/tv/${showId}/season/${seasonNumber}`);
}

export function getTrending(type: "movie" | "tv") {
  return tmdb<TmdbListResponse<TmdbSearchResult>>(`/trending/${type}/week`, {
    revalidate: 12 * HOUR,
  });
}
