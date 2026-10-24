import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  adminAuth,
} from "@/lib/firebase/admin";
import { profiles } from "@/lib/mongo/client";

/**
 * Trades a Firebase ID token for an httpOnly session cookie.
 *
 * The browser SDK holds its token in web storage, which Server Components
 * can't read; the cookie is what every server-side auth check runs on. The
 * profile document is created here rather than by a signup hook, so it also
 * exists for accounts created through Google.
 */
export async function POST(request: Request) {
  let idToken: string | undefined;
  try {
    ({ idToken } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!idToken) {
    return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
  }

  let auth;
  try {
    auth = adminAuth();
  } catch (err) {
    // A missing service account is a deployment problem, not a bad password:
    // say so in the shape the form can render instead of crashing the route.
    console.error("Firebase Admin is unavailable:", err);
    return NextResponse.json(
      { error: "Sign-in is misconfigured on the server. Check the logs." },
      { status: 500 }
    );
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  // Email/password accounts have to confirm their address first; Google has
  // already verified it.
  if (decoded.firebase.sign_in_provider === "password" && !decoded.email_verified) {
    return NextResponse.json(
      { error: "Check your email for a confirmation link before logging in." },
      { status: 403 }
    );
  }

  const sessionCookie = await auth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  const email = decoded.email ?? null;
  await (
    await profiles()
  ).updateOne(
    { _id: decoded.uid },
    {
      $set: { email, avatar_url: (decoded.picture as string | undefined) ?? null },
      $setOnInsert: {
        username:
          (decoded.name as string | undefined) ?? email?.split("@")[0] ?? "you",
        created_at: new Date().toISOString(),
      },
    },
    { upsert: true }
  );

  (await cookies()).set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
