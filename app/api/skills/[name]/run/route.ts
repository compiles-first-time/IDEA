import { resolve } from "node:path";

import { z } from "zod";

import { auth } from "@/auth";
import { hostedUnavailable, jsonError, serverError, unauthorized } from "@/lib/api";
import { isHosted } from "@/lib/hosted";
import { runAgent, type ExecuteFn, type StepFn } from "@/lib/agent";
import { SkillNotFoundError, findSkill } from "@/lib/skills";
import { executeTool, pathsForCall, unknownTools } from "@/lib/tools";
import type { ScopeContext } from "@/lib/permissions";
import { anthropicStep } from "@/lib/agent-provider";
import { defaultModelId, getModel, loadRegistry } from "@/lib/registry";

export const runtime = "nodejs";
/**
 * Agent runs are long by nature. 300 is the serverless ceiling (FR-15);
 * locally `next start` ignores this value, and hosted mode refuses the route.
 */
export const maxDuration = 300;

const Body = z.object({
  projectRoot: z.string().min(1),
  input: z.string().min(1),
  /** False when nobody is watching — irreversible steps then pause (FR-11.5). */
  humanPresent: z.boolean().default(true),
  modelId: z.string().optional(),
});

/**
 * POST /api/skills/[name]/run — run a skill through the agent loop.
 *
 * Thin: authenticate → validate → resolve the skill → run → return the result
 * with its Rule 22 traces. All governance lives in `lib/permissions.ts`, all
 * looping in `lib/agent.ts`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();
  // An agent that runs commands needs the user's own machine — refusing here is
  // also what keeps a client-supplied projectRoot meaningless on a shared host.
  if (isHosted()) return hostedUnavailable("Running a skill");

  const { name } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  const projectRoot = resolve(body.projectRoot);

  try {
    const skill = await findSkill(projectRoot, name);

    // A skill declaring a tool this build lacks fails with "tool not allowed",
    // which is the truthful error — not a confusing parse or runtime failure.
    const missing = unknownTools(skill.definition.tools);
    if (missing.length > 0) {
      return jsonError(
        `skill "${name}" declares tools this build does not provide: ${missing.join(", ")}`,
        400,
        "tool_not_allowed",
      );
    }

    const registry = loadRegistry();
    const model = getModel(body.modelId ?? defaultModelId(registry), registry);
    if (!model) return jsonError(`model ${body.modelId} is unavailable`, 400);

    const scope: ScopeContext = {
      projectRoot,
      ideaRoot: process.cwd(),
      loomTemplateRoot: resolve(projectRoot, "..", "loom-template"),
    };

    const step: StepFn = anthropicStep(model);
    const execute: ExecuteFn = (call) => executeTool(call, { scope });

    const result = await runAgent({
      definition: skill.definition,
      input: body.input,
      step,
      execute,
      scope,
      humanPresent: body.humanPresent,
      pathsFor: pathsForCall,
      // The GitHub token must never reach a trace or a transcript (LR-03).
      extraSecrets: session.accessToken ? [session.accessToken] : [],
    });

    return Response.json({
      skill: { name: skill.definition.name, path: skill.path },
      modelId: model.id,
      stopReason: result.stopReason,
      note: result.note,
      output: result.output,
      /** Kernel Rule 22 records — one per tool call considered. */
      traces: result.traces,
      steps: result.steps,
      /** Set when an irreversible step is waiting on a human (Rule 20). */
      pending: result.pending,
    });
  } catch (e) {
    if (e instanceof SkillNotFoundError) return jsonError(e.message, 404, "skill_not_found");
    return serverError(e);
  }
}
