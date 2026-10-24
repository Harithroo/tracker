"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, adminAuth, getCurrentUser } from "@/lib/firebase/admin";
import { profiles } from "@/lib/mongo/client";

export type AuthFormState = { error?: string; message?: string } | undefined;

/**
 * Signing in and resetting a password happen in the browser (the Firebase SDK
 * is what mints an ID token), so only the session-bound operations are actions.
 */
export async function logout() {
  const user = await getCurrentUser();
  (await cookies()).delete(SESSION_COOKIE);
  // Invalidates any other session cookie minted for this account.
  if (user) await adminAuth().revokeRefreshTokens(user.id).catch(() => {});
  redirect("/login");
}

export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };

  try {
    await adminAuth().updateUser(user.id, { password });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't update password." };
  }

  return { message: "Password updated." };
}

export async function updateUsername(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const username = String(formData.get("username") ?? "").trim();
  if (!username) return { error: "Username can't be empty." };

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };

  await (await profiles()).updateOne({ _id: user.id }, { $set: { username } });

  revalidatePath("/you");
  return { message: "Username updated." };
}
