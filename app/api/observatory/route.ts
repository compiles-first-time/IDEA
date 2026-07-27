import { z } from "zod";

import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { redactState, projectState, summarize } from "@/lib/observatory";
import { loadProjects } from "@/lib/project-store";
import { getProject, projectRoot } from "@/lib/projects";

export const runtime = "nodejs";

const Query = z.object({ project: z.string().min(1).optional() });

/**
 * GET /api/observatory[?project=] — the Observatory projection.
 *
 * With a project, the full state for it. Without, a roll-up across every
 * registered project — the view no per-project server could offer (FR-12.3).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return jsonError("invalid query", 400);

  try {
    const file = await loadProjects();
    const ideaRoot = process.cwd();

    if (parsed.data.project) {
      const project = getProject(file, parsed.data.project);
      if (!project) {
        return jsonError(`no project named "${parsed.data.project}"`, 404, "project_not_found");
      }
      const state = await projectState(projectRoot(ideaRoot, project), project.name);
      // Event logs capture tool args in cleartext by design (Rule 22); a secret
      // that reached the log must not reach a browser (E-12.c).
      return Response.json({ state: redactState(state) });
    }

    const states = await Promise.all(
      file.projects.map((p) => projectState(projectRoot(ideaRoot, p), p.name)),
    );
    return Response.json({ summary: summarize(states) });
  } catch (e) {
    return serverError(e);
  }
}
