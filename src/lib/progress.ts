import type { SeasonSummary } from "@/lib/tmdb/types";

export function episodeKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

/**
 * First episode (specials excluded) not in the watched set, walking seasons in
 * order — the "up next" episode.
 */
export function nextEpisode(
  seasons: SeasonSummary[],
  watched: Set<string>
): { season: number; episode: number } | null {
  const regular = seasons
    .filter((s) => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);

  for (const season of regular) {
    for (let ep = 1; ep <= season.episode_count; ep++) {
      if (!watched.has(episodeKey(season.season_number, ep))) {
        return { season: season.season_number, episode: ep };
      }
    }
  }
  return null;
}
