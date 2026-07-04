import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ImportItem, ImportItemResult, MovieImportItem, ShowImportItem } from "@/lib/import/types";

const TMDB_BASE = "https://api.themoviedb.org/3";

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(TMDB_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_TOKEN}`,
        accept: "application/json",
      },
      // Metadata is stable; cache resolution lookups across chunks
      next: { revalidate: 60 * 60 * 24 },
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      continue;
    }
    if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`);
    return res.json();
  }
}

interface TmdbFindResult {
  movie_results?: { id: number }[];
  tv_results?: { id: number }[];
}

async function resolveMovieId(item: MovieImportItem): Promise<number | null> {
  if (item.tmdbId) return item.tmdbId;
  if (item.imdbId) {
    const found = await tmdb<TmdbFindResult>(`/find/${item.imdbId}`, {
      external_source: "imdb_id",
    }).catch(() => null);
    if (found?.movie_results?.[0]) return found.movie_results[0].id;
  }
  const search = await tmdb<{ results: { id: number }[] }>("/search/movie", {
    query: item.title,
    ...(item.year ? { year: String(item.year) } : {}),
  }).catch(() => null);
  return search?.results?.[0]?.id ?? null;
}

async function resolveShowId(item: ShowImportItem): Promise<number | null> {
  if (item.tmdbId) return item.tmdbId;
  if (item.tvdbId) {
    const found = await tmdb<TmdbFindResult>(`/find/${item.tvdbId}`, {
      external_source: "tvdb_id",
    }).catch(() => null);
    if (found?.tv_results?.[0]) return found.tv_results[0].id;
  }
  if (item.imdbId) {
    const found = await tmdb<TmdbFindResult>(`/find/${item.imdbId}`, {
      external_source: "imdb_id",
    }).catch(() => null);
    if (found?.tv_results?.[0]) return found.tv_results[0].id;
  }
  const search = await tmdb<{ results: { id: number }[] }>("/search/tv", {
    query: item.title,
  }).catch(() => null);
  return search?.results?.[0]?.id ?? null;
}

const dateOf = (ts: string | null | undefined) => (ts ? ts.slice(0, 10) : null);
const clampRating = (r: number | null | undefined) =>
  typeof r === "number" && r >= 1 && r <= 10 ? Math.round(r) : null;

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function importMovie(
  supabase: Supabase,
  userId: string,
  item: MovieImportItem
): Promise<ImportItemResult> {
  const base: ImportItemResult = { kind: "movie", title: item.title, status: "imported" };
  const tmdbId = await resolveMovieId(item);
  if (!tmdbId) return { ...base, status: "unmatched", detail: "No TMDB match" };

  const { data: existing } = await supabase
    .from("library_items")
    .select("id")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", "movie")
    .maybeSingle();
  if (existing) return { ...base, status: "skipped", detail: "Already in library" };

  const details = await tmdb<{
    title: string;
    poster_path: string | null;
    release_date: string;
    runtime: number | null;
    genres: { id: number }[];
  }>(`/movie/${tmdbId}`).catch(() => null);

  const { error } = await supabase.from("library_items").insert({
    user_id: userId,
    tmdb_id: tmdbId,
    media_type: "movie",
    status: item.watchedAt ? "completed" : "plan_to_watch",
    rating: clampRating(item.rating),
    finished_at: dateOf(item.watchedAt),
    title: details?.title ?? item.title,
    poster_path: details?.poster_path ?? null,
    release_year: Number((details?.release_date ?? "").slice(0, 4)) || item.year || null,
    runtime_minutes: details?.runtime ?? null,
    genre_ids: details?.genres?.map((g) => g.id) ?? [],
  });
  if (error) return { ...base, status: "error", detail: error.message };
  return base;
}

