import { redirect } from "next/navigation";

import { auth } from "@/auth";
import {
  CrossProjectView,
  ObservatoryView,
  type CrossProjectSummary,
  type ObservatoryState,
} from "@/components/observatory-view";
import { redactState, projectState, summarize } from "@/lib/observatory";
import { loadProjects } from "@/lib/project-store";
import { getProject, projectRoot } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IDEA's dashboard — which **is** the Loom Observatory (FR-12.1).
 *
 * `?project=` renders one project; without it, a roll-up across all of them.
 */
export default async function ObservatoryPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { project: name } = await searchParams;
  const file = await loadProjects();
  const ideaRoot = process.cwd();

  if (!name) {
    const states = await Promise.all(
      file.projects.map((p) => projectState(projectRoot(ideaRoot, p), p.name)),
    );
    const summary = summarize(states) as CrossProjectSummary;
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6 text-neutral-100">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Observatory</h1>
          <p className="text-sm text-neutral-400">
            Across every project. Pick one for detail.
          </p>
        </header>
        <CrossProjectView summary={summary} />
      </div>
    );
  }

  const project = getProject(file, name);
  if (!project) redirect("/observatory");

  // Redacted before it reaches the browser: event logs capture tool arguments
  // in cleartext by design (E-12.c).
  const state = redactState(
    await projectState(projectRoot(ideaRoot, project), project.name),
  ) as ObservatoryState;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 text-neutral-100">
      <ObservatoryView initial={state} />
    </div>
  );
}
