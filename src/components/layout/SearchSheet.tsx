"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { quickSearch, type QuickSearchResult } from "@/actions/search";
import { posterUrl } from "@/lib/tmdb/images";

const RECENTS_KEY = "tracker:recent-searches";
const MAX_RECENTS = 6;

function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(query: string) {
  const trimmed = query.trim();
  if (!trimmed || typeof window === "undefined") return;
  const next = [
    trimmed,
    ...readRecents().filter((r) => r.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, MAX_RECENTS);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

/**
 * Mounted only while open, so each opening starts from a clean slate without
 * an effect resetting state.
 */
export function SearchSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <SearchSheetContent onClose={onClose} />;
}

function SearchSheetContent({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [recents] = useState(readRecents);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [pending, startTransition] = useTransition();

  const trimmed = query.trim();
  // Results belong to whatever the last searched query was; showing them only
  // while the box is non-empty avoids clearing state from an effect.
  const shown = trimmed ? results : [];

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(() => {
      startTransition(async () => {
        setResults(await quickSearch(q));
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function goToFullSearch(q: string) {
    if (!q.trim()) return;
    pushRecent(q);
    onClose();
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <Sheet open onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          goToFullSearch(query);
        }}
        className="mb-4 flex items-center gap-2.5 rounded-lg border border-accent px-3.5 py-3"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="shrink-0 text-accent-300"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shows and movies"
          className="w-full bg-transparent text-[15px] text-text outline-none placeholder:text-neutral-500"
        />
      </form>

      {trimmed ? (
        <div className="flex flex-col gap-1">
          {shown.map((r) => {
            const poster = posterUrl(r.posterPath, "w185");
            return (
              <Link
                key={`${r.mediaType}-${r.id}`}
                href={`/${r.mediaType}/${r.id}`}
                onClick={() => {
                  pushRecent(r.title);
                  onClose();
                }}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent/10"
              >
                <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
                  {poster && (
                    <Image src={poster} alt="" fill sizes="40px" className="object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-neutral-500">
                    {[r.year, r.mediaType === "tv" ? "TV" : "Movie"]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </Link>
            );
          })}
          {!pending && shown.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-neutral-500">
              No results for &ldquo;{trimmed}&rdquo;.
            </p>
          )}
          <button
            type="button"
            onClick={() => goToFullSearch(query)}
            className="mt-1 px-2 py-2 text-left text-sm text-accent-300 transition-colors hover:text-accent-200"
          >
            See all results →
          </button>
        </div>
      ) : (
        <>
          <p className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
            Recent
          </p>
          {recents.length === 0 ? (
            <p className="px-1 py-4 text-sm text-neutral-500">
              No recent searches yet.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {recents.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => goToFullSearch(q)}
                  className="flex h-[46px] items-center gap-3 rounded-lg border border-neutral-800 px-3.5 text-left text-[15px] text-neutral-400 transition-colors hover:border-accent hover:text-accent-200"
                >
                  <span className="w-5 shrink-0 text-center text-neutral-600">↺</span>
                  {q}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
