import Link from "next/link";
import type { Metadata } from "next";
import { EmailAuthForm } from "@/components/auth/EmailAuthForm";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h1 className="mb-6 text-lg font-semibold">Create your account</h1>
      <EmailAuthForm mode="signup" />
      <p className="mt-4 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:text-accent-hover">
          Log in
        </Link>
      </p>
    </div>
  );
}
