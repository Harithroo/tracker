"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet on mobile, centered modal on desktop — the one overlay
 * primitive used for quick actions and search across the app.
 */
export function Sheet({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-[3px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-4 pb-7 shadow-[var(--shadow-elev-lg)] md:max-h-[80vh] md:rounded-2xl md:p-5",
          className
        )}
      >
        <div className="mx-auto mb-4 h-1 w-9 shrink-0 rounded-full bg-neutral-700 md:hidden" />
        {children}
      </div>
    </div>,
    document.body
  );
}
