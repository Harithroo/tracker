export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
}

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatWatchTime(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  if (days === 0) return `${hours}h`;
  return `${days}d ${hours}h`;
}

export function formatDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Episode code like S2E5 */
export function epCode(season: number, episode: number): string {
  return `S${season}E${episode}`;
}

export function isAired(airDate: string | null | undefined): boolean {
  if (!airDate) return false;
  return new Date(airDate + "T23:59:59") <= new Date();
}

/** ISO timestamp for N days before now — the cutoff for "recent" queries. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Compact "Xh Ym" duration for short windows (e.g. a week's watch time). */
export function formatShortDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Relative "2h ago" / "3d ago" label for a timestamp. */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Consecutive-day streak ending today or yesterday, given a set of activity dates (YYYY-MM-DD). */
export function computeStreak(dates: Iterable<string>): number {
  const dateSet = new Set(dates);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  let streak = 0;
  const day = new Date();
  if (!dateSet.has(iso(day))) day.setDate(day.getDate() - 1);
  while (dateSet.has(iso(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}
