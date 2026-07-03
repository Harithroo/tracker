// Fetches per-episode watch state for every followed show in the TV Time
// export produced by tvtime-export.mjs.
//
// Usage:  node scripts/tvtime-export-episodes.mjs <tokenFile>
// Reads:  tvtime-export/sidecar-follows-series.json
// Writes: tvtime-export/shows-episodes.json

import { readFileSync, writeFileSync } from "node:fs";

const tokenFile = process.argv[2];
if (!tokenFile) {
  console.error("Usage: node scripts/tvtime-export-episodes.mjs <tokenFile>");
  process.exit(1);
}
const token = readFileSync(tokenFile, "utf8").trim();

const follows = JSON.parse(
  readFileSync("tvtime-export/sidecar-follows-series.json", "utf8")
);
const shows = follows.data.objects
  .filter((o) => o.meta?.id)
  .map((o) => ({
    tvdbId: o.meta.id,
    name: o.meta.name,
    followedAt: o.created_at,
  }));
console.log(`Fetching episodes for ${shows.length} shows…`);

const sidecar = (t) =>
  "https://app.tvtime.com/sidecar?o=" + encodeURIComponent(t);
const FIELDS =
  "id,name,seasons.fields(number,episodes.fields(number,season_number,is_watched,watched_date,air_date,is_special))";

async function fetchShow(show, attempt = 1) {
  const url = `https://api2.tozelabs.com/v2/show/${show.tvdbId}?fields=${FIELDS}`;
  try {
    const res = await fetch(sidecar(url), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const episodes = (data.seasons ?? []).flatMap((s) => s.episodes ?? []);
    return {
      ...show,
      totalEpisodes: episodes.length,
      watched: episodes
        .filter((e) => e.is_watched)
        .map((e) => ({
          season: e.season_number,
          episode: e.number,
          watchedDate: e.watched_date,
          isSpecial: e.is_special ?? false,
        })),
    };
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      return fetchShow(show, attempt + 1);
    }
    console.error(`  FAILED ${show.name} (${show.tvdbId}): ${err.message}`);
    return { ...show, error: err.message, watched: [] };
  }
}

const CONCURRENCY = 5;
const results = [];
let done = 0;
for (let i = 0; i < shows.length; i += CONCURRENCY) {
  const batch = await Promise.all(shows.slice(i, i + CONCURRENCY).map((s) => fetchShow(s)));
  results.push(...batch);
  done += batch.length;
  if (done % 25 < CONCURRENCY) console.log(`  ${done}/${shows.length}…`);
}

writeFileSync("tvtime-export/shows-episodes.json", JSON.stringify(results, null, 1));

const withWatches = results.filter((r) => r.watched.length > 0);
const totalWatched = results.reduce((n, r) => n + r.watched.length, 0);
const failed = results.filter((r) => r.error);
console.log(
  `\nDone: ${results.length} shows, ${withWatches.length} with watches, ${totalWatched} watched episodes, ${failed.length} failed.`
);
if (failed.length) console.log("Failed:", failed.map((f) => f.name).join(", "));
