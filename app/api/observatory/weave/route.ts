import { auth } from "@/auth";
import { serverError, unauthorized } from "@/lib/api";
import { readRawEvents } from "@/lib/observatory";
import type { LoomEvent } from "@/lib/observatory";
import { loadProjects } from "@/lib/project-store";
import { projectRoot } from "@/lib/projects";
import { redactUnknown } from "@/lib/redact";
import { glossaryFor, mapProject } from "@/lib/weave";

export const runtime = "nodejs";

/**
 * GET /api/observatory/weave — the registry handshake (spec §16, BR_05).
 *
 * Returns every registered project mapped into the weave's own schema, plus
 * glossary entries for the rules actually seen in the logs. The integration
 * script appends these to the dashboard's PROJECTS beside its scripted demo.
 *
 * Redacted before leaving the server (E-12.c): event logs capture command lines
 * in cleartext by design, and this payload quotes them.
 */
export async function GET() {
  const session = await auth();
  if (!session) return unauthorized();

  try {
    const file = await loadProjects();
    const ideaRoot = process.cwd();
    const now = new Date();

    const projects = [];
    const allEvents: LoomEvent[] = [];

    for (const p of file.projects) {
      let events: LoomEvent[] = [];
      try {
        events = await readRawEvents(projectRoot(ideaRoot, p));
      } catch {
        // A broken root still yields a card with a queued placeholder run
        // (BR_05_SE-01) rather than sinking the whole handshake.
      }
      allEvents.push(...events);
      projects.push(
        mapProject({ name: p.name, title: p.title || p.name, operator: p.owner, events }, now),
      );
    }

    const glossary = glossaryFor(allEvents);
    return Response.json(redactUnknown({ projects, glossary }).value);
  } catch (e) {
    return serverError(e);
  }
}
