import { NextResponse, type NextRequest } from "next/server";

/**
 * Route gating (S-03, C-3).
 *
 * ⚠️ In Next 16 the `middleware` file convention is **deprecated and renamed to
 * `proxy`** — a single exported `proxy` function, same matcher config. The
 * component map's C-3 row referred to `middleware.ts`, which never existed here.
 *
 * **This is defence in depth, not the gate.** Per §6 of the architecture spec,
 * every API route re-checks `auth()` itself and every protected page calls it
 * server-side. Proxy runs before rendering and may be deployed to a CDN, so it
 * deliberately does not import `auth.ts` or make the allowlist decision: it only
 * short-circuits obviously-unauthenticated page requests to save a render.
 *
 * The real fail-closed check (FR-1.3 — an empty `ALLOWED_LOGINS` admits nobody)
 * lives in `auth.ts` and runs on every request regardless of this file.
 */

/** Cookie names Auth.js v5 uses for the session, across http and https. */
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => request.cookies.has(name));
}

export function proxy(request: NextRequest) {
  // Presence of a cookie is not proof of a valid session — it is only a cheap
  // signal that a redirect is pointless. Validation stays server-side.
  if (hasSessionCookie(request)) return NextResponse.next();

  const url = new URL("/login", request.url);
  url.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Pages only. API routes are excluded on purpose: they must answer **401**,
   * not redirect to an HTML login page — a redirect would hand a JSON client a
   * confusing 200 full of markup.
   */
  matcher: ["/", "/chat/:path*", "/projects/:path*", "/observatory/:path*", "/settings/:path*"],
};
