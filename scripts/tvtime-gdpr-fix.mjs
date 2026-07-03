// Reconciles the tracker database against the TV Time GDPR export (ground
// truth), producing corrective SQL: delete phantom episode watches, insert
// missing ones, and recompute show statuses.
//
// Usage: node scripts/tvtime-gdpr-fix.mjs <userId> <gdprDir>
// Reads: <gdprDir>/tracking-prod-records-v2.csv, user_show_special_status.csv
//        tvtime-import/rows.json   (what the previous import put in the DB)
//        .env.local                (TMDB_API_TOKEN)
// Writes: tvtime-import/fix.sql, tvtime-import/fix-report.json

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [userId, gdprDir] = process.argv.slice(2);
if (!userId || !gdprDir) {
  console.error("Usage: node scripts/tvtime-gdpr-fix.mjs <userId> <gdprDir>");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const TMDB_TOKEN = env.TMDB_API_TOKEN;

function parseCsv(path) {
  const text = readFileSync(path, "utf8");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ---------------------------------------------------------------------------
// 1. GDPR ground truth: unique (tvdbShowId, season, episode) -> earliest watch
// ---------------------------------------------------------------------------
const v2 = parseCsv(join(gdprDir, "tracking-prod-records-v2.csv"));
const truthByShow = new Map(); // tvdbId -> Map("s:e" -> {watchedAt, runtimeMin})
const showNames = new Map();
for (const r of v2) {
  if (!r.episode_id || !r.s_id || r.season_number === "" || r.episode_number === "") continue;
  const tvdbId = Number(r.s_id);
  showNames.set(tvdbId, r.series_name);
  const key = `${Number(r.season_number)}:${Number(r.episode_number)}`;
  let m = truthByShow.get(tvdbId);
  if (!m) truthByShow.set(tvdbId, (m = new Map()));
  const watchedAt = r.created_at.replace(" ", "T") + "Z";
  const runtimeMin = r.runtime ? Math.round(Number(r.runtime) / 60) : null;
  const existing = m.get(key);
  if (!existing || watchedAt < existing.watchedAt) m.set(key, { watchedAt, runtimeMin });
}
console.log(`GDPR truth: ${truthByShow.size} shows, ${[...truthByShow.values()].reduce((n, m) => n + m.size, 0)} unique watches`);

const forLater = new Set(
  parseCsv(join(gdprDir, "user_show_special_status.csv"))
    .filter((r) => r.status === "for_later")
    .map((r) => Number(r.tv_show_id))
);
const archivedTvdb = new Set(
  v2.filter((r) => r.is_archived === "true" || r.is_archived === "1").map((r) => Number(r.s_id))
);

// ---------------------------------------------------------------------------
// 2. Resolve every GDPR show to TMDB (find by tvdb id, fallback name search)
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

const report = { unresolvedShows: [], statusChanges: [], showsWithDeletes: {}, showsWithInserts: {} };
const tvdbToTmdb = new Map();
const tmdbMeta = new Map(); // tmdbId -> {details, match}

await Promise.all(
  [...truthByShow.keys()].map(async (tvdbId) => {
    const name = showNames.get(tvdbId);
    let match = null;
    try {
      const found = await tmdb(`/find/${tvdbId}`, { external_source: "tvdb_id" });
      match = found.tv_results?.[0] ?? null;
      if (!match) {
        const search = await tmdb("/search/tv", { query: name });
        match = search.results?.[0] ?? null;
      }
    } catch {}
    if (!match) {
      report.unresolvedShows.push({ tvdbId, name });
      return;
    }
    tvdbToTmdb.set(tvdbId, match.id);
    if (!tmdbMeta.has(match.id)) {
      const details = await tmdb(`/tv/${match.id}`).catch(() => null);
      tmdbMeta.set(match.id, { match, details });
    }
  })
);
console.log(`Resolved ${tvdbToTmdb.size}/${truthByShow.size} shows to TMDB`);

// ---------------------------------------------------------------------------
// 3. What the DB currently holds (from the previous import) keyed by TMDB id
// ---------------------------------------------------------------------------
const prev = JSON.parse(readFileSync("tvtime-import/rows.json", "utf8"));
const dbByShow = new Map(); // tmdbId -> Set("s:e")
for (const r of prev.episodes) {
  let s = dbByShow.get(r.tmdb_show_id);
  if (!s) dbByShow.set(r.tmdb_show_id, (s = new Set()));
  s.add(`${r.season_number}:${r.episode_number}`);
}
const prevLibrary = new Map(prev.library.map((r) => [`${r.media_type}:${r.tmdb_id}`, r]));

// ---------------------------------------------------------------------------
// 4. Diff → SQL
// ---------------------------------------------------------------------------
const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const stmts = [];
const truthByTmdb = new Map(); // tmdbId -> Map("s:e" -> watch)
for (const [tvdbId, eps] of truthByShow) {
  const tmdbId = tvdbToTmdb.get(tvdbId);
  if (!tmdbId) continue;
  let m = truthByTmdb.get(tmdbId);
  if (!m) truthByTmdb.set(tmdbId, (m = new Map()));
  for (const [key, w] of eps) if (!m.has(key) || w.watchedAt < m.get(key).watchedAt) m.set(key, w);
}

let deletes = 0, inserts = 0;
const insertRows = [];
const allShowIds = new Set([...truthByTmdb.keys(), ...dbByShow.keys()]);
for (const tmdbId of allShowIds) {
  const truth = truthByTmdb.get(tmdbId) ?? new Map();
  const inDb = dbByShow.get(tmdbId) ?? new Set();
  const name = tmdbMeta.get(tmdbId)?.match?.name ?? String(tmdbId);

  const toDelete = [...inDb].filter((k) => !truth.has(k));
  const toInsert = [...truth.keys()].filter((k) => !inDb.has(k));
  if (toDelete.length) {
    deletes += toDelete.length;
    report.showsWithDeletes[name] = toDelete.length;
    const pairs = toDelete.map((k) => `(${k.split(":").join(",")})`).join(",");
    stmts.push(
      `delete from public.episode_watches where user_id = ${q(userId)} and tmdb_show_id = ${tmdbId} and (season_number, episode_number) in (${pairs});`
    );
  }
  if (toInsert.length) {
    inserts += toInsert.length;
    report.showsWithInserts[name] = toInsert.length;
    const fallback = tmdbMeta.get(tmdbId)?.details?.episode_run_time?.[0] ?? null;
    for (const k of toInsert) {
      const [s, e] = k.split(":").map(Number);
      const w = truth.get(k);
      insertRows.push(
        `(${q(userId)},${tmdbId},${s},${e},${w.runtimeMin ?? fallback ?? "null"},${q(w.watchedAt)})`
      );
    }
  }
}
if (insertRows.length) {
  for (let i = 0; i < insertRows.length; i += 800) {
    stmts.push(
      `insert into public.episode_watches (user_id,tmdb_show_id,season_number,episode_number,runtime_minutes,watched_at) values\n${insertRows
        .slice(i, i + 800)
        .join(",\n")}\non conflict (user_id, tmdb_show_id, season_number, episode_number) do nothing;`
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Recompute statuses for every TV item present in DB or truth
// ---------------------------------------------------------------------------
for (const tmdbId of allShowIds) {
  const meta = tmdbMeta.get(tmdbId);
  const truth = truthByTmdb.get(tmdbId);
  const prevRow = prevLibrary.get(`tv:${tmdbId}`);
  const total = meta?.details?.number_of_episodes ?? prevRow?.total_episodes ?? null;
  const watched = truth?.size ?? 0;
  const nonSpecial = truth ? [...truth.keys()].filter((k) => !k.startsWith("0:")).length : 0;
  const tvdbId = [...tvdbToTmdb.entries()].find(([, v]) => v === tmdbId)?.[0];

  let status;
  if (tvdbId !== undefined && archivedTvdb.has(tvdbId)) status = "on_hold";
  else if (total && nonSpecial >= total) status = "completed";
  else if (watched > 0) status = "watching";
  else status = "plan_to_watch";

  const dates = truth ? [...truth.values()].map((w) => w.watchedAt).sort() : [];
  const startedAt = dates[0]?.slice(0, 10) ?? null;
  const finishedAt = status === "completed" ? (dates.at(-1)?.slice(0, 10) ?? null) : null;

  const prevStatus = prevRow?.status ?? "(absent)";
  if (prevStatus !== status) report.statusChanges.push({ show: meta?.match?.name ?? tmdbId, from: prevStatus, to: status });

  if (prevRow) {
    stmts.push(
      `update public.library_items set status = ${q(status)}, started_at = ${q(startedAt)}, finished_at = ${q(finishedAt)} where user_id = ${q(userId)} and tmdb_id = ${tmdbId} and media_type = 'tv';`
    );
  } else if (meta) {
    // show watched per GDPR but missing from library entirely
    const m = meta.match;
    stmts.push(
      `insert into public.library_items (user_id,tmdb_id,media_type,status,started_at,finished_at,title,poster_path,release_year,runtime_minutes,genre_ids,total_episodes) values (${q(
        userId
      )},${tmdbId},'tv',${q(status)},${q(startedAt)},${q(finishedAt)},${q(m.name)},${q(m.poster_path)},${
        Number((m.first_air_date ?? "").slice(0, 4)) || "null"
      },${meta.details?.episode_run_time?.[0] ?? "null"},'{${(m.genre_ids ?? []).join(",")}}',${total ?? "null"}) on conflict (user_id, tmdb_id, media_type) do nothing;`
    );
  }
}

// for_later shows → plan_to_watch (unless they have watches)
for (const tvdbId of forLater) {
  const tmdbId = tvdbToTmdb.get(tvdbId);
  if (tmdbId && (truthByTmdb.get(tmdbId)?.size ?? 0) > 0) continue;
  if (tmdbId) {
    stmts.push(
      `update public.library_items set status = 'plan_to_watch' where user_id = ${q(userId)} and tmdb_id = ${tmdbId} and media_type = 'tv';`
    );
  }
}

writeFileSync("tvtime-import/fix.sql", stmts.join("\n\n"));
writeFileSync("tvtime-import/fix-report.json", JSON.stringify(report, null, 2));
console.log(`\nfix.sql: ${stmts.length} statements — ${deletes} watch deletes, ${inserts} watch inserts, ${report.statusChanges.length} status changes`);
console.log("Unresolved shows:", report.unresolvedShows.length ? JSON.stringify(report.unresolvedShows) : "none");
console.log("Top phantom-watch shows:", JSON.stringify(Object.entries(report.showsWithDeletes).sort((a,b)=>b[1]-a[1]).slice(0,10)));
console.log("Top missing-watch shows:", JSON.stringify(Object.entries(report.showsWithInserts).sort((a,b)=>b[1]-a[1]).slice(0,10)));
