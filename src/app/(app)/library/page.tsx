import Link from "next/link";
import type { Metadata } from "next";
import type { Filter, Sort, WithId } from "mongodb";
import { requireUser } from "@/lib/firebase/admin";
import { libraryItems } from "@/lib/mongo/client";
import { withId, type LibraryItemDoc } from "@/lib/mongo/collections";
import { getShowWatchCounts, type ShowWatchCount } from "@/lib/library/watch-counts";
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

  const { id: userId } = await requireUser();
  const collection = await libraryItems();

  const typeFilter: Filter<LibraryItemDoc> =
    type === "movie" || type === "tv"
      ? { user_id: userId, media_type: type }
      : { user_id: userId };

  const query: Filter<LibraryItemDoc> = { ...typeFilter };
  if (filter === "favorites") query.favorite = true;
  else if (STATUS_VALUES.includes(filter as WatchStatus)) {
    query.status = filter as WatchStatus;
  }

  // _id is the tiebreaker, so equal keys keep a stable order between loads.
  const order: Sort =
    sort === "title"
      ? { title: 1, _id: 1 }
      : sort === "year"
        ? { release_year: -1, _id: 1 }
        : sort === "rating"
          ? { rating: -1, _id: 1 }
          : { updated_at: -1, _id: 1 };

  const itemsPromise = collection
    .find(query)
    .sort(order)
    .project<WithId<Omit<LibraryRow, "id">>>({
      tmdb_id: 1,
      media_type: 1,
      status: 1,
      rating: 1,
      title: 1,
      poster_path: 1,
      release_year: 1,
      total_episodes: 1,
    })
    .toArray()
    .then((docs) => docs.map(withId));

  // One aggregated row per show instead of reading every episode watch
  const countsPromise =
    type === "movie"
      ? Promise.resolve(new Map<number, ShowWatchCount>())
      : getShowWatchCounts(userId);

  // Status/favorite counts (per selected type) for the filter pills
  const statsPromise = collection
    .find(typeFilter)
    .project<{ status: WatchStatus; favorite: boolean }>({
      status: 1,
      favorite: 1,
      _id: 0,
    })
    .toArray();

  const [items, watchedCounts, stats] = await Promise.all([
    itemsPromise,
    countsPromise,
    statsPromise,
  ]);

  const tabCount = (value: string): number => {
    if (value === "all") return stats.length;
    if (value === "favorites") return stats.filter((s) => s.favorite).length;
    return stats.filter((s) => s.status === value).length;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-medium tracking-tight">Library</h1>

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {items.map((item) => {
              const watched = watchedCounts.get(item.tmdb_id)?.watchedCount ?? 0;
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
