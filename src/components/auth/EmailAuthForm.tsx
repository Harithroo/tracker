"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth, googleProvider } from "@/lib/firebase/client";

export type AuthMode = "login" | "signup" | "reset";

const COPY: Record<AuthMode, { submit: string; pending: string }> = {
  login: { submit: "Log in", pending: "Logging in…" },
  signup: { submit: "Sign up", pending: "Signing up…" },
  reset: { submit: "Send reset link", pending: "Sending…" },
};

/** Firebase's codes are stable; its default messages are not presentable. */
function readableError(err: unknown): string {
  const code = (err as { code?: string }).code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password.";
    case "auth/email-already-in-use":
      return "That email already has an account.";
    case "auth/weak-password":
      return "Password must be at least 8 characters.";
    case "auth/invalid-email":
      return "That doesn't look like an email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a few minutes.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    default:
      return err instanceof Error ? err.message : "Something went wrong.";
  }
}

/**
 * Signing in has to happen in the browser — the Firebase SDK is what produces
 * an ID token. The server turns that token into the httpOnly session cookie
 * every server-side auth check reads.
 */
async function startSession(
  user: User
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // A token minted before the address was confirmed still says unverified, so
  // force a refresh — otherwise clicking the email link appears to do nothing.
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: await user.getIdToken(true) }),
  });
  if (res.ok) return { ok: true };

  const body = await res.json().catch(() => ({}));
  return {
    ok: false,
    status: res.status,
    error: body.error ?? "Couldn't start a session.",
  };
}

export function EmailAuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [pending, setPending] = useState<"form" | "google" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Set when login was refused only because the address isn't confirmed. */
  const [unverified, setUnverified] = useState<User | null>(null);

  function begin(which: "form" | "google" | "resend") {
    setPending(which);
    setError(null);
    setMessage(null);
  }

  function fail(err: unknown) {
    const text = readableError(err);
    if (text) setError(text);
    setPending(null);
  }

  async function handleSubmit(formData: FormData) {
    begin("form");
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const auth = firebaseAuth();

    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email);
        setMessage("Check your email for a password reset link.");
        setPending(null);
        return;
      }

      if (mode === "signup") {
        if (password.length < 8) {
          setError("Password must be at least 8 characters.");
          setPending(null);
          return;
        }
        const { user } = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(user);
        // No session until the address is confirmed, matching the login gate;
        // the user is kept so the link can be resent if it doesn't arrive.
        setUnverified(user);
        setMessage("Check your email for a confirmation link.");
        setPending(null);
        return;
      }

      const { user } = await signInWithEmailAndPassword(auth, email, password);
      const session = await startSession(user);
      if (!session.ok) {
        // 403 is the unconfirmed-address gate. Keep the Firebase session (it
        // grants nothing without the cookie) so the email can be resent — the
        // alternative is an account with no way out but a new address.
        if (session.status === 403) setUnverified(user);
        else await signOut(auth).catch(() => {});
        setError(session.error);
        setPending(null);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      fail(err);
    }
  }

  async function handleResend() {
    if (!unverified) return;
    begin("resend");
    try {
      await sendEmailVerification(unverified);
      setMessage("Sent. Open the link, then log in again.");
    } catch (err) {
      fail(err);
      return;
    }
    setPending(null);
  }

  async function handleGoogle() {
    begin("google");
    try {
      const { user } = await signInWithPopup(firebaseAuth(), googleProvider);
      const session = await startSession(user);
      if (!session.ok) {
        await signOut(firebaseAuth()).catch(() => {});
        setError(session.error);
        setPending(null);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      fail(err);
    }
  }

  return (
    <div className="space-y-4">
      <form action={handleSubmit} className="space-y-4">
        <Field
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
        />
        {mode !== "reset" && (
          <Field
            name="password"
            label={mode === "signup" ? "Password (min. 8 characters)" : "Password"}
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 8 : undefined}
          />
        )}

        {error && (
          <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
        {unverified && (
          <button
            type="button"
            onClick={handleResend}
            disabled={pending !== null}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:border-accent disabled:opacity-50"
          >
            {pending === "resend" ? "Sending…" : "Resend confirmation email"}
          </button>
        )}
        {message && (
          <p className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={pending !== null}
          className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {pending === "form" ? COPY[mode].pending : COPY[mode].submit}
        </button>
      </form>

      {mode !== "reset" && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={pending !== null}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold transition-colors hover:border-accent disabled:opacity-50"
          >
            {pending === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
        </>
      )}
    </div>
  );
}

function Field({
  name,
  label,
  type,
  autoComplete,
  minLength,
}: {
  name: string;
  label: string;
  type: string;
  autoComplete: string;
  minLength?: number;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        required
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
      />
    </div>
  );
}
