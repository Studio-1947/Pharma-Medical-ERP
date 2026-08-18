import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/p"];

// Reachable in every auth state. The service worker precaches /offline, so it
// must return the page itself rather than a redirect -- a redirected response
// is not cacheable, and a cached /login under this URL would be worse still.
const UNGUARDED_PATHS = ["/offline"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (UNGUARDED_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const hasSession = request.cookies.has("pharmerp_session");

  if (!isPublic && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isPublic && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|.*\\.svg$|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.webp$|.*\\.ico$|.*\\.css$|.*\\.js$).*)",
  ],
};
