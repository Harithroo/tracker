import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/admin";
import { Navbar } from "@/components/layout/Navbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getCurrentUser())) redirect("/login");

  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 md:pb-10">
        {children}
      </main>
    </>
  );
}
