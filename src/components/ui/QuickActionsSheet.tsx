"use client";

import { Sheet } from "./Sheet";
import { cn } from "@/lib/utils";

export interface QuickAction {
  key: string;
  icon: string;
  label: string;
  primary?: boolean;
  onSelect: () => void;
}

export function QuickActionsSheet({
  open,
  onClose,
  title,
  subtitle,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions: QuickAction[];
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      <p className="mb-0.5 text-[17px] font-medium">{title}</p>
      {subtitle && <p className="mb-4 text-sm text-neutral-500">{subtitle}</p>}
      <div className="flex flex-col gap-1.5">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => {
              action.onSelect();
              onClose();
            }}
            className={cn(
              "flex h-[50px] w-full items-center gap-3 rounded-lg border px-3.5 text-left text-[15px] transition-colors hover:bg-accent/10",
              action.primary
                ? "border-accent text-accent-200"
                : "border-neutral-800 text-neutral-400"
            )}
          >
            <span className="w-5 shrink-0 text-center">{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
