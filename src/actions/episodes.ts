"use server";

import { revalidatePath } from "next/cache";
import type { ObjectId } from "mongodb";
import { requireUser } from "@/lib/firebase/admin";
import { episodeWatches, libraryItems } from "@/lib/mongo/client";
import { addEpisodeWatches } from "@/lib/mongo/watches";
import type { LibraryItemDoc } from "@/lib/mongo/collections";
import { getSeason, getShow } from "@/lib/tmdb/client";
import {
  buildEpisodeIndex,
  mapToTmdbEpisode,
  type EpisodeIndex,
} from "@/lib/tmdb/episode-map";
import { isAired } from "@/lib/utils";
import { airedEpisodeCount, episodeKey, isShowEnded, nextAiredEpisode } from "@/lib/progress";
import type { MediaSnapshot, RepairResult, RepairTarget } from "@/types/library";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Marking an episode auto-adds the show to the library as "watching", and
 * keeps status/total_episodes in sync. A show flips to "completed" only when
 * it has ended and every aired regular episode (specials excluded) is watched;
 * un-watching an aired episode after completion goes back to "watching".
 */
async function syncShowLibraryItem(
  userId: string,
  showTmdbId: number,
  snapshot: MediaSnapshot
) {
  const items = await libraryItems();
  const item = await items.findOne(
    { user_id: userId, tmdb_id: showTmdbId, media_type: "tv" },
    { projection: { status: 1, started_at: 1, finished_at: 1, total_episodes: 1 } }
  );

  const epRows = await (await episodeWatches())
    .find({ user_id: userId, tmdb_show_id: showTmdbId })
    .project<{ season_number: number; episode_number: number }>({
      season_number: 1,
      episode_number: 1,
      _id: 0,
    })
    .toArray();
  const watched = epRows.length;
  const watchedSet = new Set(
    epRows.map((row) => episodeKey(row.season_number, row.episode_number))
  );

  // "Complete" means an ended show with every aired regular episode watched;
  // "caught up" (all aired watched, show still running) never demotes status.
  let isComplete = false;
  let caughtUp = false;
  try {
    const show = await getShow(showTmdbId);
    caughtUp =
      airedEpisodeCount(show.seasons, show.last_episode_to_air) > 0 &&
      nextAiredEpisode(show.seasons, show.last_episode_to_air, watchedSet) === null;
    isComplete = caughtUp && isShowEnded(show.status);
  } catch {
    // TMDB unavailable — fall back to the snapshot's episode total
    const total = snapshot.totalEpisodes;
    isComplete = total !== null && total > 0 && watched >= total;
    caughtUp = isComplete;
  }

  if (!item) {
    const now = new Date().toISOString();
    await items.insertOne({
      user_id: userId,
      tmdb_id: showTmdbId,
      media_type: "tv",
      status: isComplete ? "completed" : "watching",
      rating: null,
      favorite: false,
      notes: null,
      started_at: today(),
      finished_at: isComplete ? today() : null,
      title: snapshot.title,
      poster_path: snapshot.posterPath,
      release_year: snapshot.releaseYear,
      runtime_minutes: snapshot.runtimeMinutes,
      genre_ids: snapshot.genreIds,
      total_episodes: snapshot.totalEpisodes,
      created_at: now,
      updated_at: now,
    });
    return;
  }

  const update: Record<string, unknown> = {};
  if (item.total_episodes !== snapshot.totalEpisodes) {
    update.total_episodes = snapshot.totalEpisodes;
  }

  if (isComplete && item.status !== "completed") {
    update.status = "completed";
    if (!item.finished_at) update.finished_at = today();
  } else if (!caughtUp && watched > 0 && ["completed", "plan_to_watch"].includes(item.status)) {
    update.status = "watching";
    if (!item.started_at) update.started_at = today();
  }

  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString();
    await items.updateOne({ _id: item._id }, { $set: update });
  }
}

export async function setEpisodeWatched(input: {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  runtimeMinutes: number | null;
  watched: boolean;
  snapshot: MediaSnapshot;
}) {
  const user = await requireUser();

  if (input.watched) {
    await addEpisodeWatches([
      {
        user_id: user.id,
        tmdb_show_id: input.showTmdbId,
        season_number: input.seasonNumber,
        episode_number: input.episodeNumber,
        runtime_minutes: input.runtimeMinutes,
      },
    ]);
  } else {
    await (
      await episodeWatches()
    ).deleteOne({
      user_id: user.id,
      tmdb_show_id: input.showTmdbId,
      season_number: input.seasonNumber,
      episode_number: input.episodeNumber,
    });
  }

  await syncShowLibraryItem(user.id, input.showTmdbId, input.snapshot);
  revalidatePath("/", "layout");
}

