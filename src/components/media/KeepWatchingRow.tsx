"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { setEpisodeWatched } from "@/actions/episodes";
import { posterUrl } from "@/lib/tmdb/images";
import { cn } from "@/lib/utils";
import type { MediaSnapshot } from "@/types/library";

export function KeepWatchingRow({
  showTmdbId,
  href,
  posterPath,
  title,
  code,
  episodeName,
  watchedCount,
  totalEpisodes,
  runtimeMinutes,
  seasonNumber,
  episodeNumber,
  snapshot,
}: {
  showTmdbId: number;
  href: string;
  posterPath: string | null;
  title: string;
  code: string;
  episodeName: string;
  watchedCount: number;
  totalEpisodes: number | null;
  runtimeMinutes: number | null;
  seasonNumber: number;
  episodeNumber: number;
  snapshot: MediaSnapshot;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const src = posterUrl(posterPath, "w185");
  const pct =
    totalEpisodes && totalEpisodes > 0
      ? Math.min(100, Math.round((watchedCount / totalEpisodes) * 100))
      : 0;

  function markWatched() {
    setDone(true);
    startTransition(() =>
      setEpisodeWatched({
        showTmdbId,
        seasonNumber,
        episodeNumber,
        runtimeMinutes,
        watched: true,
        snapshot,
      })
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-neutral-900 py-2.5 pl-2.5 pr-2.5">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="relative aspect-[2/3] w-11 shrink-0 overflow-hidden rounded-md bg-surface">
          {src && <Image src={src} alt="" fill sizes="44px" className="object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-neutral-500">
            {code} · {episodeName}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="h-1.5 flex-1 rounded-full bg-neutral-800">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            {totalEpisodes ? (
              <span className="shrink-0 text-[11px] text-neutral-600">
                {watchedCount} / {totalEpisodes}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
      <button
        type="button"
        aria-label={`Mark ${code} watched`}
        disabled={pending || done}
        onClick={markWatched}
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors",
          done
            ? "border-accent bg-accent/20 text-accent-200"
            : "border-neutral-800 text-neutral-700 hover:border-accent"
        )}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12.5 10 18.5 20 6" />
        </svg>
      </button>
    </div>
  );
}
