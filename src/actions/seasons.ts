"use server";

import { createClient } from "@/lib/supabase/server";
import { getSeason } from "@/lib/tmdb/client";
import { isAired } from "@/lib/utils";
import type { EpisodeRow } from "@/components/library/EpisodeList";

export async function getSeasonEpisodes(
  showTmdbId: number,
  seasonNumber: number
): Promise<{ episodes: EpisodeRow[]; watchedEpisodes: number[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const [season, watchedResult] = await Promise.all([
    getSeason(showTmdbId, seasonNumber),
    supabase
      .from("episode_watches")
      .select("episode_number")
      .eq("user_id", user.id)
      .eq("tmdb_show_id", showTmdbId)
      .eq("season_number", seasonNumber),
  ]);

  const episodes: EpisodeRow[] = season.episodes.map((ep) => ({
    episodeNumber: ep.episode_number,
    name: ep.name,
    airDate: ep.air_date,
    runtimeMinutes: ep.runtime,
    aired: isAired(ep.air_date),
  }));
  const watchedEpisodes = (watchedResult.data ?? []).map((row) => row.episode_number);

  return { episodes, watchedEpisodes };
}
