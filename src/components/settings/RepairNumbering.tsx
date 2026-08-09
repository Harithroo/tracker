"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { listShowsToRepair, repairShowNumbering } from "@/actions/episodes";
import type { RepairResult } from "@/types/library";

type Phase = "idle" | "running" | "done";

const BATCH_SIZE = 5;

export function RepairNumbering() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [current, setCurrent] = useState<string | null>(null);
  const [results, setResults] = useState<RepairResult[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  async function run() {
    setPhase("running");
    setResults([]);
    setFailure(null);
    const all: RepairResult[] = [];
    try {
      const shows = await listShowsToRepair();
      setProgress({ done: 0, total: shows.length });
      for (let i = 0; i < shows.length; i += BATCH_SIZE) {
        const batch = shows.slice(i, i + BATCH_SIZE);
        setCurrent(batch[0].title);
        all.push(...(await repairShowNumbering(batch.map((s) => s.tmdbId))));
        setProgress({ done: Math.min(i + BATCH_SIZE, shows.length), total: shows.length });
      }
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Repair stopped unexpectedly.");
    }
    setCurrent(null);
    setResults(all);
    setPhase("done");
    router.refresh();
  }

  const changed = results.filter((r) => r.moved > 0 || r.dropped > 0);
  const failed = results.filter((r) => r.error);
  const moved = results.reduce((n, r) => n + r.moved, 0);
  const dropped = results.reduce((n, r) => n + r.dropped, 0);

  return (
    <div className="space-y-3 text-sm">
      <p className="text-neutral-500">
        Imported watch history keeps the numbering its source used, which can disagree with
        TMDB — most often on long-running anime, where TMDB numbers episodes straight through
        instead of restarting each season. Those watches don&apos;t line up with any episode,
        so they never show as ticked but still count towards progress. This walks your shows
        and puts every watch back on the episode it belongs to.
      </p>

      {phase !== "running" && (
        <button
          type="button"
          onClick={() => void run()}
          className="rounded-lg border border-neutral-800 px-3.5 py-2 text-[15px] transition-colors hover:border-accent hover:text-accent-300"
        >
          {phase === "done" ? "Run again" : "Check my shows"}
        </button>
      )}

      {phase === "running" && (
        <div>
          <div className="mb-1.5 flex justify-between text-[13px] text-neutral-500">
            <span className="truncate pr-2">
              {current ? `Checking ${current}…` : "Checking…"}
            </span>
            <span className="shrink-0">
              {progress.done} / {progress.total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-neutral-600">Don&apos;t close this page.</p>
        </div>
      )}

      {failure && (
        <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-red-300">
          {failure} Shows checked so far have been repaired — run it again to finish.
        </p>
      )}

      {phase === "done" && !failure && (
        <p className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-emerald-300">
          {changed.length === 0
            ? `Checked ${results.length} show${results.length === 1 ? "" : "s"} — every watch already lines up.`
            : `Repaired ${changed.length} show${changed.length === 1 ? "" : "s"} — ${moved.toLocaleString()} watch${moved === 1 ? "" : "es"} renumbered, ${dropped.toLocaleString()} removed.`}
        </p>
      )}

      {changed.length > 0 && (
        <details className="rounded-lg border border-neutral-800 p-3">
          <summary className="cursor-pointer">What changed</summary>
          <ul className="mt-2 space-y-1 text-neutral-500">
            {changed.map((r) => (
              <li key={r.tmdbId}>
                {r.title} — {r.moved} renumbered
                {r.dropped > 0 ? `, ${r.dropped} removed` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {failed.length > 0 && (
        <details className="rounded-lg border border-neutral-800 p-3">
          <summary className="cursor-pointer text-[#e4a0a0]">
            {failed.length} show{failed.length === 1 ? "" : "s"} couldn&apos;t be checked
          </summary>
          <ul className="mt-2 space-y-1 text-neutral-500">
            {failed.map((r) => (
              <li key={r.tmdbId}>
                {r.title} — {r.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
