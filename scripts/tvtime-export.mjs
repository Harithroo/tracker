// Exports your TV Time library (shows, watched episodes, movies) using your
// own session token, probing the known API surfaces since TV Time's private
// API has changed over time.
//
// Usage:  node scripts/tvtime-export.mjs <jwt> [userId]
// Output: tvtime-export/ *.json (raw responses, one per endpoint that worked)

import { mkdir, writeFile } from "node:fs/promises";

const token = process.argv[2];
let userId = process.argv[3];

if (!token) {
  console.error("Usage: node scripts/tvtime-export.mjs <jwt> [userId]");
  process.exit(1);
}

function decodeJwt(jwt) {
  try {
    const payload = jwt.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

const claims = decodeJwt(token);
if (claims) {
  console.log("JWT claims:", JSON.stringify(claims).slice(0, 400));
  userId ??= claims.id ?? claims.user_id ?? claims.userId ?? claims.sub;
}
if (!userId) {
  console.error("Could not determine user id from JWT — pass it as 2nd arg.");
  process.exit(1);
}
console.log("User id:", userId);

const OUT_DIR = "tvtime-export";
await mkdir(OUT_DIR, { recursive: true });

async function probe(name, url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (personal data export)",
        ...headers,
      },
    });
    const text = await res.text();
    const ok = res.ok && text.trim().startsWith("{");
    console.log(`${ok ? "✓" : "✗"} [${res.status}] ${name} (${text.length} bytes)`);
    if (ok) {
      await writeFile(`${OUT_DIR}/${name}.json`, text);
      return JSON.parse(text);
    }
    if (!ok && text.length < 300) console.log(`   ${text.trim().slice(0, 250)}`);
  } catch (err) {
    console.log(`✗ [ERR] ${name}: ${err.message}`);
  }
  return null;
}

const sidecar = (target) =>
  `https://app.tvtime.com/sidecar?o=${encodeURIComponent(target)}`;

// --- Probe the modern (msapi / sidecar) surface -----------------------------
const followsSeries = `https://msapi.tvtime.com/prod/v1/tracking/cgw/follows/user/${userId}?entity_type=series`;
const followsMovies = `https://msapi.tvtime.com/prod/v1/tracking/cgw/follows/user/${userId}?entity_type=movie`;

await probe("msapi-follows-series", followsSeries);
await probe("msapi-follows-movies", followsMovies);
await probe("sidecar-follows-series", sidecar(followsSeries));
await probe("sidecar-follows-movies", sidecar(followsMovies));

// --- Probe the legacy v2 surface --------------------------------------------
const v2User = `https://api2.tozelabs.com/v2/user/${userId}`;
await probe("v2-user", v2User);
await probe("sidecar-v2-user", sidecar(v2User));

console.log(`\nDone. Inspect ${OUT_DIR}/ for whatever succeeded.`);
