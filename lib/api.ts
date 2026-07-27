/**
 * Thin helpers shared by API routes.
 *
 * Routes stay thin by contract (§3 of the architecture spec): authenticate,
 * validate with Zod, call lib/, return. Anything longer belongs in lib/.
 */

export function jsonError(message: string, status: number, code?: string): Response {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export function unauthorized(): Response {
  return jsonError("unauthorized", 401);
}

/** Render an unexpected failure without leaking internals to the client. */
export function serverError(e: unknown): Response {
  const message = e instanceof Error ? e.message : "unexpected error";
  return jsonError(message, 500);
}
