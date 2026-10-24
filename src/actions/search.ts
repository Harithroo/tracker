"use server";

import { getCurrentUser } from "@/lib/firebase/admin";
import { libraryItems } from "@/lib/mongo/client";
import { searchMulti } from "@/lib/tmdb/client";
import { yearOf } from "@/lib/utils";
import type { MediaType, WatchStatus } from "@/types/library";

export interface QuickSearchResult {
  id: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterPath: string | null;
  status: WatchStatus | null;
}

/** Lightweight search used by the search sheet's inline results. */
export async function quickSearch(query: string): Promise<QuickSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const res = await searchMulti(q);
  const results = res.results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 8);
  if (results.length === 0) return [];

  const statusMap = new Map<string, WatchStatus>();
  const user = await getCurrentUser();
  if (user) {
    const rows = await (await libraryItems())
      .find({ user_id: user.id, tmdb_id: { $in: results.map((r) => r.id) } })
      .project<{ tmdb_id: number; media_type: MediaType; status: WatchStatus }>({
        tmdb_id: 1,
        media_type: 1,
        status: 1,
        _id: 0,
      })
      .toArray();
    for (const row of rows) {
      statusMap.set(`${row.media_type}:${row.tmdb_id}`, row.status);
    }
  }

  return results.map((r) => {
    const mediaType = r.media_type as MediaType;
    return {
      id: r.id,
      mediaType,
      title: (mediaType === "tv" ? r.name : r.title) ?? "",
      year: yearOf(mediaType === "tv" ? r.first_air_date : r.release_date),
      posterPath: r.poster_path,
      status: statusMap.get(`${mediaType}:${r.id}`) ?? null,
    };
  });
}
