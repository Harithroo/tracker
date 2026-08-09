"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { setEpisodeWatched, setWatchedUpTo } from "@/actions/episodes";
import { quickSetStatus, upsertLibraryItem } from "@/actions/library";
import { backdropUrl, posterUrl } from "@/lib/tmdb/images";
import { cn, formatDate, formatRuntime } from "@/lib/utils";
import type { MediaSnapshot } from "@/types/library";
import { QuickActionsSheet, type QuickAction } from "@/components/ui/QuickActionsSheet";

export interface HeroUpNext {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  runtimeMinutes: number | null;
  code: string;
  airDate: string | null;
}

export function UpNextHero({
  showTmdbId,
  href,
  title,
  posterPath,
  backdropPath,
  upNext,
  watchedCount,
  totalEpisodes,
  favorite,
  lastWatchedLabel,
  snapshot,
}: {
  showTmdbId: number;
  href: string;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  upNext: HeroUpNext;
  watchedCount: number;
  totalEpisodes: number | null;
  favorite: boolean;
  lastWatchedLabel: string | null;
  snapshot: MediaSnapshot;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const poster = posterUrl(posterPath, "w342");
  const backdrop = backdropUrl(backdropPath, "w780");
  const pct =
    totalEpisodes && totalEpisodes > 0
      ? Math.min(100, Math.round((watchedCount / totalEpisodes) * 100))
      : null;

  function markWatched() {
    setDone(true);
    startTransition(() =>
      setEpisodeWatched({
        showTmdbId,
        seasonNumber: upNext.seasonNumber,
        episodeNumber: upNext.episodeNumber,
        runtimeMinutes: upNext.runtimeMinutes,
        watched: true,
        snapshot,
      })
    );
  }

  const actions: QuickAction[] = [
    {
      key: "mark",
      icon: "✓",
      label: `Mark ${upNext.code} watched`,
      primary: true,
      onSelect: markWatched,
    },
    {
      key: "up-to",
      icon: "↧",
      label: "Mark everything up to here",
      onSelect: () => {
        startTransition(() =>
          setWatchedUpTo({
            showTmdbId,
            seasonNumber: upNext.seasonNumber,
            episodeNumber: upNext.episodeNumber,
            snapshot,
          })
        );
      },
    },
    {
      key: "hold",
      icon: "⏸",
      label: "Put show on hold",
      onSelect: () => {
        startTransition(() => quickSetStatus(showTmdbId, "tv", "on_hold"));
      },
    },
    {
      key: "favorite",
      icon: favorite ? "♥" : "♡",
      label: favorite ? "Remove from favourites" : "Add to favourites",
      onSelect: () => {
        startTransition(() =>
          upsertLibraryItem({
            tmdbId: showTmdbId,
            mediaType: "tv",
            snapshot,
            patch: { favorite: !favorite },
          })
        );
      },
    },
  ];

  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          Up next
        </h2>
        {lastWatchedLabel && (
          <span className="text-xs text-neutral-600">
            watched {lastWatchedLabel}
          </span>
        )}
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-elev-sm)]">
        <div className="absolute inset-0">
          {backdrop && (
            <Image
              src={backdrop}
              alt=""
              fill
              sizes="600px"
              className="object-cover opacity-35"
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(105deg, var(--color-bg) 34%, rgba(22,24,38,0.72) 62%, rgba(22,24,38,0.4))",
            }}
          />
        </div>

        <Link href={href} className="relative flex gap-3.5 p-3.5">
          <div className="aspect-[2/3] w-[78px] shrink-0 overflow-hidden rounded-lg shadow-[var(--shadow-elev-md)]">
            {poster && (
              <Image
                src={poster}
                alt=""
                width={78}
                height={117}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <p className="text-xs uppercase tracking-[0.08em] text-accent-300">
              {title}
            </p>
            <p className="text-[19px] font-medium leading-tight tracking-tight text-pretty">
              {upNext.code} · {upNext.name || "Next episode"}
            </p>
            <p className="text-[13px] text-neutral-500">
              {[
                formatRuntime(upNext.runtimeMinutes),
                upNext.airDate && `aired ${formatDate(upNext.airDate)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {pct !== null && (
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-neutral-800">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <span className="shrink-0 text-xs text-neutral-500">
                  {watchedCount} / {totalEpisodes}
                </span>
              </div>
            )}
          </div>
        </Link>

        <div className="relative flex gap-2.5 px-3.5 pb-3.5">
          <button
            type="button"
            disabled={pending || done}
            onClick={markWatched}
            className={cn(
              "flex h-[46px] flex-1 items-center justify-center gap-2 rounded-lg border text-[15px] font-medium transition-colors",
              done
                ? "border-accent bg-accent/15 text-accent-200"
                : "border-accent text-accent-300 hover:bg-accent/10"
            )}
          >
            <span>{done ? "✓" : "▶"}</span>
            {done ? "Marked watched" : "Mark watched"}
          </button>
          <button
            type="button"
            aria-label="More"
            onClick={() => setSheetOpen(true)}
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-lg border border-neutral-800 text-[17px] text-neutral-400 transition-colors hover:border-accent hover:text-accent-300"
          >
            ⋯
          </button>
        </div>
      </div>

      <QuickActionsSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={title}
        subtitle={[upNext.code, upNext.name].filter(Boolean).join(" · ")}
        actions={actions}
      />
    </section>
  );
}
