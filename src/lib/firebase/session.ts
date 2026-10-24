/** Shared by proxy.ts and the admin SDK, so proxy doesn't pull firebase-admin in. */
export const SESSION_COOKIE = "session";

/** Firebase caps session cookies at 14 days. */
export const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
