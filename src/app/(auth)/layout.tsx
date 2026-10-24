import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/admin";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let signedIn = false;
  try {
    signedIn = (await getCurrentUser()) !== null;
  } catch (err) {
    // Redirecting a signed-in visitor away is a convenience, not a gate, so a
    // broken service account must not take the login page down with it —
    // anyone holding a stale cookie would have no way back in.
    console.error("Could not verify the session cookie on an auth page:", err);
  }
  if (signedIn) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-2xl font-bold tracking-tight">
          <span className="text-accent">▸</span> Tracker
        </p>
        {children}
      </div>
    </div>
  );
}
