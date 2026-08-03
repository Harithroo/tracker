import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getShow } from "@/lib/tmdb/client";
import { posterUrl } from "@/lib/tmdb/images";
import { epCode, formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendar" };

interface UpcomingEntry {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  airDate: string;
  code: string;
  episodeName: string;
}

interface HistoryEntry {
  key: string;
  href: string;
  title: string;
  posterPath: string | null;
  detail: string;
  date: string; // YYYY-MM-DD
}

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  // Shows we're tracking — their next episode to air feeds "Upcoming"
  const { data: trackedShows } = await supabase
    .from("library_items")
    .select("tmdb_id, title, poster_path, status")
    .eq("user_id", userId)
    .eq("media_type", "tv")
    .in("status", ["watching", "on_hold", "plan_to_watch"])
    .order("updated_at", { ascending: false })
    .limit(40);

  const upcoming: UpcomingEntry[] = [];
  await Promise.all(
    (trackedShows ?? []).map(async (item) => {
      try {
        const show = await getShow(item.tmdb_id);
        const next = show.next_episode_to_air;
        if (next?.air_date) {
          upcoming.push({
            tmdbId: item.tmdb_id,
            title: item.title,
            posterPath: item.poster_path,
            airDate: next.air_date,
            code: epCode(next.season_number, next.episode_number),
            episodeName: next.name,
          });
        }
      } catch {
        // TMDB unavailable for this show — skip it
      }
    })
  );
  upcoming.sort((a, b) => a.airDate.localeCompare(b.airDate));

  // Watch history: recent episode watches + movie finishes
  const [{ data: recentEpisodes }, { data: finishedMovies }] = await Promise.all([
    supabase
      .from("episode_watches")
      .select("tmdb_show_id, season_number, episode_number, watched_at")
      .eq("user_id", userId)
      .order("watched_at", { ascending: false })
      .limit(100),
    supabase
      .from("library_items")
      .select("tmdb_id, media_type, title, poster_path, finished_at")
      .eq("user_id", userId)
      .eq("media_type", "movie")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(50),
  ]);

  // Show titles/posters for the episode rows
  const showIds = [...new Set((recentEpisodes ?? []).map((e) => e.tmdb_show_id))];
  const showInfo = new Map<number, { title: string; poster_path: string | null }>();
  if (showIds.length > 0) {
    const { data: rows } = await supabase
      .from("library_items")
      .select("tmdb_id, title, poster_path")
      .eq("user_id", userId)
      .eq("media_type", "tv")
      .in("tmdb_id", showIds);
    for (const row of rows ?? []) {
      showInfo.set(row.tmdb_id, { title: row.title, poster_path: row.poster_path });
    }
  }

  const history: HistoryEntry[] = [
    ...(recentEpisodes ?? []).map((ep) => ({
      key: `ep-${ep.tmdb_show_id}-${ep.season_number}-${ep.episode_number}`,
      href: `/tv/${ep.tmdb_show_id}`,
      title: showInfo.get(ep.tmdb_show_id)?.title ?? `Show #${ep.tmdb_show_id}`,
      posterPath: showInfo.get(ep.tmdb_show_id)?.poster_path ?? null,
      detail: epCode(ep.season_number, ep.episode_number),
      date: ep.watched_at.slice(0, 10),
    })),
    ...(finishedMovies ?? []).map((m) => ({
      key: `movie-${m.tmdb_id}`,
      href: `/movie/${m.tmdb_id}`,
      title: m.title,
      posterPath: m.poster_path,
      detail: "Movie",
      date: m.finished_at!.slice(0, 10),
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 100);

  const historyByDate = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    const list = historyByDate.get(entry.date) ?? [];
    list.push(entry);
    historyByDate.set(entry.date, list);
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-5 text-2xl font-semibold tracking-tight">Calendar</h1>
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          Airing soon
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            No upcoming episodes for the shows you&apos;re tracking.
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map((entry) => (
              <CalendarRow
                key={`${entry.tmdbId}-${entry.code}`}
                href={`/tv/${entry.tmdbId}`}
                posterPath={entry.posterPath}
                title={entry.title}
                detail={[entry.code, entry.episodeName].filter(Boolean).join(" · ")}
                right={formatDate(entry.airDate) ?? entry.airDate}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
          History
        </h2>
        {history.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            Nothing watched yet.
          </div>
        ) : (
          <div className="space-y-6">
            {[...historyByDate.entries()].map(([date, entries]) => (
              <div key={date}>
                <p className="mb-2 text-sm font-medium text-muted">
                  {formatDate(date)}
                </p>
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <CalendarRow
                      key={entry.key}
                      href={entry.href}
                      posterPath={entry.posterPath}
                      title={entry.title}
                      detail={entry.detail}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CalendarRow({
  href,
  posterPath,
  title,
  detail,
  right,
}: {
  href: string;
  posterPath: string | null;
  title: string;
  detail: string;
  right?: string;
}) {
  const poster = posterUrl(posterPath, "w185");
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2.5 transition-colors hover:border-accent"
    >
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
        {poster && (
          <Image src={poster} alt={title} fill sizes="40px" className="object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      {right && <span className="shrink-0 text-sm text-muted">{right}</span>}
    </Link>
  );
}
