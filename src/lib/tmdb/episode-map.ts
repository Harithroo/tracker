import type { Episode, SeasonDetails } from "./types";

/**
 * Lookup tables over a show's TMDB episodes, used to translate episode numbers
 * that came from somewhere else — a TVDB-based import, or an older season split
 * — onto the numbering TMDB uses today.
 */
export interface EpisodeIndex {
  /** "season:episode" → episode, for numbers that already match TMDB. */
  byKey: Map<string, Episode>;
  /** "season:index" (0-based position inside the season) → episode. */
  bySeasonPosition: Map<string, Episode>;
  /** Episode numbers that occur exactly once across all regular seasons. */
  byUniqueNumber: Map<number, Episode>;
  /** Regular episodes in air order — position N is the (N+1)th episode ever. */
  order: Episode[];
  /** Episodes in the largest regular season. */
  maxSeasonSize: number;
}

export function buildEpisodeIndex(seasons: SeasonDetails[]): EpisodeIndex {
  const byKey = new Map<string, Episode>();
  const bySeasonPosition = new Map<string, Episode>();
  const byNumber = new Map<number, Episode[]>();
  const order: Episode[] = [];
  let maxSeasonSize = 0;

  const ordered = [...seasons].sort((a, b) => a.season_number - b.season_number);
  for (const season of ordered) {
    const episodes = [...season.episodes]
      .sort((a, b) => a.episode_number - b.episode_number)
      // The season endpoint is the authority on which season an episode is in.
      .map((ep) => ({ ...ep, season_number: season.season_number }));

    episodes.forEach((ep, position) => {
      byKey.set(`${season.season_number}:${ep.episode_number}`, ep);
      bySeasonPosition.set(`${season.season_number}:${position}`, ep);
    });

    if (season.season_number > 0) {
      maxSeasonSize = Math.max(maxSeasonSize, episodes.length);
      for (const ep of episodes) {
        order.push(ep);
        const sameNumber = byNumber.get(ep.episode_number);
        if (sameNumber) sameNumber.push(ep);
        else byNumber.set(ep.episode_number, [ep]);
      }
    }
  }

  const byUniqueNumber = new Map<number, Episode>();
  for (const [number, episodes] of byNumber) {
    if (episodes.length === 1) byUniqueNumber.set(number, episodes[0]);
  }

  return { byKey, bySeasonPosition, byUniqueNumber, order, maxSeasonSize };
}

/**
 * Finds the TMDB episode a foreign (season, episode) pair refers to.
 *
 * Most numbering already matches and resolves on the first lookup. The rest
 * comes down to two ways a source can disagree with TMDB: it numbers episodes
 * from 1 inside each season where TMDB numbers them absolutely across the whole
 * show (One Piece and other long-running anime), or the other way round. The
 * absolute-numbering fallbacks only apply to numbers too large to be a position
 * inside any season — otherwise a season TMDB has since resized would quietly
 * map onto an unrelated early episode. Returns null when nothing fits, which is
 * the honest answer for an episode TMDB doesn't have.
 */
export function mapToTmdbEpisode(
  index: EpisodeIndex,
  season: number,
  episode: number
): Episode | null {
  const exact = index.byKey.get(`${season}:${episode}`);
  if (exact) return exact;
  if (season <= 0) return null; // specials: no ordering to fall back on

  const positional = index.bySeasonPosition.get(`${season}:${episode - 1}`);
  if (positional) return positional;

  if (episode > index.maxSeasonSize) {
    return index.byUniqueNumber.get(episode) ?? index.order[episode - 1] ?? null;
  }
  return null;
}
