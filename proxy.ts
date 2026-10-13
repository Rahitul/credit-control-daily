import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/session";
import { homeForRoles } from "@/lib/nav";

const PUBLIC_PATHS = ["/", "/terms", "/privacy", "/forgot-password"];
const ROLE_ROOTS = [
  "/admin",
  "/accounts",
  "/creditcontrol",
  "/sales",
  "/eid",
  "/eid_juniors",
  "/esbd",
  "/consumable",
  "/branches",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = verifyToken(request.cookies.get(SESSION_COOKIE)?.value);

  const isPublic = PUBLIC_PATHS.includes(pathname);
  const isRoleRoute =
    ROLE_ROOTS.some((r) => pathname === r || pathname.startsWith(`${r}/`)) ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/");

  if (!session && (isRoleRoute || !isPublic)) {
    const url = new URL("/", request.url);
    if (isRoleRoute) url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  if (session && pathname === "/") {
    return NextResponse.redirect(new URL(homeForRoles(session.roles), request.url));
  }

  if (session && (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))) {
    return NextResponse.redirect(new URL(homeForRoles(session.roles), request.url));
  }

  if (session && isRoleRoute) {
    const home = homeForRoles(session.roles);
    const allowed =
      pathname === home || pathname.startsWith(`${home}/`);
    if (!allowed) {
      return NextResponse.redirect(new URL(home, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
