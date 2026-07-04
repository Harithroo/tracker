import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { searchMulti } from "@/lib/tmdb/client";
import { cn, yearOf } from "@/lib/utils";
import type { TmdbSearchResult } from "@/lib/tmdb/types";
import type { WatchStatus } from "@/types/library";
import { PosterCard } from "@/components/media/PosterCard";

export const metadata: Metadata = { title: "Search" };

const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Shows" },
] as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { q = "", type = "all" } = await searchParams;
  const query = q.trim();

  let results: TmdbSearchResult[] = [];
  let error: string | null = null;
  if (query) {
    try {
      const res = await searchMulti(query);
      results = res.results.filter(
        (r) =>
          (r.media_type === "movie" || r.media_type === "tv") &&
          (type === "all" || r.media_type === type)
      );
    } catch (e) {
      error = e instanceof Error ? e.message : "Search failed.";
    }
  }

  // Library status for indicators + quick menus
  const libraryStatus = new Map<string, WatchStatus>();
  if (results.length > 0) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: rows } = await supabase
      .from("library_items")
      .select("tmdb_id, media_type, status")
      .eq("user_id", user!.id)
      .in(
        "tmdb_id",
        results.map((r) => r.id)
      );
    for (const row of rows ?? []) {
      libraryStatus.set(`${row.media_type}:${row.tmdb_id}`, row.status);
    }
  }

  return (
    <div>
      <form action="/search" className="mb-4">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search movies and TV shows…"
          autoFocus
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition-colors focus:border-accent"
        />
        {type !== "all" && <input type="hidden" name="type" value={type} />}
      </form>

      {query && (
        <div className="mb-6 flex gap-2">
          {TYPE_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={`/search?q=${encodeURIComponent(query)}${tab.value === "all" ? "" : `&type=${tab.value}`}`}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                type === tab.value
                  ? "bg-accent text-white"
                  : "bg-surface text-muted hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-300">
          {error}
        </div>
      )}

      {!query && !error && (
        <p className="py-16 text-center text-sm text-muted">
          Search TMDB for movies and TV shows to add to your library.
        </p>
      )}

      {query && !error && results.length === 0 && (
        <p className="py-16 text-center text-sm text-muted">
          No results for “{query}”.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {results.map((item) => {
          const isTv = item.media_type === "tv";
          return (
            <PosterCard
              key={`${item.media_type}-${item.id}`}
              href={`/${item.media_type}/${item.id}`}
              posterPath={item.poster_path}
              title={(isTv ? item.name : item.title) ?? ""}
              subtitle={[
                yearOf(isTv ? item.first_air_date : item.release_date),
                isTv ? "TV" : "Movie",
              ]
                .filter(Boolean)
                .join(" · ")}
              badge={item.vote_average ? `★ ${item.vote_average.toFixed(1)}` : null}
              quick={{
                tmdbId: item.id,
                mediaType: item.media_type as "movie" | "tv",
                status: libraryStatus.get(`${item.media_type}:${item.id}`) ?? null,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
