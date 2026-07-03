// Maps the TV Time export to TMDB and generates SQL insert batches for the
// tracker database.
//
// Usage:  node scripts/tvtime-import.mjs <userId>
// Reads:  tvtime-export/sidecar-follows-movies.json
//         tvtime-export/shows-episodes.json
//         .env.local (TMDB_API_TOKEN)
// Writes: tvtime-import/import-NNN.sql   (batched, idempotent inserts)
//         tvtime-import/report.json      (unmatched/skipped entries)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: node scripts/tvtime-import.mjs <userId>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const TMDB_TOKEN = env.TMDB_API_TOKEN;
if (!TMDB_TOKEN) throw new Error("TMDB_API_TOKEN missing from .env.local");

// ---------------------------------------------------------------------------
// TMDB helpers (throttled)
// ---------------------------------------------------------------------------
let inFlight = 0;
const queue = [];
async function tmdb(path, params = {}) {
  if (inFlight >= 8) await new Promise((r) => queue.push(r));
  inFlight++;
  try {
    const url = new URL("https://api.themoviedb.org/3" + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: "application/json" },
      });
      if (res.status === 429 && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`TMDB ${res.status} ${path}`);
      return res.json();
    }
  } finally {
    inFlight--;
    queue.shift()?.();
  }
}

const report = { moviesUnmatched: [], showsUnmatched: [], episodeAnomalies: [] };

// ---------------------------------------------------------------------------
// SQL generation helpers
// ---------------------------------------------------------------------------
const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const num = (n) => (n === null || n === undefined || Number.isNaN(n) ? "null" : String(n));
const dateOf = (ts) => (ts ? String(ts).slice(0, 10) : null);
const tsOf = (ts) => {
  if (!ts) return null;
  const s = String(ts).replace(" ", "T");
  return s.endsWith("Z") ? s : s + "Z"; // TV Time timestamps are UTC
};

const libraryRows = [];
const episodeRows = [];
const libraryRowsJson = [];
const episodeRowsJson = [];

function addLibraryRow(r) {
  libraryRowsJson.push({
    user_id: userId,
    tmdb_id: r.tmdbId,
    media_type: r.mediaType,
    status: r.status,
    started_at: r.startedAt,
    finished_at: r.finishedAt,
    title: r.title,
    poster_path: r.posterPath,
    release_year: r.releaseYear,
    runtime_minutes: r.runtimeMinutes,
    genre_ids: r.genreIds ?? [],
    total_episodes: r.totalEpisodes,
    created_at: tsOf(r.createdAt),
  });
  libraryRows.push(
    `(${q(userId)},${num(r.tmdbId)},${q(r.mediaType)},${q(r.status)},${q(r.startedAt)},${q(
      r.finishedAt
    )},${q(r.title)},${q(r.posterPath)},${num(r.releaseYear)},${num(r.runtimeMinutes)},` +
      `'{${(r.genreIds ?? []).join(",")}}',${num(r.totalEpisodes)},${q(tsOf(r.createdAt))})`
  );
}

// ---------------------------------------------------------------------------
// Movies
// ---------------------------------------------------------------------------
const moviesRaw = JSON.parse(readFileSync("tvtime-export/sidecar-follows-movies.json", "utf8"))
  .data.objects;

console.log(`Resolving ${moviesRaw.length} movies against TMDB…`);
const seenMovieIds = new Set();
let movieDone = 0;

await Promise.all(
  moviesRaw.map(async (m) => {
    const meta = m.meta ?? {};
    const name = meta.name ?? "(unknown)";
    const year = (meta.first_release_date ?? "").slice(0, 4);
    let match = null;
    try {
      if (meta.imdb_id) {
        const found = await tmdb(`/find/${meta.imdb_id}`, { external_source: "imdb_id" });
        match = found.movie_results?.[0] ?? null;
      }
      if (!match && name !== "(unknown)") {
        const search = await tmdb("/search/movie", { query: name, ...(year && { year }) });
        match = search.results?.[0] ?? null;
      }
    } catch (err) {
      report.moviesUnmatched.push({ name, year, reason: err.message });
      return;
    }
    if (!match) {
      report.moviesUnmatched.push({ name, year, reason: "no TMDB match" });
      return;
    }
    if (seenMovieIds.has(match.id)) return;
    seenMovieIds.add(match.id);

    addLibraryRow({
      tmdbId: match.id,
      mediaType: "movie",
      status: m.watched_at ? "completed" : "plan_to_watch",
      startedAt: null,
      finishedAt: m.watched_at ? dateOf(m.watched_at) : null,
      title: match.title ?? name,
      posterPath: match.poster_path,
      releaseYear: Number((match.release_date ?? year ?? "").slice(0, 4)) || null,
      runtimeMinutes: meta.runtime ? Math.round(meta.runtime / 60) : null,
      genreIds: match.genre_ids ?? [],
      totalEpisodes: null,
      createdAt: m.created_at,
    });
    if (++movieDone % 200 === 0) console.log(`  movies: ${movieDone}`);
  })
);
console.log(`Movies resolved: ${seenMovieIds.size}, unmatched: ${report.moviesUnmatched.length}`);

// ---------------------------------------------------------------------------
// Shows + episodes
// ---------------------------------------------------------------------------
const shows = JSON.parse(readFileSync("tvtime-export/shows-episodes.json", "utf8"));
console.log(`Resolving ${shows.length} shows against TMDB…`);
const seenShowIds = new Set();
let showDone = 0;

