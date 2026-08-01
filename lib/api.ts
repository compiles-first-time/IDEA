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

/**
 * The refusal every local-only route returns in hosted mode (FR-15.3).
 *
 * 403, not 404: the route exists, the deployment cannot honour it. The message
 * says where the feature does work rather than just that it doesn't.
 */
export function hostedUnavailable(what: string): Response {
  return jsonError(
    `${what} needs a machine with your repos on it — it is not available on this hosted deployment. Run IDEA locally (npx @ideallab/idea) to use it.`,
    403,
    "hosted_unavailable",
  );
}
