
import { auth } from "@/auth";
import { hostedUnavailable, jsonError, serverError, unauthorized } from "@/lib/api";
import { isHosted } from "@/lib/hosted";
import { loadProjects } from "@/lib/project-store";
import { getProject } from "@/lib/projects";
import { provision, type StepOutcome } from "@/lib/provision";

export const runtime = "nodejs";
/**
 * Cloning and installing take minutes. 300 is the serverless ceiling (FR-15);
 * locally `next start` ignores this value entirely, and the route refuses in
 * hosted mode anyway, so the cap only exists to keep the deploy valid.
 */
export const maxDuration = 300;

/**
 * POST /api/projects/[name]/provision — clone, install, bootstrap, verify.
 *
 * There is no `start` step: a project is not a process. IDEA renders its
 * Observatory itself (10-observatory-merged).
 *
 * Streams per-step progress as newline-delimited JSON so the page can show
 * which step is running rather than an indeterminate spinner (FR-8.3).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();
  if (isHosted()) return hostedUnavailable("Provisioning a project");

  const { name } = await params;

  let project;
  try {
    project = getProject(await loadProjects(), name);
  } catch (e) {
    return serverError(e);
  }
  // An unknown project is a 404, never a clone attempt (NFR-4).
  if (!project) return jsonError(`no project named "${name}"`, 404, "project_not_found");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        const result = await provision({
          ideaRoot: process.cwd(),
          project,
          onStep: (step: StepOutcome) => send({ type: "step", step }),
        });
        send({ type: "done", result });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
