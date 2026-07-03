import Image from "next/image";
import Link from "next/link";
import { posterUrl } from "@/lib/tmdb/images";

export function PosterCard({
  href,
  posterPath,
  title,
  subtitle,
  badge,
  progress,
}: {
  href: string;
  posterPath: string | null;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  progress?: number; // 0–100
}) {
  const src = posterUrl(posterPath);

  return (
    <Link href={href} className="group block">
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
  );
}
