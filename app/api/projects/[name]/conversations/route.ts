import { z } from "zod";

import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { ConversationStoreError } from "@/lib/conversation-store";
import {
  ProjectConversationError,
  listForProject,
  startForProject,
} from "@/lib/project-conversations";

export const runtime = "nodejs";

const CreateBody = z.object({ title: z.string().min(1).max(400) });

/**
 * Conversations for one project (S-46).
 *
 * Project-scoped by construction: the name is in the path, so there is no way to
 * ask for "the conversations" without saying whose.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { name } = await params;
  try {
    return Response.json({ conversations: await listForProject(name) });
  } catch (e) {
    return failed(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { name } = await params;
  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  try {
    return Response.json({ conversation: await startForProject(name, body.title) });
  } catch (e) {
    return failed(e);
  }
}

function failed(e: unknown): Response {
  if (e instanceof ProjectConversationError) return jsonError(e.message, 404, "project_not_found");
  if (e instanceof ConversationStoreError) {
    return jsonError(e.message, e.code === "no_write_access" ? 403 : 409, e.code);
  }
  return serverError(e);
}
