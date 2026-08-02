"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { setEpisodeWatched } from "@/actions/episodes";
import { posterUrl } from "@/lib/tmdb/images";
import { cn, formatRuntime } from "@/lib/utils";
import type { MediaSnapshot, WatchStatus } from "@/types/library";
import { CardMenu } from "./CardMenu";

export interface UpNextEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  runtimeMinutes: number | null;
  code: string;
}

export function ContinueWatchingCard({
  showTmdbId,
  href,
  posterPath,
  title,
  upNext,
  watchedCount,
  totalEpisodes,
  status,
  snapshot,
}: {
  showTmdbId: number;
  href: string;
  posterPath: string | null;
  title: string;
  upNext: UpNextEpisode | null;
  watchedCount: number;
  totalEpisodes: number | null;
  status: WatchStatus;
  snapshot: MediaSnapshot;
}) {
  const [pending, startTransition] = useTransition();
  const [marked, setMarked] = useState(false);
  const src = posterUrl(posterPath, "w185");

  const progress =
    totalEpisodes && totalEpisodes > 0
      ? (watchedCount / totalEpisodes) * 100
      : undefined;

  function markWatched() {
    if (!upNext) return;
    setMarked(true);
    startTransition(async () => {
      await setEpisodeWatched({
        showTmdbId,
        seasonNumber: upNext.seasonNumber,
        episodeNumber: upNext.episodeNumber,
        runtimeMinutes: upNext.runtimeMinutes,
        watched: true,
        snapshot,
      });
      // Revalidation swaps in the next episode; reset for the remounted card.
      setMarked(false);
    });
  }

  return (
    <div className="group relative flex gap-3 rounded-xl border border-border bg-surface p-2.5">
      <Link href={href} className="block shrink-0">
        <div className="relative aspect-[2/3] w-16 overflow-hidden rounded-lg border border-border bg-surface-2 sm:w-20">
          {src ? (
            <Image
              src={src}
              alt={title}
              fill
              sizes="80px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-1.5 text-center text-[11px] text-muted">
              {title}
            </div>
          )}
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <Link href={href} className="block pr-6">
          <p className="line-clamp-1 text-sm font-semibold">{title}</p>
        </Link>

        {upNext ? (
          <>
            <p className="mt-0.5 text-xs text-muted">
              <span className="font-medium text-foreground">Up next</span>{" "}
              {upNext.code}
            </p>
            <p className="line-clamp-1 text-xs text-muted">
              {[upNext.name, formatRuntime(upNext.runtimeMinutes)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-muted">Continue watching</p>
        )}

        <div className="mt-auto pt-2">
          {totalEpisodes ? (
            <div className="mb-2">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                <span>
                  {watchedCount} / {totalEpisodes} eps
                </span>
              </div>
              {progress !== undefined && (
                <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
              )}
            </div>
          ) : null}

          {upNext && (
            <button
              type="button"
              disabled={pending || marked}
              onClick={markWatched}
              className={cn(
                "w-full rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                marked
                  ? "border-accent bg-accent text-white"
                  : "border-border bg-surface-2 hover:border-accent hover:text-foreground",
                pending && "opacity-70"
              )}
            >
              {marked ? "✓ Marked watched" : `✓ Mark ${upNext.code} watched`}
            </button>
          )}
        </div>
      </div>

      <CardMenu tmdbId={showTmdbId} mediaType="tv" status={status} />
    </div>
  );
}