async function importShow(
  supabase: Supabase,
  userId: string,
  item: ShowImportItem
): Promise<ImportItemResult> {
  const base: ImportItemResult = { kind: "show", title: item.title, status: "imported" };
  const tmdbId = await resolveShowId(item);
  if (!tmdbId) return { ...base, status: "unmatched", detail: "No TMDB match" };

  const details = await tmdb<{
    name: string;
    poster_path: string | null;
    first_air_date: string | null;
    number_of_episodes: number;
    episode_run_time: number[];
    genres: { id: number }[];
  }>(`/tv/${tmdbId}`).catch(() => null);
  const fallbackRuntime = details?.episode_run_time?.[0] ?? null;
  const totalEpisodes = details?.number_of_episodes ?? null;

  // Per-episode runtimes for the seasons being imported
  const runtimes = new Map<string, number | null>();
  const seasons = [...new Set(item.episodes.map((e) => e.season))];
  await Promise.all(
    seasons.map(async (seasonNum) => {
      const season = await tmdb<{ episodes: { episode_number: number; runtime: number | null }[] }>(
        `/tv/${tmdbId}/season/${seasonNum}`
      ).catch(() => null);
      for (const ep of season?.episodes ?? []) {
        runtimes.set(`${seasonNum}:${ep.episode_number}`, ep.runtime ?? fallbackRuntime);
      }
    })
  );

  let episodesImported = 0;
  if (item.episodes.length > 0) {
    const rows = item.episodes.map((ep) => ({
      user_id: userId,
      tmdb_show_id: tmdbId,
      season_number: ep.season,
      episode_number: ep.episode,
      runtime_minutes: runtimes.get(`${ep.season}:${ep.episode}`) ?? fallbackRuntime,
      watched_at: ep.watchedAt ?? new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await supabase
        .from("episode_watches")
        .upsert(rows.slice(i, i + 500), {
          onConflict: "user_id,tmdb_show_id,season_number,episode_number",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) return { ...base, status: "error", detail: error.message };
      episodesImported += data?.length ?? 0;
    }
  }

  const { data: existing } = await supabase
    .from("library_items")
    .select("id")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", "tv")
    .maybeSingle();
  if (existing) {
    return { ...base, status: episodesImported > 0 ? "merged" : "skipped", episodesImported };
  }

  const nonSpecial = item.episodes.filter((e) => e.season > 0).length;
  const dates = item.episodes.map((e) => e.watchedAt).filter(Boolean).sort() as string[];
  const isComplete = totalEpisodes !== null && totalEpisodes > 0 && nonSpecial >= totalEpisodes;
  const status = item.archived
    ? "on_hold"
    : isComplete
      ? "completed"
      : item.episodes.length > 0
        ? "watching"
        : "plan_to_watch";

  const { error } = await supabase.from("library_items").insert({
    user_id: userId,
    tmdb_id: tmdbId,
    media_type: "tv",
    status,
    rating: clampRating(item.rating),
    started_at: dateOf(dates[0]),
    finished_at: status === "completed" ? dateOf(dates[dates.length - 1]) : null,
    title: details?.name ?? item.title,
    poster_path: details?.poster_path ?? null,
    release_year: Number((details?.first_air_date ?? "").slice(0, 4)) || item.year || null,
    runtime_minutes: fallbackRuntime,
    genre_ids: details?.genres?.map((g) => g.id) ?? [],
    total_episodes: totalEpisodes,
  });
  if (error) return { ...base, status: "error", detail: error.message };
  return { ...base, episodesImported };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { op?: string; items?: ImportItem[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.op === "reset") {
    const del1 = await supabase.from("episode_watches").delete().eq("user_id", user.id);
    const del2 = await supabase.from("library_items").delete().eq("user_id", user.id);
    const error = del1.error ?? del2.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true });
  }

  if (body.op === "import") {
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return NextResponse.json({ error: "items must contain 1–50 entries" }, { status: 400 });
    }
    const results: ImportItemResult[] = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index];
        try {
          if (item.kind === "movie") results[index] = await importMovie(supabase, user.id, item);
          else if (item.kind === "show") results[index] = await importShow(supabase, user.id, item);
          else results[index] = { kind: "movie", title: "(unknown)", status: "error", detail: "Bad item kind" };
        } catch (err) {
          results[index] = {
            kind: item.kind ?? "movie",
            title: item.title ?? "(unknown)",
            status: "error",
            detail: err instanceof Error ? err.message : "Unknown error",
          };
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    revalidatePath("/", "layout");
    return NextResponse.json({ results });
  }

  return NextResponse.json({ error: "Unknown op" }, { status: 400 });
}
