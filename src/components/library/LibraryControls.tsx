"use client";

import { useState, useTransition } from "react";
import { removeLibraryItem, upsertLibraryItem } from "@/actions/library";
import { cn } from "@/lib/utils";
import {
  MOVIE_STATUSES,
  TV_STATUSES,
  statusLabel,
  type MediaSnapshot,
  type MediaType,
  type WatchStatus,
} from "@/types/library";

interface ItemState {
  status: WatchStatus;
  rating: number | null;
  favorite: boolean;
  notes: string | null;
}

export function LibraryControls({
  tmdbId,
  mediaType,
  snapshot,
  item,
}: {
  tmdbId: number;
  mediaType: MediaType;
  snapshot: MediaSnapshot;
  item: ItemState | null;
}) {
  const [local, setLocal] = useState<ItemState | null>(item);
  const [notesDraft, setNotesDraft] = useState(item?.notes ?? "");
  const [showNotes, setShowNotes] = useState(false);
  const [pending, startTransition] = useTransition();

  const statuses = mediaType === "movie" ? MOVIE_STATUSES : TV_STATUSES;

  function apply(patch: Partial<ItemState>) {
    const next: ItemState = {
      status:
        patch.status ??
        local?.status ??
        (mediaType === "movie" ? "completed" : "watching"),
      rating: patch.rating !== undefined ? patch.rating : (local?.rating ?? null),
      favorite: patch.favorite ?? local?.favorite ?? false,
      notes: patch.notes !== undefined ? patch.notes : (local?.notes ?? null),
    };
    setLocal(next);
    startTransition(() =>
      upsertLibraryItem({ tmdbId, mediaType, snapshot, patch })
    );
  }

  function handleStatusChange(value: string) {
    if (value === "__remove") {
      setLocal(null);
      setNotesDraft("");
      setShowNotes(false);
      startTransition(() => removeLibraryItem(tmdbId, mediaType));
      return;
    }
    if (value) apply({ status: value as WatchStatus });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={local?.status ?? ""}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={pending}
          className={cn(
            "rounded-lg border border-border px-3 py-2 text-sm font-medium outline-none transition-colors focus:border-accent",
            local ? "bg-accent/15 text-accent" : "bg-surface-2"
          )}
        >
          {!local && <option value="">+ Add to library</option>}
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s, mediaType)}
            </option>
          ))}
          {local && <option value="__remove">Remove from library</option>}
        </select>

        <button
          type="button"
          disabled={pending}
          onClick={() => apply({ favorite: !(local?.favorite ?? false) })}
          aria-label="Toggle favorite"
          className={cn(
            "rounded-lg border border-border px-3 py-2 text-sm transition-colors",
            local?.favorite
              ? "border-pink-800 bg-pink-950/40 text-pink-400"
              : "bg-surface-2 text-muted hover:text-foreground"
          )}
        >
          {local?.favorite ? "♥ Favorite" : "♡ Favorite"}
        </button>

        <button
          type="button"
          onClick={() => setShowNotes((v) => !v)}
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
        >
          Notes
        </button>
      </div>

      <div className="flex items-center gap-1">
        <span className="mr-2 text-sm text-muted">Rate</span>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => (
          <button
            key={star}
            type="button"
            disabled={pending}
            aria-label={`Rate ${star} out of 10`}
            onClick={() =>
              apply({ rating: local?.rating === star ? null : star })
            }
            className={cn(
              "text-lg leading-none transition-colors",
              local?.rating && star <= local.rating
                ? "text-amber-400"
                : "text-border hover:text-muted"
            )}
          >
            ★
          </button>
        ))}
        {local?.rating && (
          <span className="ml-2 text-sm font-semibold text-amber-400">
            {local.rating}/10
          </span>
        )}
      </div>

      {showNotes && (
        <div className="space-y-2">
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={3}
            placeholder="Your notes…"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
          />
          <button
            type="button"
            disabled={pending || notesDraft === (local?.notes ?? "")}
            onClick={() => apply({ notes: notesDraft || null })}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            Save notes
          </button>
        </div>
      )}
    </div>
  );
}
