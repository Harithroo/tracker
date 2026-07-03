import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { statusLabel, type LibraryItem, type WatchStatus } from "@/types/library";
import { PosterCard } from "@/components/media/PosterCard";

export const metadata: Metadata = { title: "Library" };

const TABS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "watching", label: "Watching" },
  { value: "completed", label: "Completed" },
  { value: "plan_to_watch", label: "Plan to Watch" },
  { value: "on_hold", label: "On Hold" },
  { value: "dropped", label: "Dropped" },
  { value: "favorites", label: "♥ Favorites" },
];

const STATUS_VALUES: WatchStatus[] = [
  "watching",
  "completed",
  "plan_to_watch",
  "on_hold",
  "dropped",
];

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "all" } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  let query = supabase
    .from("library_items")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (filter === "favorites") {
    query = query.eq("favorite", true);
  } else if (STATUS_VALUES.includes(filter as WatchStatus)) {
    query = query.eq("status", filter);
  }

  const { data } = await query;
  const items = (data ?? []) as LibraryItem[];

  // Episode progress for TV items
  const tvIds = items
    .filter((i) => i.media_type === "tv")
    .map((i) => i.tmdb_id);
  const watchedCounts = new Map<number, number>();
  if (tvIds.length > 0) {
    const { data: epRows } = await supabase
      .from("episode_watches")
      .select("tmdb_show_id")
      .eq("user_id", userId)
      .in("tmdb_show_id", tvIds);
    for (const row of epRows ?? []) {
      watchedCounts.set(
        row.tmdb_show_id,
        (watchedCounts.get(row.tmdb_show_id) ?? 0) + 1
      );
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Library</h1>

      <div className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "all" ? "/library" : `/library?filter=${tab.value}`}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              filter === tab.value
                ? "bg-accent text-white"
                : "bg-surface text-muted hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          Nothing here yet.{" "}
          <Link href="/search" className="text-accent hover:text-accent-hover">
            Search for something to add →
          </Link>
        </div>
      ) : (
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
                    : item.media_type === "tv"
                      ? "TV"
                      : "Movie",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                badge={item.rating ? `★ ${item.rating}` : null}
                progress={progress}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
