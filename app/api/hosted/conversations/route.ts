import { z } from "zod";

import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { ConversationStoreError } from "@/lib/conversation-store";
import {
  hostedPersistenceAvailable,
  listForLogin,
  startForLogin,
} from "@/lib/hosted-conversations";

export const runtime = "nodejs";

/**
 * /api/hosted/conversations — the signed-in user's saved chats (S-51).
 *
 * The hosted counterpart of /api/projects/[name]/conversations, same response
 * shapes so the chat client treats both stores identically. Scope is the
 * session's GitHub login — there is no way to name another user.
 */

function unavailable(): Response {
  return jsonError(
    "Saved conversations are not set up on this deployment.",
    404,
    "not_available",
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.login) return unauthorized();
  if (!hostedPersistenceAvailable()) return unavailable();

  try {
    return Response.json({ conversations: await listForLogin(session.login) });
  } catch (e) {
    return serverError(e);
  }
}

const CreateBody = z.object({ title: z.string().min(1).max(500) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.login) return unauthorized();
  if (!hostedPersistenceAvailable()) return unavailable();

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  try {
    return Response.json({ conversation: await startForLogin(session.login, body.title) });
  } catch (e) {
    if (e instanceof ConversationStoreError) return jsonError(e.message, 502, e.code);
    return serverError(e);
  }
}
