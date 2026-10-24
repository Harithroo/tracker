import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/firebase/session";

const PUBLIC_PATHS = ["/login", "/signup", "/reset-password", "/api/auth"];

/**
 * Optimistic auth gate: it only checks that a session cookie exists, since
 * proxy runs on every request (prefetches included). The cookie's signature is
 * verified where the data is actually read — the (app) layout and every action.
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.search = "";
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
