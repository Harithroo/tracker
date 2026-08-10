"use client";

import { useState, useTransition } from "react";
import { getSeasonEpisodes } from "@/actions/seasons";
import { cn } from "@/lib/utils";
import type { MediaSnapshot } from "@/types/library";
import { EpisodeList, type EpisodeRow } from "./EpisodeList";

export interface SeasonPill {
  seasonNumber: number;
  label: string;
}

/**
 * Season picker over the episode list.
 *
 * Episode lists are cached client-side once fetched — they don't change from
 * under us — but which episodes are watched always comes from the server prop.
 * Holding that in state would freeze it at first render, and every tick would
 * spring back the moment its server action finished and the optimistic update
 * was handed back to a stale base.
 */
export function InlineEpisodes({
  showTmdbId,
  seasons,
  initialSeasonNumber,
  initialEpisodes,
  watchedBySeason,
  snapshot,
}: {
  showTmdbId: number;
  seasons: SeasonPill[];
  initialSeasonNumber: number;
  initialEpisodes: EpisodeRow[];
  watchedBySeason: Record<number, number[]>;
  snapshot: MediaSnapshot;
}) {
  const [activeSeason, setActiveSeason] = useState(initialSeasonNumber);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<number, EpisodeRow[]>>({
    [initialSeasonNumber]: initialEpisodes,
  });
  const [pending, startTransition] = useTransition();

  const episodes = episodesBySeason[activeSeason] ?? [];
  const watchedEpisodes = watchedBySeason[activeSeason] ?? [];

  function selectSeason(seasonNumber: number) {
    if (seasonNumber === activeSeason || pending) return;
    if (episodesBySeason[seasonNumber]) {
      setActiveSeason(seasonNumber);
      return;
    }
    startTransition(async () => {
      const fetched = await getSeasonEpisodes(showTmdbId, seasonNumber);
      setEpisodesBySeason((cache) => ({ ...cache, [seasonNumber]: fetched }));
      setActiveSeason(seasonNumber);
    });
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {seasons.map((s) => (
            <button
              key={s.seasonNumber}
              type="button"
              disabled={pending}
              onClick={() => selectSeason(s.seasonNumber)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-60",
                s.seasonNumber === activeSeason
                  ? "border-accent bg-accent-900 text-accent-200"
                  : "border-neutral-800 text-neutral-500 hover:text-text"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-xs text-neutral-600">
          {watchedEpisodes.length} / {episodes.length}
        </span>
      </div>
      <EpisodeList
        key={activeSeason}
        showTmdbId={showTmdbId}
        seasonNumber={activeSeason}
        episodes={episodes}
        watchedEpisodes={watchedEpisodes}
        snapshot={snapshot}
      />
    </div>
  );
}
