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

export function InlineEpisodes({
  showTmdbId,
  seasons,
  initialSeasonNumber,
  initialEpisodes,
  initialWatchedEpisodes,
  snapshot,
}: {
  showTmdbId: number;
  seasons: SeasonPill[];
  initialSeasonNumber: number;
  initialEpisodes: EpisodeRow[];
  initialWatchedEpisodes: number[];
  snapshot: MediaSnapshot;
}) {
  const [activeSeason, setActiveSeason] = useState(initialSeasonNumber);
  const [episodes, setEpisodes] = useState(initialEpisodes);
  const [watchedEpisodes, setWatchedEpisodes] = useState(initialWatchedEpisodes);
  const [pending, startTransition] = useTransition();

  function selectSeason(seasonNumber: number) {
    if (seasonNumber === activeSeason || pending) return;
    startTransition(async () => {
      const data = await getSeasonEpisodes(showTmdbId, seasonNumber);
      setActiveSeason(seasonNumber);
      setEpisodes(data.episodes);
      setWatchedEpisodes(data.watchedEpisodes);
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
