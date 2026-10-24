"use client";

import { useState } from "react";
import { signOut } from "firebase/auth";
import { logout, updatePassword, updateUsername } from "@/actions/auth";
import { AuthForm } from "@/components/auth/AuthForm";
import { firebaseAuth } from "@/lib/firebase/client";
import { cn } from "@/lib/utils";
import { ImportExport } from "./ImportExport";
import { RepairNumbering } from "./RepairNumbering";

type RowKey = "username" | "password" | "import" | "repair";

export function AccountSection({
  username,
  email,
}: {
  username: string;
  email: string;
}) {
  const [open, setOpen] = useState<RowKey | null>(null);

  function toggle(key: RowKey) {
    setOpen((cur) => (cur === key ? null : key));
  }

  return (
    <div className="overflow-hidden rounded-lg bg-neutral-900">
      <Row
        label="Username"
        value={username}
        expanded={open === "username"}
        onClick={() => toggle("username")}
      >
        <AuthForm
          action={updateUsername}
          fields={[
            { name: "username", label: "Username", type: "text", defaultValue: username },
          ]}
          submitLabel="Save username"
          pendingLabel="Saving…"
        />
      </Row>

      <Row label="Email" value={email} />

      <Row
        label="Change password"
        value="›"
        expanded={open === "password"}
        onClick={() => toggle("password")}
      >
        <AuthForm
          action={updatePassword}
          fields={[
            {
              name: "password",
              label: "New password (min. 8 characters)",
              type: "password",
              autoComplete: "new-password",
              minLength: 8,
            },
          ]}
          submitLabel="Update password"
          pendingLabel="Updating…"
        />
      </Row>

      <Row
        label="Import / Export"
        value="›"
        expanded={open === "import"}
        onClick={() => toggle("import")}
      >
        <ImportExport />
      </Row>

      <Row
        label="Fix episode numbering"
        value="›"
        expanded={open === "repair"}
        onClick={() => toggle("repair")}
      >
        <RepairNumbering />
      </Row>

      {/* Clearing the browser SDK's own record too, so the next sign-in
          doesn't silently reuse this account. */}
      <form
        action={async () => {
          await signOut(firebaseAuth()).catch(() => {});
          await logout();
        }}
      >
        <button
          type="submit"
          className="flex w-full items-center justify-between px-3.5 py-3.5 text-left text-sm text-[#e4a0a0] transition-colors hover:bg-black/10"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

function Row({
  label,
  value,
  expanded,
  onClick,
  children,
}: {
  label: string;
  value?: string;
  expanded?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-neutral-800">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex w-full items-center justify-between px-3.5 py-3.5 text-left text-sm transition-colors hover:bg-black/10",
            expanded && "text-accent-200"
          )}
        >
          <span>{label}</span>
          <span className="text-[13px] text-neutral-600">{value}</span>
        </button>
      ) : (
        <div className="flex items-center justify-between px-3.5 py-3.5 text-sm">
          <span>{label}</span>
          <span className="text-[13px] text-neutral-600">{value}</span>
        </div>
      )}
      {expanded && <div className="px-3.5 pb-4 pt-1">{children}</div>}
    </div>
  );
}
