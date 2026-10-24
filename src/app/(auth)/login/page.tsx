import Link from "next/link";
import type { Metadata } from "next";
import { EmailAuthForm } from "@/components/auth/EmailAuthForm";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h1 className="mb-6 text-lg font-semibold">Welcome back</h1>
      <EmailAuthForm mode="login" />
      <div className="mt-4 flex justify-between text-sm text-muted">
        <Link href="/signup" className="hover:text-foreground">
          Create account
        </Link>
        <Link href="/reset-password" className="hover:text-foreground">
          Forgot password?
        </Link>
      </div>
    </div>
  );
}
