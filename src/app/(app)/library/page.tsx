import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { statusLabel, type MediaType, type WatchStatus } from "@/types/library";
import { PosterCard } from "@/components/media/PosterCard";
import { TabLink } from "@/components/ui/TabLink";

export const metadata: Metadata = { title: "Library" };

const TYPE_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "tv", label: "Shows" },
  { value: "movie", label: "Movies" },
];

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "watching", label: "Watching" },
  { value: "completed", label: "Completed" },
  { value: "plan_to_watch", label: "Plan to Watch" },
  { value: "on_hold", label: "On Hold" },
  { value: "favorites", label: "♥ Favorites" },
];

const STATUS_VALUES: WatchStatus[] = [
  "watching",
  "completed",
  "plan_to_watch",
  "on_hold",
];

interface LibraryRow {
  id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: WatchStatus;
  rating: number | null;
  title: string;
  poster_path: string | null;
  release_year: number | null;
  total_episodes: number | null;
}

const SORT_TABS: { value: string; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "title", label: "Title" },
  { value: "year", label: "Year" },
  { value: "rating", label: "Rating" },
];

function tabHref(type: string, filter: string, sort: string): string {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (filter !== "all") params.set("filter", filter);
  if (sort !== "recent") params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/library?${qs}` : "/library";
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; filter?: string; sort?: string }>;
}) {
  const { type = "all", filter = "all", sort = "recent" } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const itemsPromise = fetchAllRows<LibraryRow>((from, to) => {
    let query = supabase
      .from("library_items")
      .select(
        "id, tmdb_id, media_type, status, rating, title, poster_path, release_year, total_episodes"
      )
      .eq("user_id", userId);
    if (type === "movie" || type === "tv") query = query.eq("media_type", type);
    if (filter === "favorites") query = query.eq("favorite", true);
    else if (STATUS_VALUES.includes(filter as WatchStatus)) query = query.eq("status", filter);
    if (sort === "title") query = query.order("title", { ascending: true });
    else if (sort === "year")
      query = query.order("release_year", { ascending: false, nullsFirst: false });
    else if (sort === "rating")
      query = query.order("rating", { ascending: false, nullsFirst: false });
    else query = query.order("updated_at", { ascending: false });
    return query.order("id").range(from, to);
  });

  // One aggregated row per show instead of paging through every episode watch
  const countsPromise =
    type === "movie"
      ? Promise.resolve([])
      : supabase
          .from("episode_watch_counts")
          .select("tmdb_show_id, watched_count")
          .eq("user_id", userId)
          .then(({ data }) => data ?? []);

  // Status/favorite counts (per selected type) for the filter pills
  const statsPromise = fetchAllRows<{ status: WatchStatus; favorite: boolean }>(
    (from, to) => {
      let query = supabase
        .from("library_items")
        .select("status, favorite, id")
        .eq("user_id", userId);
      if (type === "movie" || type === "tv") query = query.eq("media_type", type);
      return query.order("id").range(from, to);
    }
  );

  const [items, counts, stats] = await Promise.all([
    itemsPromise,
    countsPromise,
    statsPromise,
  ]);
  const watchedCounts = new Map(counts.map((c) => [c.tmdb_show_id, c.watched_count]));

  const tabCount = (value: string): number => {
    if (value === "all") return stats.length;
    if (value === "favorites") return stats.filter((s) => s.favorite).length;
    return stats.filter((s) => s.status === value).length;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Library</h1>

        <div className="flex overflow-hidden rounded-lg border border-border">
          {TYPE_TABS.map((tab) => (
            <TabLink
              key={tab.value}
              href={tabHref(tab.value, filter, sort)}
              active={type === tab.value}
              className="px-3.5 py-1.5 text-sm font-semibold transition-colors"
              activeClassName="bg-accent text-white"
              inactiveClassName="bg-surface text-muted hover:text-foreground"
            >
              {tab.label}
            </TabLink>
          ))}
        </div>
      </div>

      <div className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4">
        {STATUS_TABS.map((tab) => {
          const count = tabCount(tab.value);
          if (count === 0 && tab.value !== "all") return null;
          return (
            <TabLink
              key={tab.value}
              href={tabHref(type, tab.value, sort)}
              active={filter === tab.value}
              className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
              activeClassName="bg-accent text-white"
              inactiveClassName="bg-surface text-muted hover:text-foreground"
            >
              {tab.label}
              <span className="ml-1.5 text-xs opacity-70">{count}</span>
            </TabLink>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          Nothing here yet.{" "}
          <Link href="/search" className="text-accent hover:text-accent-hover">
            Search for something to add →
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">{items.length.toLocaleString()} items</p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted">Sort</span>
              {SORT_TABS.map((tab) => (
                <TabLink
                  key={tab.value}
                  href={tabHref(type, filter, tab.value)}
                  active={sort === tab.value}
                  className="rounded-md px-2 py-1 text-xs font-medium transition-colors"
                  activeClassName="bg-accent/15 text-accent"
                  inactiveClassName="text-muted hover:text-foreground"
                >
                  {tab.label}
                </TabLink>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {items.map((item) => {
              const watched = watchedCounts.get(item.tmdb_id) ?? 0;
              const progress =
                item.media_type === "tv" &&
                item.total_episodes &&
                item.status !== "plan_to_watch"
                  ? (watched / item.total_episodes) * 100
                  : undefined;
              return (
                <PosterCard
                  key={item.id}
                  href={`/${item.media_type}/${item.tmdb_id}`}
                  posterPath={item.poster_path}
                  title={item.title}
                  subtitle={[
                    item.release_year,
                    filter === "all" || filter === "favorites"
                      ? statusLabel(item.status, item.media_type)
                      : type === "all"
                        ? item.media_type === "tv"
                          ? "TV"
                          : "Movie"
                        : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={item.rating ? `★ ${item.rating}` : null}
                  progress={progress}
                  quick={{
                    tmdbId: item.tmdb_id,
                    mediaType: item.media_type,
                    status: item.status,
                  }}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
