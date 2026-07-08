export interface TmdbListResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface TmdbSearchResult {
  id: number;
  media_type?: "movie" | "tv" | "person";
  title?: string; // movies
  name?: string; // tv
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  release_date?: string; // movies
  first_air_date?: string; // tv
  vote_average: number;
  genre_ids?: number[];
}

export interface Genre {
  id: number;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface Video {
  key: string;
  site: string;
  type: string;
  name: string;
  official: boolean;
}

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

interface WithAppends {
  credits: { cast: CastMember[] };
  videos: { results: Video[] };
  recommendations: TmdbListResponse<TmdbSearchResult>;
  "watch/providers": {
    results: Record<string, { link?: string; flatrate?: WatchProvider[] }>;
  };
}

export interface MovieDetails extends WithAppends {
  id: number;
  title: string;
  overview: string;
  tagline: string;
  poster_path: string | null;
  backdrop_path: string | null;
  runtime: number | null;
  genres: Genre[];
  release_date: string;
  vote_average: number;
}

export interface SeasonSummary {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  episode_count: number;
  poster_path: string | null;
  air_date: string | null;
}

export interface EpisodeToAir {
  id: number;
  season_number: number;
  episode_number: number;
  name: string;
  air_date: string | null;
}

export interface ShowDetails extends WithAppends {
  id: number;
  name: string;
  overview: string;
  tagline: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: Genre[];
  first_air_date: string | null;
  last_air_date: string | null;
  number_of_episodes: number;
  number_of_seasons: number;
  episode_run_time: number[];
  vote_average: number;
  status: string;
  seasons: SeasonSummary[];
  last_episode_to_air: EpisodeToAir | null;
  next_episode_to_air: EpisodeToAir | null;
}

export interface Episode {
  id: number;
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
}

export interface SeasonDetails {
  id: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  poster_path: string | null;
  episodes: Episode[];
}
