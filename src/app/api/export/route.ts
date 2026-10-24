import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/firebase/admin";
import { episodeWatches, libraryItems } from "@/lib/mongo/client";
import { BACKUP_FORMAT } from "@/lib/import/backup";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let library, episodes;
  try {
    [library, episodes] = await Promise.all([
      (await libraryItems())
        .find({ user_id: user.id })
        .project({
          _id: 0,
          tmdb_id: 1,
          media_type: 1,
          status: 1,
          rating: 1,
          favorite: 1,
          notes: 1,
          started_at: 1,
          finished_at: 1,
          title: 1,
        })
        .toArray(),
      (await episodeWatches())
        .find({ user_id: user.id })
        .project({
          _id: 0,
          tmdb_show_id: 1,
          season_number: 1,
          episode_number: 1,
          watched_at: 1,
        })
        .toArray(),
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
