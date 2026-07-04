"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal scroller with desktop affordances: arrow buttons and
 * click-drag scrolling. A drag suppresses the click on child links.
 */
export function Carousel({ children }: { children: React.ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });
  const [dragging, setDragging] = useState(false);

  function scrollByPage(direction: 1 | -1) {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" || e.button !== 0) return; // touch scrolls natively
    const el = scrollerRef.current;
    if (!el) return;
    drag.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const state = drag.current;
    const el = scrollerRef.current;
    if (!state.active || !el) return;
    const delta = e.clientX - state.startX;
    if (Math.abs(delta) > 5 && !state.moved) {
      state.moved = true;
      setDragging(true);
      el.setPointerCapture(e.pointerId);
    }
    if (state.moved) el.scrollLeft = state.startScroll - delta;
  }

  function onPointerUp() {
    drag.current.active = false;
    // Delay so the click-capture below still sees "dragging"
    if (drag.current.moved) setTimeout(() => setDragging(false), 0);
  }

  return (
    <div className="group/carousel relative">
      <div
        ref={scrollerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          if (dragging || drag.current.moved) {
            e.preventDefault();
            e.stopPropagation();
            drag.current.moved = false;
          }
        }}
        onDragStart={(e) => e.preventDefault()}
        className={cn(
          "no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 select-none",
          dragging ? "cursor-grabbing" : "md:cursor-grab"
        )}
      >
        {children}
      </div>

      <CarouselArrow direction={-1} onClick={() => scrollByPage(-1)} />
      <CarouselArrow direction={1} onClick={() => scrollByPage(1)} />
    </div>
  );
}

function CarouselArrow({ direction, onClick }: { direction: 1 | -1; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={direction === 1 ? "Scroll right" : "Scroll left"}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-lg opacity-0 shadow-lg backdrop-blur transition-opacity hover:border-accent group-hover/carousel:opacity-100 md:flex",
        direction === 1 ? "-right-3" : "-left-3"
      )}
    >
      {direction === 1 ? "›" : "‹"}
    </button>
  );
}
