import { resolve } from "node:path";

import { z } from "zod";

import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { discoverSkills } from "@/lib/skills";
import { TOOL_NAMES } from "@/lib/tools";

export const runtime = "nodejs";

const Query = z.object({ projectRoot: z.string().min(1) });

/**
 * GET /api/skills?projectRoot= — the skills discovered in a project.
 *
 * A malformed `SKILL.md` is reported as a skipped entry with its reason, never
 * a route-wide 500: one bad skill must not hide the rest.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return jsonError("projectRoot is required", 400);

  try {
    const { skills, skipped } = await discoverSkills(resolve(parsed.data.projectRoot));
    return Response.json({
      skills: skills.map((s) => ({
        name: s.definition.name,
        description: s.definition.description,
        path: s.path,
        tools: s.definition.tools,
        missingTools: s.missingTools,
        maxSteps: s.definition.maxSteps,
        tier: s.definition.tier,
        contextBudget: s.definition.contextBudget,
        credentialScope: s.definition.credentialScope,
        /** True when the file had no frontmatter and fields were inferred. */
        inferred: s.definition.inferred,
      })),
      skipped,
      availableTools: TOOL_NAMES,
    });
  } catch (e) {
    return serverError(e);
  }
}
