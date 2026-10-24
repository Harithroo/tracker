import "server-only";
import { cookies } from "next/headers";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { SESSION_COOKIE } from "./session";

export { SESSION_COOKIE, SESSION_MAX_AGE_MS } from "./session";

function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Service-account keys carry literal newlines, which .env files can't hold.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin is not configured. Copy .env.example to .env.local and fill in FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (see README)."
    );
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export interface SessionUser {
  /** Firebase uid — the `user_id` on every document. */
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

/**
 * The signed-in user, or null. Verifies the session cookie's signature and
 * expiry on every call; revocation isn't checked, which would cost a round
 * trip to Firebase per request (sign-out clears the cookie instead).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  // Outside the try: a missing service account is a misconfiguration to
  // surface, not a signed-out visitor.
  const auth = adminAuth();
  try {
    const claims = await auth.verifySessionCookie(cookie);
    return {
      id: claims.uid,
      email: claims.email ?? null,
      name: (claims.name as string | undefined) ?? null,
      picture: (claims.picture as string | undefined) ?? null,
    };
  } catch {
    // Expired or tampered-with cookie — treated as signed out. proxy.ts can't
    // clear it (it only sees that one exists), so the next sign-in overwrites.
    return null;
  }
}

/** For writes, where there is no signed-out rendering path to fall back to. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}
