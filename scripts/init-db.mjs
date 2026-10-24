// Creates the MongoDB indexes the app relies on. Safe to re-run.
//
//   npm run db:init
//
// Reads MONGODB_URI / MONGODB_DB from .env.local.
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (expected in .env.local).");
  process.exit(1);
}

const client = await new MongoClient(uri).connect();
const db = client.db(process.env.MONGODB_DB ?? "tracker");

await db.collection("library_items").createIndexes([
  // One row per (user, movie-or-show) — the upsert guard on every write path.
  { key: { user_id: 1, tmdb_id: 1, media_type: 1 }, unique: true },
  { key: { user_id: 1, status: 1 } },
  { key: { user_id: 1, favorite: 1 } },
  { key: { user_id: 1, updated_at: -1 } },
  { key: { user_id: 1, media_type: 1, finished_at: -1 } },
]);

await db.collection("episode_watches").createIndexes([
  {
    key: { user_id: 1, tmdb_show_id: 1, season_number: 1, episode_number: 1 },
    unique: true,
  },
  { key: { user_id: 1, watched_at: -1 } },
]);

console.log(`Indexes ready on "${db.databaseName}".`);
await client.close();
