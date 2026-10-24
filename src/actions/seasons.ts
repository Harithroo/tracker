"use server";

import { requireUser } from "@/lib/firebase/admin";
import { getSeason } from "@/lib/tmdb/client";
import { isAired } from "@/lib/utils";
import type { EpisodeRow } from "@/components/library/EpisodeList";

/**
 * A season's episode list. Watch state deliberately isn't included — the page
 * already renders every season's watches, and that copy stays current.
 */
export async function getSeasonEpisodes(
  showTmdbId: number,
  seasonNumber: number
): Promise<EpisodeRow[]> {
  await requireUser();

  const season = await getSeason(showTmdbId, seasonNumber);
  return season.episodes.map((ep) => ({
    episodeNumber: ep.episode_number,
    name: ep.name,
    airDate: ep.air_date,
    runtimeMinutes: ep.runtime,
    aired: isAired(ep.air_date),
  }));
}
