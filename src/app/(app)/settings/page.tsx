import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { logout, updatePassword, updateUsername } from "@/actions/auth";
import { AuthForm } from "@/components/auth/AuthForm";
import { ImportExport } from "@/components/settings/ImportExport";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user!.id)
    .single();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-1 text-lg font-semibold">Profile</h2>
        <p className="mb-5 text-sm text-muted">Signed in as {user!.email}</p>
        <AuthForm
          action={updateUsername}
          fields={[
            {
              name: "username",
              label: "Username",
              type: "text",
              defaultValue: profile?.username ?? "",
            },
          ]}
          submitLabel="Save username"
          pendingLabel="Saving…"
        />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-5 text-lg font-semibold">Change password</h2>
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
      </section>

      <ImportExport />

      <section className="rounded-2xl border border-border bg-surface p-6">
        <form action={logout}>
          <button
            type="submit"
            className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-950/70"
          >
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}
