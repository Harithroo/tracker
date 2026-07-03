import type { Metadata } from "next";
import { updatePassword } from "@/actions/auth";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Update password" };

// Reached from the password recovery email link (which establishes a session),
// so this lives outside the (auth) group — that group redirects signed-in users.
export default function UpdatePasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <h1 className="mb-6 text-lg font-semibold">Choose a new password</h1>
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
      </div>
    </div>
  );
}
