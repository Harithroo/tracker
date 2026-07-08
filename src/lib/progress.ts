import type { EpisodeToAir, SeasonSummary } from "@/lib/tmdb/types";

export function episodeKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

function regularSeasons(seasons: SeasonSummary[]): SeasonSummary[] {
  return seasons
    .filter((s) => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);
}

/**
 * First episode (specials excluded) not in the watched set, walking seasons in
 * order — the "up next" episode.
 */
export function nextEpisode(
  seasons: SeasonSummary[],
  watched: Set<string>
): { season: number; episode: number } | null {
  for (const season of regularSeasons(seasons)) {
    for (let ep = 1; ep <= season.episode_count; ep++) {
      if (!watched.has(episodeKey(season.season_number, ep))) {
        return { season: season.season_number, episode: ep };
      }
    }
  }
  return null;
}

/**
 * Like nextEpisode, but only counts episodes that have aired (everything up to
 * and including last_episode_to_air; specials excluded). Returns null when the
 * viewer is fully caught up with what's aired.
 */
export function nextAiredEpisode(
  seasons: SeasonSummary[],
  lastAired: EpisodeToAir | null,
  watched: Set<string>
): { season: number; episode: number } | null {
  if (!lastAired || lastAired.season_number < 1) return null;
  for (const season of regularSeasons(seasons)) {
    if (season.season_number > lastAired.season_number) break;
    const cap =
      season.season_number === lastAired.season_number
        ? Math.min(season.episode_count, lastAired.episode_number)
        : season.episode_count;
    for (let ep = 1; ep <= cap; ep++) {
      if (!watched.has(episodeKey(season.season_number, ep))) {
        return { season: season.season_number, episode: ep };
      }
    }
  }
  return null;
}

/** Number of regular (non-special) episodes that have aired so far. */
export function airedEpisodeCount(
  seasons: SeasonSummary[],
  lastAired: EpisodeToAir | null
): number {
  if (!lastAired || lastAired.season_number < 1) return 0;
  let count = 0;
  for (const season of regularSeasons(seasons)) {
    if (season.season_number > lastAired.season_number) break;
    count +=
      season.season_number === lastAired.season_number
        ? Math.min(season.episode_count, lastAired.episode_number)
        : season.episode_count;
  }
  return count;
}

/** TMDB show statuses that mean no more episodes are coming. */
export function isShowEnded(status: string | null | undefined): boolean {
  return status === "Ended" || status === "Canceled";
}
