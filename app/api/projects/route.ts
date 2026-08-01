import { z } from "zod";

import { auth } from "@/auth";
import { hostedUnavailable, jsonError, serverError, unauthorized } from "@/lib/api";
import { isHosted } from "@/lib/hosted";
import { authedOctokit } from "@/lib/github";
import { loadProjects, projectViews, saveProjects } from "@/lib/project-store";
import { ScaffoldError, createProjectRepo } from "@/lib/scaffold";

export const runtime = "nodejs";

/** GET /api/projects — every registered project with its live state. */
export async function GET() {
  const session = await auth();
  if (!session) return unauthorized();

  try {
    return Response.json({ projects: await projectViews() });
  } catch (e) {
    return serverError(e);
  }
}

const CreateBody = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, "must be a safe repository name"),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(300).optional(),
  /** Repos hold conversations; opting out of private is deliberate (E-8.b). */
  isPrivate: z.boolean().default(true),
});

/**
 * POST /api/projects — create a project repo seeded from `loom-template`.
 *
 * The registry entry is written only after the repo exists, so a failure part
 * way leaves no orphan.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.login) return unauthorized();
  if (isHosted()) return hostedUnavailable("Creating a project");

  const octokit = await authedOctokit();
  if (!octokit) return unauthorized();

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  try {
    const file = await loadProjects();
    if (file.projects.some((p) => p.name === body.name)) {
      return jsonError(`a project named "${body.name}" is already registered`, 409);
    }

    // Repos are only ever created under the signed-in user's account.
    const created = await createProjectRepo({
      octokit,
      owner: session.login,
      name: body.name,
      title: body.title,
      description: body.description,
      isPrivate: body.isPrivate,
    });

    file.projects.push(created.project);
    await saveProjects(file);

    return Response.json(
      {
        project: created.project,
        htmlUrl: created.htmlUrl,
        seededFromTemplate: created.seededFromTemplate,
        // Say plainly when the repo is empty rather than Loom-seeded.
        notice: created.seededFromTemplate
          ? null
          : "loom-template is not marked as a GitHub template repository, so an empty repo was created instead. Mark it as a template to seed future projects automatically.",
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ScaffoldError) {
      const status =
        e.code === "name_taken" ? 409
        : e.code === "no_permission" ? 403
        : e.code === "forbidden_target" ? 400
        : e.code === "template_unavailable" ? 404
        : 502;
      return jsonError(e.message, status, e.code);
    }
    return serverError(e);
  }
}

