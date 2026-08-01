import { z } from "zod";

import { auth } from "@/auth";
import { hostedUnavailable, jsonError, unauthorized } from "@/lib/api";
import { isHosted } from "@/lib/hosted";
import { sseFrame, streamProjectState } from "@/lib/observatory-stream";
import { loadProjects } from "@/lib/project-store";
import { getProject, projectRoot } from "@/lib/projects";

export const runtime = "nodejs";
/**
 * A dashboard connection is meant to stay open. 300 is the serverless ceiling
 * (FR-15); locally `next start` ignores this, and hosted mode refuses anyway —
 * the client reconnects when a proxy closes a long stream either way.
 */
export const maxDuration = 300;

const Query = z.object({ project: z.string().min(1) });

/** Keeps proxies and idle-connection timeouts from closing a quiet stream. */
const HEARTBEAT_MS = 25_000;

/**
 * GET /api/observatory/stream?project= — live projection over SSE (FR-12.4).
 *
 * Agents write to the event log while the user watches, so the dashboard is
 * pushed rather than polled. Same shape as Loom's own Observatory; the
 * projection just runs in IDEA instead of a per-project server.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();
  // `fs.watch` over event logs needs the logs to exist on this machine.
  if (isHosted()) return hostedUnavailable("The live observatory stream");

  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return jsonError("project is required", 400);

  const project = getProject(await loadProjects(), parsed.data.project);
  if (!project) {
    return jsonError(`no project named "${parsed.data.project}"`, 404, "project_not_found");
  }

  const root = projectRoot(process.cwd(), project);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch {
          // The client went away between the check and the write.
          open = false;
        }
      };

      const handle = streamProjectState({
        projectRoot: root,
        projectName: project.name,
        onState: (state) => send("state", state),
        onError: (error) => send("error", { message: error.message }),
      });

      const heartbeat = setInterval(() => send("ping", { at: Date.now() }), HEARTBEAT_MS);

      // Every path out of here must release the watcher, or a closed tab keeps
      // a file handle and a timer alive for the life of the process.
      const cleanup = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        handle.close();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tells any intermediary not to buffer the stream into uselessness.
      "x-accel-buffering": "no",
    },
  });
}
