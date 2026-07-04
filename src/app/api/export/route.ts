import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { BACKUP_FORMAT } from "@/lib/import/backup";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let library, episodes;
  try {
    [library, episodes] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("library_items")
          .select(
            "tmdb_id, media_type, status, rating, favorite, notes, started_at, finished_at, title"
          )
          .eq("user_id", user.id)
          .order("id")
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("episode_watches")
          .select("tmdb_show_id, season_number, episode_number, watched_at")
          .eq("user_id", user.id)
          .order("id")
          .range(from, to)
      ),
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }

  const backup = {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    library,
    episodeWatches: episodes,
  };

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 1), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="tracker-backup-${date}.json"`,
    },
  });
}
