"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { unzipSync, strFromU8 } from "fflate";
import { detectAndParse } from "@/lib/import/detect";
import type { ImportItem, ImportItemResult, ImportPlan } from "@/lib/import/types";
import { cn } from "@/lib/utils";

const SOURCE_LABELS: Record<string, string> = {
  trakt: "Trakt export",
  "tvtime-gdpr": "TV Time GDPR export",
  "tracker-backup": "Tracker backup",
  "tvtime-liberator": "TV Time Liberator export",
};

type Phase = "idle" | "ready" | "running" | "done";

/** Groups items into chunks the API can process well within its time budget. */
function chunkItems(items: ImportItem[]): ImportItem[][] {
  const weight = (item: ImportItem) =>
    item.kind === "movie" ? 1 : 4 + new Set(item.episodes.map((e) => e.season)).size;
  const chunks: ImportItem[][] = [];
  let current: ImportItem[] = [];
  let currentWeight = 0;
  for (const item of items) {
    const w = weight(item);
    if (current.length > 0 && (currentWeight + w > 24 || current.length >= 40)) {
      chunks.push(current);
      current = [];
      currentWeight = 0;
    }
    current.push(item);
    currentWeight += w;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function ImportExport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ImportItemResult[]>([]);

  async function handleFile(file: File) {
    setParseError(null);
    setPlan(null);
    setResults([]);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const files = new Map<string, string>();
      const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
      if (isZip) {
        const entries = unzipSync(buffer, {
          filter: (f) => /\.(json|csv)$/i.test(f.name) && f.originalSize < 50_000_000,
        });
        for (const [path, data] of Object.entries(entries)) {
          const name = path.split("/").pop()!;
          files.set(name, strFromU8(data));
        }
      } else {
        files.set(file.name, strFromU8(buffer));
      }
      const parsed = detectAndParse(files);
      if (parsed.items.length === 0) throw new Error("No importable items found in this file.");
      setPlan(parsed);
      setPhase("ready");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to read file.");
      setPhase("idle");
    }
  }

  async function runImport() {
    if (!plan) return;
    setPhase("running");
    const all: ImportItemResult[] = [];
    try {
      if (mode === "replace") {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "reset" }),
        });
        if (!res.ok) throw new Error("Failed to clear existing library.");
      }
      const chunks = chunkItems(plan.items);
      setProgress({ done: 0, total: plan.items.length });
      let done = 0;
      for (const chunk of chunks) {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "import", items: chunk }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Import request failed (${res.status})`);
        }
        const { results: chunkResults } = (await res.json()) as { results: ImportItemResult[] };
        all.push(...chunkResults);
        done += chunk.length;
        setProgress({ done, total: plan.items.length });
      }
    } catch (err) {
      all.push({
        kind: "movie",
        title: "Import stopped",
        status: "error",
        detail: err instanceof Error ? err.message : "Unknown error",
      });
    }
    setResults(all);
    setPhase("done");
    router.refresh();
  }

  const counts = plan
    ? {
        shows: plan.items.filter((i) => i.kind === "show").length,
        episodes: plan.items.reduce(
          (n, i) => n + (i.kind === "show" ? i.episodes.length : 0),
          0
        ),
        moviesWatched: plan.items.filter((i) => i.kind === "movie" && i.watchedAt).length,
        watchlist: plan.items.filter((i) => i.watchlist).length,
      }
    : null;

  const summary = {
    imported: results.filter((r) => r.status === "imported").length,
    merged: results.filter((r) => r.status === "merged").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    episodes: results.reduce((n, r) => n + (r.episodesImported ?? 0), 0),
    problems: results.filter((r) => r.status === "unmatched" || r.status === "error"),
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold">Import</h2>
        <p className="mb-4 text-sm text-muted">
          Trakt export zip, TV Time GDPR zip, or a tracker backup file.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".zip,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <button
          type="button"
          disabled={phase === "running"}
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm font-medium transition-colors hover:border-accent disabled:opacity-50"
        >
          Choose file…
        </button>

        {parseError && (
          <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {parseError}
          </p>
        )}

        {plan && counts && phase !== "idle" && (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-border bg-surface-2 p-4 text-sm">
              <p className="mb-2 font-semibold">
                Detected: {SOURCE_LABELS[plan.source] ?? plan.source}
              </p>
              <p className="text-muted">
                {counts.shows} shows · {counts.episodes.toLocaleString()} episode watches ·{" "}
                {counts.moviesWatched.toLocaleString()} watched movies · {counts.watchlist} watchlist
                items
              </p>
            </div>

            {phase === "ready" && (
              <>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={mode === "merge"}
                      onChange={() => setMode("merge")}
                      className="accent-accent"
                    />
                    Merge (keep existing items)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={mode === "replace"}
                      onChange={() => setMode("replace")}
                      className="accent-accent"
                    />
                    Replace (wipe library first)
                  </label>
                </div>
                {mode === "replace" && (
                  <p className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
                    Replace deletes your entire library and watch history before importing —
                    including ratings, favorites, and notes.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void runImport()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
                >
                  {mode === "replace" ? "Wipe and import" : "Start import"}
                </button>
              </>
            )}

            {phase === "running" && (
              <div>
                <div className="mb-1.5 flex justify-between text-sm text-muted">
                  <span>Importing… don&apos;t close this page</span>
                  <span>
                    {progress.done} / {progress.total}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{
                      width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {phase === "done" && (
              <div className="space-y-3 text-sm">
                <p className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-emerald-300">
                  Done — {summary.imported} imported, {summary.merged} merged, {summary.skipped}{" "}
                  skipped, {summary.episodes.toLocaleString()} episode watches added
                  {summary.problems.length > 0 && `, ${summary.problems.length} problems`}.
                </p>
                {summary.problems.length > 0 && (
                  <details className="rounded-lg border border-border bg-surface-2 p-3">
                    <summary className="cursor-pointer font-medium">
                      {summary.problems.length} items need attention
                    </summary>
                    <ul className="mt-2 space-y-1 text-muted">
                      {summary.problems.map((r, i) => (
                        <li key={i}>
                          <span className={cn(r.status === "error" && "text-red-400")}>
                            [{r.status}]
                          </span>{" "}
                          {r.title}
                          {r.detail ? ` — ${r.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold">Export</h2>
        <p className="mb-4 text-sm text-muted">
          Download your full library and watch history as JSON. The file can be re-imported here —
          keep one as a backup.
        </p>
        <a
          href="/api/export"
          download
          className="inline-block rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm font-medium transition-colors hover:border-accent"
        >
          Download backup
        </a>
      </section>
    </div>
  );
}
