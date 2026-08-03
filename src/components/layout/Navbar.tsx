"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/actions/auth";
import { cn } from "@/lib/utils";
import { SearchSheet } from "./SearchSheet";

const LINKS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/library", label: "Library", icon: LibraryIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/you", label: "You", icon: YouIcon },
];

export function Navbar() {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Desktop top bar */}
      <header className="sticky top-0 z-40 hidden border-b border-neutral-800 bg-bg/80 backdrop-blur md:block">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
          <Link href="/" className="mr-6 text-lg font-semibold tracking-tight">
            <span className="text-accent-300">▸</span> Tracker
          </Link>
          {LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive(href)
                  ? "bg-accent-900 text-accent-200"
                  : "text-neutral-500 hover:text-text"
              )}
            >
              {label}
            </Link>
          ))}
          <button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
            className="ml-2 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-accent-900 hover:text-accent-200"
          >
            <SearchIcon />
          </button>
          <form action={logout} className="ml-auto">
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-500 transition-colors hover:text-text"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-bg from-60% to-transparent pt-3.5 md:hidden">
        <div className="mx-auto h-px max-w-6xl bg-gradient-to-r from-transparent via-neutral-800 to-transparent" />
        <div className="flex h-[72px] items-center justify-around px-1.5">
          {LINKS.slice(0, 2).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                isActive(href) ? "text-accent-300" : "text-neutral-600"
              )}
            >
              <Icon />
              {label}
            </Link>
          ))}
          <button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
            className="mx-1 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-accent bg-accent-900 text-accent-200 shadow-[0_0_0_6px_rgba(145,132,217,0.06)] transition-colors hover:bg-accent-800"
          >
            <SearchIcon size={21} />
          </button>
          {LINKS.slice(2).map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                isActive(href) ? "text-accent-300" : "text-neutral-600"
              )}
            >
              <Icon />
              {label}
            </Link>
          ))}
        </div>
      </nav>

      <SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function YouIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}
