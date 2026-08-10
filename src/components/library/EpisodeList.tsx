"use client";

import { useOptimistic, useTransition } from "react";
import { setEpisodeWatched, setSeasonWatched, setWatchedUpTo } from "@/actions/episodes";
import { cn, formatDate, formatRuntime } from "@/lib/utils";
import type { MediaSnapshot } from "@/types/library";

export interface EpisodeRow {
  episodeNumber: number;
  name: string;
  airDate: string | null;
  runtimeMinutes: number | null;
  aired: boolean;
}

type OptimisticAction =
  | { type: "toggle"; episodeNumber: number; watched: boolean }
  | { type: "season"; episodeNumbers: number[]; watched: boolean }
  | { type: "upTo"; episodeNumber: number };

export function EpisodeList({
  showTmdbId,
  seasonNumber,
  episodes,
  watchedEpisodes,
  snapshot,
}: {
  showTmdbId: number;
  seasonNumber: number;
  episodes: EpisodeRow[];
  watchedEpisodes: number[];
  snapshot: MediaSnapshot;
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticWatched, applyOptimistic] = useOptimistic(
    watchedEpisodes,
    (current: number[], action: OptimisticAction) => {
      if (action.type === "toggle") {
        return action.watched
          ? [...current, action.episodeNumber]
          : current.filter((n) => n !== action.episodeNumber);
      }
      if (action.type === "upTo") {
        // Take the numbers off the season itself — assuming they run 1..N ticks
        // the wrong rows on shows TMDB numbers straight through.
        const upTo = episodes
          .filter((ep) => ep.episodeNumber <= action.episodeNumber)
          .map((ep) => ep.episodeNumber);
        return [...new Set([...current, ...upTo])];
      }
      return action.watched
        ? [...new Set([...current, ...action.episodeNumbers])]
        : [];
    }
  );

  const watchedSet = new Set(optimisticWatched);
  const airedEpisodes = episodes.filter((ep) => ep.aired);
  const allAiredWatched =
    airedEpisodes.length > 0 &&
    airedEpisodes.every((ep) => watchedSet.has(ep.episodeNumber));

  function toggle(ep: EpisodeRow) {
    const watched = !watchedSet.has(ep.episodeNumber);
    startTransition(async () => {
      applyOptimistic({ type: "toggle", episodeNumber: ep.episodeNumber, watched });
      await setEpisodeWatched({
        showTmdbId,
        seasonNumber,
        episodeNumber: ep.episodeNumber,
        runtimeMinutes: ep.runtimeMinutes,
        watched,
        snapshot,
      });
    });
  }

  function watchUpTo(ep: EpisodeRow) {
    startTransition(async () => {
      applyOptimistic({ type: "upTo", episodeNumber: ep.episodeNumber });
      await setWatchedUpTo({
        showTmdbId,
        seasonNumber,
        episodeNumber: ep.episodeNumber,
        snapshot,
      });
    });
  }

  function toggleSeason() {
    const watched = !allAiredWatched;
    const targets = watched ? airedEpisodes : episodes;
    startTransition(async () => {
      applyOptimistic({
        type: "season",
        episodeNumbers: targets.map((ep) => ep.episodeNumber),
        watched,
      });
      await setSeasonWatched({
        showTmdbId,
        seasonNumber,
        episodes: targets.map((ep) => ({
          episodeNumber: ep.episodeNumber,
          runtimeMinutes: ep.runtimeMinutes,
        })),
        watched,
        snapshot,
      });
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted">
          {optimisticWatched.length} / {episodes.length} watched
        </p>
        <button
          type="button"
          disabled={pending || airedEpisodes.length === 0}
          onClick={toggleSeason}
          className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium transition-colors hover:border-accent disabled:opacity-50"
        >
          {allAiredWatched ? "Clear season" : "Mark season watched"}
        </button>
      </div>

      <ul className="divide-y divide-border/60 rounded-xl border border-border bg-surface">
        {episodes.map((ep) => {
          const watched = watchedSet.has(ep.episodeNumber);
          return (
            <li key={ep.episodeNumber} className="group/ep relative">
              <button
                type="button"
                onClick={() => toggle(ep)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 pr-24 text-left transition-colors hover:bg-surface-2",
                  !ep.aired && "opacity-50"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs transition-colors",
                    watched
                      ? "border-accent bg-accent text-white"
                      : "border-border text-transparent"
                  )}
                >
                  ✓
                </span>
                <span className="w-9 shrink-0 text-sm font-semibold text-muted">
                  E{ep.episodeNumber}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm font-medium">
                    {ep.name || `Episode ${ep.episodeNumber}`}
                  </span>
                  <span className="text-xs text-muted">
                    {[formatDate(ep.airDate), formatRuntime(ep.runtimeMinutes)]
                      .filter(Boolean)
                      .join(" · ")}
                    {!ep.aired && " · Not aired yet"}
                  </span>
                </span>
              </button>
              {ep.aired && !watched && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => watchUpTo(ep)}
                  title={`Mark everything up to E${ep.episodeNumber} watched`}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-foreground sm:opacity-0 sm:group-hover/ep:opacity-100 sm:focus:opacity-100"
                >
                  ↧ up to here
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
