"use client";

import { useState, useTransition } from "react";
import { quickSetStatus } from "@/actions/library";
import { cn } from "@/lib/utils";
import { QuickActionsSheet, type QuickAction } from "@/components/ui/QuickActionsSheet";
import type { MediaType, WatchStatus } from "@/types/library";

interface MenuAction {
  icon: string;
  label: string;
  status: WatchStatus | "remove";
  primary?: boolean;
}

function actionsFor(mediaType: MediaType, status?: WatchStatus | null): MenuAction[] {
  const actions: MenuAction[] = [];
  if (mediaType === "movie") {
    if (status !== "completed")
      actions.push({ icon: "✓", label: "Mark watched", status: "completed", primary: true });
    if (!status) actions.push({ icon: "+", label: "Add to watchlist", status: "plan_to_watch" });
  } else {
    if (!status || status === "plan_to_watch") {
      actions.push({ icon: "▶", label: "Start watching", status: "watching", primary: true });
    }
    if (status === "on_hold")
      actions.push({ icon: "▶", label: "Resume watching", status: "watching", primary: true });
    if (status === "watching") actions.push({ icon: "⏸", label: "Put on hold", status: "on_hold" });
    if (!status) actions.push({ icon: "+", label: "Add to watchlist", status: "plan_to_watch" });
  }
  if (status) actions.push({ icon: "✕", label: "Remove from library", status: "remove" });
  return actions;
}

/**
 * The ⋯ button on a poster. Actions open in the shared bottom sheet rather than
 * an anchored dropdown — a dropdown wider than the poster spills over its
 * neighbours and gets clipped by the carousel's horizontal scroll container.
 */
export function CardMenu({
  tmdbId,
  mediaType,
  status,
  title,
}: {
  tmdbId: number;
  mediaType: MediaType;
  status?: WatchStatus | null;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const actions: QuickAction[] = actionsFor(mediaType, status).map((action) => ({
    key: action.status,
    icon: action.icon,
    label: action.label,
    primary: action.primary,
    onSelect: () => startTransition(() => quickSetStatus(tmdbId, mediaType, action.status)),
  }));

  return (
    <>
      <button
        type="button"
        aria-label={`Quick actions for ${title}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-sm leading-none text-white backdrop-blur transition-colors hover:bg-black/80",
          pending && "animate-pulse"
        )}
      >
        {pending ? "…" : "⋯"}
      </button>
      <QuickActionsSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        actions={actions}
      />
    </>
  );
}
