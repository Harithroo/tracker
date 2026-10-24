import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/admin";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getCurrentUser()) redirect("/");

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
