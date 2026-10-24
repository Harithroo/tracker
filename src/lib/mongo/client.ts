import "server-only";
import { MongoClient, type Collection, type Db } from "mongodb";
import type { EpisodeWatchDoc, LibraryItemDoc, ProfileDoc } from "./collections";

const DB_NAME = process.env.MONGODB_DB ?? "tracker";

// The driver pools connections, so the client is created once and reused. In
// dev the module is re-evaluated on every hot reload, which would otherwise
// open a new pool per edit.
declare global {
  var _mongoClient: Promise<MongoClient> | undefined;
}

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MongoDB is not configured. Copy .env.example to .env.local and fill in MONGODB_URI (see README)."
    );
  }
  return new MongoClient(uri).connect();
}

export async function getDb(): Promise<Db> {
  if (process.env.NODE_ENV === "development") {
    global._mongoClient ??= connect();
    return (await global._mongoClient).db(DB_NAME);
  }
  clientPromise ??= connect();
  return (await clientPromise).db(DB_NAME);
}

let clientPromise: Promise<MongoClient> | undefined;

export async function profiles(): Promise<Collection<ProfileDoc>> {
  return (await getDb()).collection<ProfileDoc>("profiles");
}

export async function libraryItems(): Promise<Collection<LibraryItemDoc>> {
  return (await getDb()).collection<LibraryItemDoc>("library_items");
}

export async function episodeWatches(): Promise<Collection<EpisodeWatchDoc>> {
  return (await getDb()).collection<EpisodeWatchDoc>("episode_watches");
}
