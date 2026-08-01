import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { ConversationStoreError } from "@/lib/conversation-store";
import { hostedPersistenceAvailable, loadForLogin } from "@/lib/hosted-conversations";

export const runtime = "nodejs";

/** GET /api/hosted/conversations/[id] — one saved chat, turns and all (S-51). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.login) return unauthorized();
  if (!hostedPersistenceAvailable()) {
    return jsonError("Saved conversations are not set up on this deployment.", 404, "not_available");
  }

  const { id } = await params;
  try {
    const { meta, turns } = await loadForLogin(session.login, id);
    return Response.json({ meta, turns });
  } catch (e) {
    if (e instanceof ConversationStoreError && e.code === "not_found") {
      return jsonError(`no conversation "${id}"`, 404, "not_found");
    }
    return serverError(e);
  }
}
