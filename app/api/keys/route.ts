import { auth } from "@/auth";
import { jsonError, unauthorized } from "@/lib/api";
import { isHosted } from "@/lib/hosted";
import { KeyInput, keyStatuses, saveKey } from "@/lib/provider-keys";

export const runtime = "nodejs";

/**
 * GET /api/keys — which providers are configured, and the last four characters.
 *
 * Deliberately never returns a key (NFR-6). The UI needs to know *whether* a key
 * exists and *which* one it is, not what it is.
 */
export async function GET() {
  const session = await auth();
  if (!session) return unauthorized();
  return Response.json({ providers: await keyStatuses() });
}

/**
 * POST /api/keys — store a provider key in `.env.local`.
 *
 * Responds with the same status shape as GET: no echo, so a key cannot be read
 * back out of the API that accepted it.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  // In hosted mode a key never reaches the server to be stored (E-15.b): it
  // stays in the user's browser and rides chat requests as a header. Accepting
  // a key here would put one user's key in every user's process env.
  if (isHosted()) {
    return jsonError(
      "Hosted mode never stores keys server-side — your key stays in this browser.",
      403,
      "hosted_unavailable",
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("expected a JSON body", 400);
  }

  const parsed = KeyInput.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "invalid key", 400);
  }

  try {
    return Response.json({ providers: await saveKey(parsed.data) });
  } catch (e) {
    // Never include the key in an error path either.
    return jsonError(e instanceof Error ? e.message : "could not save the key", 500);
  }
}
