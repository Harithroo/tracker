import Image from "next/image";
import Link from "next/link";
import { posterUrl } from "@/lib/tmdb/images";
import type { MediaType, WatchStatus } from "@/types/library";
import { CardMenu } from "./CardMenu";

export function PosterCard({
  href,
  posterPath,
  title,
  subtitle,
  badge,
  progress,
  quick,
}: {
  href: string;
  posterPath: string | null;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  progress?: number; // 0–100
  /** Enables the status icons + ⋯ quick-action menu */
  quick?: {
    tmdbId: number;
    mediaType: MediaType;
    status?: WatchStatus | null;
  };
}) {
  const src = posterUrl(posterPath);
  const status = quick?.status;
  const indicators: { key: string; label: string; icon: React.ReactNode }[] = [];
  if (status === "completed")
    indicators.push({ key: "watched", label: "Watched", icon: <CheckIcon /> });
  else if (status === "watching")
    indicators.push({ key: "watching", label: "Watching", icon: <PlayIcon /> });
  if (status) indicators.push({ key: "library", label: "In library", icon: <BookmarkIcon /> });

  return (
    <div className="group relative">
      <Link href={href} className="block">
        <div className="relative aspect-[2/3] overflow-hidden rounded-xl border border-border bg-surface">
          {src ? (
            <Image
              src={src}
              alt={title}
              fill
              sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 170px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-3 text-center text-sm text-muted">
              {title}
            </div>
          )}
          {badge && (
            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold backdrop-blur">
              {badge}
            </span>
          )}
          {indicators.length > 0 && (
            <span className="absolute bottom-1.5 right-1.5 flex gap-1">
              {indicators.map((ind) => (
                <span
                  key={ind.key}
                  title={ind.label}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-accent backdrop-blur"
                >
                  {ind.icon}
                </span>
              ))}
            </span>
          )}
          {progress !== undefined && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          )}
        </div>
        <p className="mt-2 line-clamp-1 text-sm font-medium">{title}</p>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </Link>
      {quick && (
        <CardMenu tmdbId={quick.tmdbId} mediaType={quick.mediaType} status={quick.status} />
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.5 10 18.5 20 6" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}
