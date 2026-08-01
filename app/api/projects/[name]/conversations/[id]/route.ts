import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { ConversationStoreError } from "@/lib/conversation-store";
import { ProjectConversationError, loadForProject } from "@/lib/project-conversations";

export const runtime = "nodejs";

/** One conversation, with its turns, so a reload can resume where it left off. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string; id: string }> },
) {
  const session = await auth();
  if (!session) return unauthorized();

  const { name, id } = await params;
  try {
    const stored = await loadForProject(name, id);
    return Response.json({ meta: stored.meta, turns: stored.turns });
  } catch (e) {
    if (e instanceof ProjectConversationError) {
      return jsonError(e.message, 404, "project_not_found");
    }
    if (e instanceof ConversationStoreError) {
      return jsonError(e.message, e.code === "not_found" ? 404 : 409, e.code);
    }
    return serverError(e);
  }
}