interface WatchRow {
  _id: ObjectId;
  season_number: number;
  episode_number: number;
  runtime_minutes: number | null;
  watched_at: string;
}

/**
 * Rewrites the show's watch history into TMDB's current numbering.
 *
 * Imported histories carry their source's numbering, and TMDB re-splits seasons
 * over time, so rows can end up pointing at episodes that no longer exist. Those
 * rows are invisible in the episode list but still count towards progress, which
 * is how a finished show keeps claiming an early episode is up next. Rows that
 * can be translated are moved; rows matching no TMDB episode are dropped, since
 * there is nothing they could refer to. Specials are left alone — they don't
 * count towards progress and have no ordering to map through.
 */
async function reconcileEpisodeNumbering(
  userId: string,
  showTmdbId: number,
  rows: WatchRow[],
  index: EpisodeIndex
): Promise<{ moved: number; dropped: number }> {
  const staleIds: ObjectId[] = [];
  // Several stale rows can translate to the same episode; keep the earliest.
  const moved = new Map<string, { season: number; episode: number; row: WatchRow; runtime: number | null }>();
  for (const row of rows) {
    if (row.season_number <= 0) continue;
    const key = episodeKey(row.season_number, row.episode_number);
    if (index.byKey.has(key)) continue;

    staleIds.push(row._id);
    const match = mapToTmdbEpisode(index, row.season_number, row.episode_number);
    if (!match) continue;
    const target = episodeKey(match.season_number, match.episode_number);
    const existing = moved.get(target);
    if (!existing || row.watched_at < existing.row.watched_at) {
      moved.set(target, {
        season: match.season_number,
        episode: match.episode_number,
        row,
        runtime: match.runtime ?? row.runtime_minutes,
      });
    }
  }
  if (staleIds.length === 0) return { moved: 0, dropped: 0 };

  // Write the translated rows before dropping the originals, so a failure
  // partway through leaves the history intact rather than short.
  await addEpisodeWatches(
    [...moved.values()].map((m) => ({
      user_id: userId,
      tmdb_show_id: showTmdbId,
      season_number: m.season,
      episode_number: m.episode,
      runtime_minutes: m.runtime,
      watched_at: m.row.watched_at,
    }))
  );

  const watches = await episodeWatches();
  for (let i = 0; i < staleIds.length; i += 500) {
    await watches.deleteMany({
      user_id: userId,
      _id: { $in: staleIds.slice(i, i + 500) },
    });
  }

  return { moved: moved.size, dropped: staleIds.length - moved.size };
}

async function loadWatchRows(userId: string, showTmdbId: number): Promise<WatchRow[]> {
  return (await episodeWatches())
    .find({ user_id: userId, tmdb_show_id: showTmdbId })
    .project<WatchRow>({
      season_number: 1,
      episode_number: 1,
      runtime_minutes: 1,
      watched_at: 1,
    })
    .toArray();
}

async function fetchSeasons(showTmdbId: number, seasonNumbers: number[]) {
  const seasons = await Promise.all(
    seasonNumbers.map((n) => getSeason(showTmdbId, n).catch(() => null))
  );
  return seasons.filter((s) => s !== null);
}

/**
 * Marks everything up to (and including) the given episode as watched, in air
 * order across seasons. The show's existing history is realigned to TMDB's
 * numbering first — otherwise this would stack a second, differently numbered
 * copy of the same episodes on top of an imported one.
 */
export async function setWatchedUpTo(input: {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  snapshot: MediaSnapshot;
}) {
  const user = await requireUser();

  const show = await getShow(input.showTmdbId);
  const index = buildEpisodeIndex(
    await fetchSeasons(
      input.showTmdbId,
      show.seasons.filter((s) => s.season_number > 0 && s.episode_count > 0).map((s) => s.season_number)
    )
  );

  const rows = await loadWatchRows(user.id, input.showTmdbId);
  await reconcileEpisodeNumbering(user.id, input.showTmdbId, rows, index);

  const targetIndex = index.order.findIndex(
    (ep) =>
      ep.season_number === input.seasonNumber && ep.episode_number === input.episodeNumber
  );
  const upTo =
    targetIndex >= 0
      ? index.order.slice(0, targetIndex + 1)
      : // Target missing from the index (a season TMDB wouldn't serve): fall back
        // to comparing numbers so the action still does something useful.
        index.order.filter(
          (ep) =>
            ep.season_number < input.seasonNumber ||
            (ep.season_number === input.seasonNumber &&
              ep.episode_number <= input.episodeNumber)
        );

  await addEpisodeWatches(
    upTo
      .filter((ep) => isAired(ep.air_date))
      .map((ep) => ({
        user_id: user.id,
        tmdb_show_id: input.showTmdbId,
        season_number: ep.season_number,
        episode_number: ep.episode_number,
        runtime_minutes: ep.runtime,
      }))
  );

  await syncShowLibraryItem(user.id, input.showTmdbId, input.snapshot);
  revalidatePath("/", "layout");
}

