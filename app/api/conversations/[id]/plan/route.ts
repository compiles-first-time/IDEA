import { z } from "zod";

import { auth } from "@/auth";
import { jsonError, unauthorized } from "@/lib/api";
import { storeError } from "@/app/api/conversations/route";
import { describeFidelity, planFit } from "@/lib/compact";
import { loadConversation } from "@/lib/conversation-store";
import { authedOctokit } from "@/lib/github";
import { githubStore } from "@/lib/github-store";
import { getModel, loadRegistry } from "@/lib/registry";

export const runtime = "nodejs";

const Query = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  project: z.string().min(1),
  branch: z.string().min(1).default("idea/conversations"),
  modelId: z.string().min(1),
});

/**
 * GET /api/conversations/[id]/plan — what resuming would cost in context.
 *
 * Answers *before* the user commits, and recalculates per target model, so a
 * switch that would compact heavily is visible in advance (FR-9.6).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return jsonError("owner, repo, project and modelId are required", 400);
  }

  const model = getModel(parsed.data.modelId, loadRegistry());
  if (!model) return jsonError(`model ${parsed.data.modelId} is unavailable`, 400);

  const octokit = await authedOctokit();
  if (!octokit) return unauthorized();

  try {
    const { turns } = await loadConversation(
      {
        store: githubStore({ octokit, owner: parsed.data.owner, repo: parsed.data.repo }),
        branch: parsed.data.branch,
        projectName: parsed.data.project,
      },
      id,
    );

    const plan = planFit(turns, { modelId: model.id, contextWindow: model.contextWindow });
    return Response.json({ plan, summary: describeFidelity(plan, model.label) });
  } catch (e) {
    return storeError(e);
  }
}
