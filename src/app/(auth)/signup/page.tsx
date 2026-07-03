import Link from "next/link";
import type { Metadata } from "next";
import { signup } from "@/actions/auth";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h1 className="mb-6 text-lg font-semibold">Create your account</h1>
      <AuthForm
        action={signup}
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Password (min. 8 characters)",
            type: "password",
            autoComplete: "new-password",
            minLength: 8,
          },
        ]}
        submitLabel="Sign up"
        pendingLabel="Signing up…"
      />
      <p className="mt-4 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:text-accent-hover">
          Log in
        </Link>
      </p>
    </div>
  );
}