/** Every show in the library, oldest first — the work list for a repair run. */
export async function listShowsToRepair(): Promise<RepairTarget[]> {
  const user = await requireUser();

  const items = await (await libraryItems())
    .find({ user_id: user.id, media_type: "tv" })
    .sort({ _id: 1 })
    .project<{ tmdb_id: number; title: string }>({ tmdb_id: 1, title: 1, _id: 0 })
    .toArray();
  return items.map((item) => ({ tmdbId: item.tmdb_id, title: item.title }));
}

/**
 * Realigns one show's watch history to TMDB's numbering, pulling only as much
 * of the show as it takes to tell: the seasons the history touches are enough
 * to prove the numbering already matches, which is the answer for most shows.
 */
async function repairShow(userId: string, item: LibraryItemDoc): Promise<RepairResult> {
  const base: RepairResult = { tmdbId: item.tmdb_id, title: item.title, moved: 0, dropped: 0 };
  const rows = await loadWatchRows(userId, item.tmdb_id);
  if (rows.length === 0) return base;

  const show = await getShow(item.tmdb_id);
  const touched = [...new Set(rows.map((row) => row.season_number))];
  let seasons = await fetchSeasons(item.tmdb_id, touched);
  let index = buildEpisodeIndex(seasons);

  // Specials are never renumbered, so an odd one shouldn't drag in the rest of
  // the show on every run.
  const aligned = rows.every(
    (row) =>
      row.season_number <= 0 ||
      index.byKey.has(episodeKey(row.season_number, row.episode_number))
  );
  if (aligned) return base;

  const rest = show.seasons
    .filter((s) => s.episode_count > 0 && !touched.includes(s.season_number))
    .map((s) => s.season_number);
  if (rest.length > 0) {
    seasons = [...seasons, ...(await fetchSeasons(item.tmdb_id, rest))];
    index = buildEpisodeIndex(seasons);
  }

  const { moved, dropped } = await reconcileEpisodeNumbering(
    userId,
    item.tmdb_id,
    rows,
    index
  );
  if (moved > 0 || dropped > 0) {
    await syncShowLibraryItem(userId, item.tmdb_id, {
      title: item.title,
      posterPath: item.poster_path,
      releaseYear: item.release_year,
      runtimeMinutes: item.runtime_minutes,
      genreIds: item.genre_ids,
      totalEpisodes: item.total_episodes,
    });
  }
  return { ...base, moved, dropped };
}

/**
 * Repairs a batch of shows. Batching is the caller's job: a whole library can
 * mean hundreds of TMDB requests, well past what one request should carry.
 */
export async function repairShowNumbering(tmdbIds: number[]): Promise<RepairResult[]> {
  const user = await requireUser();
  if (tmdbIds.length === 0 || tmdbIds.length > 10) {
    throw new Error("Repair takes 1–10 shows at a time");
  }

  const items = await (await libraryItems())
    .find({ user_id: user.id, media_type: "tv", tmdb_id: { $in: tmdbIds } })
    .toArray();

  const results: RepairResult[] = [];
  for (const item of items) {
    try {
      results.push(await repairShow(user.id, item));
    } catch (err) {
      results.push({
        tmdbId: item.tmdb_id,
        title: item.title,
        moved: 0,
        dropped: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  if (results.some((r) => r.moved > 0 || r.dropped > 0)) revalidatePath("/", "layout");
  return results;
}

export async function setSeasonWatched(input: {
  showTmdbId: number;
  seasonNumber: number;
  episodes: { episodeNumber: number; runtimeMinutes: number | null }[];
  watched: boolean;
  snapshot: MediaSnapshot;
}) {
  const user = await requireUser();

  if (input.watched) {
    await addEpisodeWatches(
      input.episodes.map((ep) => ({
        user_id: user.id,
        tmdb_show_id: input.showTmdbId,
        season_number: input.seasonNumber,
        episode_number: ep.episodeNumber,
        runtime_minutes: ep.runtimeMinutes,
      }))
    );
  } else {
    await (
      await episodeWatches()
    ).deleteMany({
      user_id: user.id,
      tmdb_show_id: input.showTmdbId,
      season_number: input.seasonNumber,
    });
  }

  await syncShowLibraryItem(user.id, input.showTmdbId, input.snapshot);
  revalidatePath("/", "layout");
}
