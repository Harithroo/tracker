"use client";

import Link, { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * Filter-tab link that shows a pending spinner while the navigation it
 * triggered is in flight — instant feedback on slow connections.
 */
export function TabLink({
  href,
  active,
  className,
  activeClassName,
  inactiveClassName,
  children,
}: {
  href: string;
  active: boolean;
  className?: string;
  activeClassName: string;
  inactiveClassName: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(className, active ? activeClassName : inactiveClassName)}
    >
      <PendingDot />
      {children}
    </Link>
  );
}

function PendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent align-[-1px]" />
  );
}
