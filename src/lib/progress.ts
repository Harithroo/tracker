import type { Episode, EpisodeToAir, SeasonSummary } from "@/lib/tmdb/types";

export function episodeKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

function regularSeasons(seasons: SeasonSummary[]): SeasonSummary[] {
  return seasons
    .filter((s) => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);
}

/** Watched episodes excluding specials — specials aren't part of show progress. */
function regularWatchedCount(watched: Set<string>): number {
  let count = 0;
  for (const key of watched) if (!key.startsWith("0:")) count++;
  return count;
}

/**
 * One aired regular episode, in air order.
 *
 * `episode` assumes the common 1..episode_count numbering; long-running anime
 * (One Piece and friends) number episodes absolutely across seasons instead, so
 * `indexInSeason` — the position inside the season, which holds under either
 * scheme — is what actually identifies the episode. Resolve it against the
 * season's real episode list with `resolveSlotEpisode`.
 */
export interface EpisodeSlot {
  season: number;
  episode: number;
  indexInSeason: number;
}

/** Every regular episode that has aired so far, in order. */
function airedSlots(
  seasons: SeasonSummary[],
  lastAired: EpisodeToAir | null
): EpisodeSlot[] {
  if (!lastAired || lastAired.season_number < 1) return [];
  const slots: EpisodeSlot[] = [];
  for (const season of regularSeasons(seasons)) {
    if (season.season_number > lastAired.season_number) break;
    let cap = season.episode_count;
    if (season.season_number === lastAired.season_number) {
      // Under absolute numbering the last-aired episode number counts from the
      // start of the show, so subtract what came before to get its position.
      const aired =
        lastAired.episode_number > season.episode_count
          ? lastAired.episode_number - slots.length
          : lastAired.episode_number;
      cap = Math.max(0, Math.min(season.episode_count, aired));
    }
    for (let ep = 1; ep <= cap; ep++) {
      slots.push({ season: season.season_number, indexInSeason: ep - 1, episode: ep });
    }
  }
  return slots;
}

/**
 * The "up next" episode: the first aired regular episode the viewer hasn't
 * watched, or null once they're caught up with everything that has aired.
 *
 * Matching on season/episode keys alone isn't enough — imported histories carry
 * the source's numbering (TVDB, absolute) which can disagree with TMDB's season
 * split, and every key then looks unwatched. So progress is anchored on how many
 * episodes have been logged: a viewer with as many watches as there are aired
 * episodes is caught up regardless of how those episodes are numbered, and the
 * search for the next one starts at that position rather than at episode one.
 */
export function nextAiredEpisode(
  seasons: SeasonSummary[],
  lastAired: EpisodeToAir | null,
  watched: Set<string>
): EpisodeSlot | null {
  const slots = airedSlots(seasons, lastAired);
  if (slots.length === 0) return null;

  const progress = Math.min(regularWatchedCount(watched), slots.length);
  if (progress >= slots.length) return null;

  const unwatched = (slot: EpisodeSlot) => !watched.has(episodeKey(slot.season, slot.episode));
  // Ahead of the viewer's progress first, so a deliberately skipped episode
  // doesn't pin "up next" to a gap they've already moved past.
  return slots.slice(progress).find(unwatched) ?? slots.find(unwatched) ?? null;
}

/**
 * Pairs a slot with the real episode from a fetched season — by episode number
 * when the season uses per-season numbering, by position when it doesn't.
 */
export function resolveSlotEpisode(
  episodes: Episode[],
  slot: EpisodeSlot
): Episode | null {
  return (
    episodes.find((ep) => ep.episode_number === slot.episode) ??
    episodes[slot.indexInSeason] ??
    null
  );
}

/** Number of regular (non-special) episodes that have aired so far. */
export function airedEpisodeCount(
  seasons: SeasonSummary[],
  lastAired: EpisodeToAir | null
): number {
  return airedSlots(seasons, lastAired).length;
}

/** TMDB show statuses that mean no more episodes are coming. */
export function isShowEnded(status: string | null | undefined): boolean {
  return status === "Ended" || status === "Canceled";
}
