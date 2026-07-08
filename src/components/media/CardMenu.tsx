"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { quickSetStatus } from "@/actions/library";
import { cn } from "@/lib/utils";
import type { MediaType, WatchStatus } from "@/types/library";

interface MenuAction {
  label: string;
  status: WatchStatus | "remove";
}

function actionsFor(mediaType: MediaType, status?: WatchStatus | null): MenuAction[] {
  const actions: MenuAction[] = [];
  if (mediaType === "movie") {
    if (status !== "completed") actions.push({ label: "✓ Mark watched", status: "completed" });
    if (!status) actions.push({ label: "+ Add to watchlist", status: "plan_to_watch" });
  } else {
    if (!status || status === "plan_to_watch") {
      actions.push({ label: "▶ Start watching", status: "watching" });
    }
    if (status === "on_hold") actions.push({ label: "▶ Resume watching", status: "watching" });
    if (status === "watching") actions.push({ label: "⏸ Put on hold", status: "on_hold" });
    if (!status) actions.push({ label: "+ Add to watchlist", status: "plan_to_watch" });
  }
  if (status) actions.push({ label: "✕ Remove from library", status: "remove" });
  return actions;
}

export function CardMenu({
  tmdbId,
  mediaType,
  status,
}: {
  tmdbId: number;
  mediaType: MediaType;
  status?: WatchStatus | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function run(action: MenuAction) {
    setOpen(false);
    startTransition(() => quickSetStatus(tmdbId, mediaType, action.status));
  }

  return (
    <div ref={rootRef} className="absolute right-1 top-1 z-10">
      <button
        type="button"
        aria-label="Quick actions"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-sm leading-none text-white backdrop-blur transition-opacity hover:bg-black/80",
          pending && "animate-pulse"
        )}
      >
        {pending ? "…" : "⋯"}
      </button>
      {open && (
        <div className="absolute right-0 top-8 w-44 overflow-hidden rounded-lg border border-border bg-surface-2 py-1 shadow-xl">
          {actionsFor(mediaType, status).map((action) => (
            <button
              key={action.status}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                run(action);
              }}
              className="block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
