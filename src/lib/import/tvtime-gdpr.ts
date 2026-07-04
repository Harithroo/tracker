import { parseCsv } from "./csv";
import type { ImportItem, MovieImportItem, ShowImportItem } from "./types";

/**
 * Parses a TV Time GDPR export zip.
 *
 * Ground truth lives in the tracking event log:
 * - tracking-prod-records-v2.csv — one row per episode watch, with the TVDB
 *   show id (s_id), season/episode numbers and timestamps
 * - tracking-prod-records.csv    — movie follow/watch/towatch events (name +
 *   year only — no external ids, so movies resolve via TMDB search)
 * - user_show_special_status.csv — "for later" (watchlist) shows
 *
 * Note: TV Time uses TVDB numbering, which occasionally differs from TMDB
 * (mostly anime) — a handful of episodes may not map. The Trakt export is the
 * better source when available.
 */
export function parseTvTimeGdpr(files: Map<string, string>): ImportItem[] {
  const csv = (name: string) => {
    const text = files.get(name);
    return text ? parseCsv(text) : [];
  };

  const shows = new Map<number, ShowImportItem>();

  // Episode watches (dedupe on show+season+episode, keep earliest timestamp)
  const seen = new Map<string, { season: number; episode: number; watchedAt: string }>();
  for (const r of csv("tracking-prod-records-v2.csv")) {
    if (!r.episode_id || !r.s_id || r.season_number === "" || r.episode_number === "") continue;
    const tvdbId = Number(r.s_id);
    if (!shows.has(tvdbId)) {
      shows.set(tvdbId, {
        kind: "show",
        tvdbId,
        title: r.series_name || `TVDB ${tvdbId}`,
        episodes: [],
      });
    }
    const season = Number(r.season_number);
    const episode = Number(r.episode_number);
    const watchedAt = r.created_at ? r.created_at.replace(" ", "T") + "Z" : "";
    const key = `${tvdbId}:${season}:${episode}`;
    const existing = seen.get(key);
    if (!existing || (watchedAt && watchedAt < existing.watchedAt)) {
      seen.set(key, { season, episode, watchedAt });
    }
  }
  for (const [key, ep] of seen) {
    const tvdbId = Number(key.split(":")[0]);
    shows.get(tvdbId)!.episodes.push({
      season: ep.season,
      episode: ep.episode,
      watchedAt: ep.watchedAt || null,
    });
  }

  // Archived shows → on hold
  for (const r of csv("tracking-prod-records-v2.csv")) {
    if ((r.is_archived === "true" || r.is_archived === "1") && r.s_id) {
      const show = shows.get(Number(r.s_id));
      if (show) show.archived = true;
    }
  }

  // "For later" shows → watchlist
  for (const r of csv("user_show_special_status.csv")) {
    if (r.status !== "for_later" || !r.tv_show_id) continue;
    const tvdbId = Number(r.tv_show_id);
    if (!shows.has(tvdbId)) {
      shows.set(tvdbId, {
        kind: "show",
        tvdbId,
        title: r.tv_show_name || `TVDB ${tvdbId}`,
        watchlist: true,
        episodes: [],
      });
    }
  }

  // Movies: watch + towatch events (name/year only)
  const movies = new Map<string, MovieImportItem>();
  for (const r of csv("tracking-prod-records.csv")) {
    if (r.type !== "watch" && r.type !== "towatch") continue;
    if (!r.movie_name) continue;
    const year = r.release_date ? Number(r.release_date.slice(0, 4)) || null : null;
    const key = r.uuid || `${r.movie_name}:${year}`;
    const watched = r.type === "watch";
    const existing = movies.get(key);
    if (existing && existing.watchedAt) continue; // keep the watch over towatch
    movies.set(key, {
      kind: "movie",
      title: r.movie_name,
      year,
      watchedAt: watched ? (r.created_at ? r.created_at.replace(" ", "T") + "Z" : null) : null,
      watchlist: !watched,
    });
  }

  return [...shows.values(), ...movies.values()];
}
