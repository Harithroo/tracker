import Link from "next/link";
import type { Metadata } from "next";
import { requestPasswordReset } from "@/actions/auth";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h1 className="mb-6 text-lg font-semibold">Reset your password</h1>
      <AuthForm
        action={requestPasswordReset}
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
        ]}
        submitLabel="Send reset link"
        pendingLabel="Sending…"
      />
      <p className="mt-4 text-sm text-muted">
        <Link href="/login" className="hover:text-foreground">
          ← Back to login
        </Link>
      </p>
    </div>
  );
}
