import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/firebase/admin";
import { episodeWatches, libraryItems } from "@/lib/mongo/client";
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
  const { id: userId } = await requireUser();
  const items = await libraryItems();

  // Shows we're tracking — their next episode to air feeds "Upcoming"
  const trackedShows = await items
    .find({
      user_id: userId,
      media_type: "tv",
      status: { $in: ["watching", "on_hold", "plan_to_watch"] },
    })
    .sort({ updated_at: -1 })
    .limit(40)
    .project<{ tmdb_id: number; title: string; poster_path: string | null }>({
      tmdb_id: 1,
      title: 1,
      poster_path: 1,
      _id: 0,
    })
    .toArray();

  const upcoming: UpcomingEntry[] = [];
  await Promise.all(
    trackedShows.map(async (item) => {
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
  const [recentEpisodes, finishedMovies] = await Promise.all([
    (await episodeWatches())
      .find({ user_id: userId })
      .sort({ watched_at: -1 })
      .limit(100)
      .project<{
        tmdb_show_id: number;
        season_number: number;
        episode_number: number;
        watched_at: string;
      }>({
        tmdb_show_id: 1,
        season_number: 1,
        episode_number: 1,
        watched_at: 1,
        _id: 0,
      })
      .toArray(),
    items
      .find({ user_id: userId, media_type: "movie", finished_at: { $ne: null } })
      .sort({ finished_at: -1 })
      .limit(50)
      .project<{
        tmdb_id: number;
        title: string;
        poster_path: string | null;
        finished_at: string;
      }>({ tmdb_id: 1, title: 1, poster_path: 1, finished_at: 1, _id: 0 })
      .toArray(),
  ]);

  // Show titles/posters for the episode rows
  const showIds = [...new Set(recentEpisodes.map((e) => e.tmdb_show_id))];
  const showInfo = new Map<number, { title: string; poster_path: string | null }>();
  if (showIds.length > 0) {
    const rows = await items
      .find({ user_id: userId, media_type: "tv", tmdb_id: { $in: showIds } })
      .project<{ tmdb_id: number; title: string; poster_path: string | null }>({
        tmdb_id: 1,
        title: 1,
        poster_path: 1,
        _id: 0,
      })
      .toArray();
    for (const row of rows) {
      showInfo.set(row.tmdb_id, { title: row.title, poster_path: row.poster_path });
    }
  }

  const history: HistoryEntry[] = [
    ...recentEpisodes.map((ep) => ({
      key: `ep-${ep.tmdb_show_id}-${ep.season_number}-${ep.episode_number}`,
      href: `/tv/${ep.tmdb_show_id}`,
      title: showInfo.get(ep.tmdb_show_id)?.title ?? `Show #${ep.tmdb_show_id}`,
      posterPath: showInfo.get(ep.tmdb_show_id)?.poster_path ?? null,
      detail: epCode(ep.season_number, ep.episode_number),
      date: ep.watched_at.slice(0, 10),
    })),
    ...finishedMovies.map((m) => ({
      key: `movie-${m.tmdb_id}`,
      href: `/movie/${m.tmdb_id}`,
      title: m.title,
      posterPath: m.poster_path,
      detail: "Movie",
      date: m.finished_at.slice(0, 10),
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