await Promise.all(
  shows.map(async (show) => {
    let match = null;
    try {
      const found = await tmdb(`/find/${show.tvdbId}`, { external_source: "tvdb_id" });
      match = found.tv_results?.[0] ?? null;
      if (!match) {
        const search = await tmdb("/search/tv", { query: show.name });
        match = search.results?.[0] ?? null;
      }
    } catch (err) {
      report.showsUnmatched.push({ name: show.name, tvdbId: show.tvdbId, reason: err.message });
      return;
    }
    if (!match) {
      report.showsUnmatched.push({ name: show.name, tvdbId: show.tvdbId, reason: "no TMDB match" });
      return;
    }
    if (seenShowIds.has(match.id)) return;
    seenShowIds.add(match.id);

    const details = await tmdb(`/tv/${match.id}`).catch(() => null);
    const totalEpisodes = details?.number_of_episodes ?? null;
    const fallbackRuntime = details?.episode_run_time?.[0] ?? null;

    // Per-episode runtimes for seasons that contain watches
    const watchedSeasons = [...new Set(show.watched.map((w) => w.season))];
    const runtimeBySeasonEp = new Map();
    await Promise.all(
      watchedSeasons.map(async (seasonNum) => {
        const season = await tmdb(`/tv/${match.id}/season/${seasonNum}`).catch(() => null);
        for (const ep of season?.episodes ?? []) {
          runtimeBySeasonEp.set(`${seasonNum}:${ep.episode_number}`, ep.runtime ?? fallbackRuntime);
        }
      })
    );

    const dates = show.watched.map((w) => w.watchedDate).filter(Boolean).sort();
    const nonSpecialWatched = show.watched.filter((w) => w.season > 0).length;
    const isComplete = totalEpisodes !== null && totalEpisodes > 0 && nonSpecialWatched >= totalEpisodes;
    if (totalEpisodes !== null && nonSpecialWatched > totalEpisodes) {
      report.episodeAnomalies.push({
        name: show.name,
        tmdbId: match.id,
        watched: nonSpecialWatched,
        tmdbTotal: totalEpisodes,
      });
    }

    addLibraryRow({
      tmdbId: match.id,
      mediaType: "tv",
      status: isComplete ? "completed" : show.watched.length > 0 ? "watching" : "plan_to_watch",
      startedAt: dates.length ? dateOf(dates[0]) : null,
      finishedAt: isComplete && dates.length ? dateOf(dates[dates.length - 1]) : null,
      title: match.name ?? show.name,
      posterPath: match.poster_path,
      releaseYear: Number((match.first_air_date ?? "").slice(0, 4)) || null,
      runtimeMinutes: fallbackRuntime,
      genreIds: match.genre_ids ?? [],
      totalEpisodes,
      createdAt: show.followedAt,
    });

    for (const w of show.watched) {
      const runtime = runtimeBySeasonEp.get(`${w.season}:${w.episode}`) ?? fallbackRuntime;
      episodeRowsJson.push({
        user_id: userId,
        tmdb_show_id: match.id,
        season_number: w.season,
        episode_number: w.episode,
        runtime_minutes: runtime,
        watched_at: tsOf(w.watchedDate) ?? tsOf(show.followedAt),
      });
      episodeRows.push(
        `(${q(userId)},${num(match.id)},${num(w.season)},${num(w.episode)},${num(runtime)},${q(
          tsOf(w.watchedDate) ?? tsOf(show.followedAt)
        )})`
      );
    }
    if (++showDone % 50 === 0) console.log(`  shows: ${showDone}`);
  })
);
console.log(`Shows resolved: ${seenShowIds.size}, unmatched: ${report.showsUnmatched.length}`);
console.log(`Episode rows: ${episodeRows.length}`);

// ---------------------------------------------------------------------------
// Write batched SQL
// ---------------------------------------------------------------------------
mkdirSync("tvtime-import", { recursive: true });
let fileNum = 0;
const writeBatch = (sql) =>
  writeFileSync(`tvtime-import/import-${String(++fileNum).padStart(3, "0")}.sql`, sql);

const LIB_COLS =
  "(user_id,tmdb_id,media_type,status,started_at,finished_at,title,poster_path,release_year,runtime_minutes,genre_ids,total_episodes,created_at)";
for (let i = 0; i < libraryRows.length; i += 400) {
  writeBatch(
    `insert into public.library_items ${LIB_COLS} values\n` +
      libraryRows.slice(i, i + 400).join(",\n") +
      `\non conflict (user_id, tmdb_id, media_type) do nothing;`
  );
}

const EP_COLS = "(user_id,tmdb_show_id,season_number,episode_number,runtime_minutes,watched_at)";
for (let i = 0; i < episodeRows.length; i += 800) {
  writeBatch(
    `insert into public.episode_watches ${EP_COLS} values\n` +
      episodeRows.slice(i, i + 800).join(",\n") +
      `\non conflict (user_id, tmdb_show_id, season_number, episode_number) do nothing;`
  );
}

writeFileSync(
  "tvtime-import/rows.json",
  JSON.stringify({ library: libraryRowsJson, episodes: episodeRowsJson })
);
writeFileSync("tvtime-import/report.json", JSON.stringify(report, null, 2));
console.log(
  `\nWrote ${fileNum} SQL batch files (${libraryRows.length} library rows, ${episodeRows.length} episode rows).`
);
console.log(
  `Unmatched — movies: ${report.moviesUnmatched.length}, shows: ${report.showsUnmatched.length}, anomalies: ${report.episodeAnomalies.length}`
);
