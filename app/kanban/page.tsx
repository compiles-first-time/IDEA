import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { KanbanBoard } from "@/components/kanban-board";
import { loadProjects } from "@/lib/project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The requirements board, per project.
 *
 * `?project=` picks one; without it, the project list. Same shape as the
 * Observatory so the two read as one product rather than two tools.
 */
export default async function KanbanPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { project } = await searchParams;
  const file = await loadProjects();

  if (!project) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6 text-neutral-100">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Board</h1>
          <p className="text-sm text-neutral-400">
            Requirements as tickets, with their solutions and exceptions as subtasks. Pick a
            project.
          </p>
        </header>
        <ul className="space-y-2">
          {file.projects.map((p) => (
            <li key={p.name}>
              <a
                href={`/kanban?project=${encodeURIComponent(p.name)}`}
                className="block rounded border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-700"
              >
                {p.title || p.name}
              </a>
            </li>
          ))}
          {file.projects.length === 0 && (
            <li className="text-sm text-neutral-500">No projects registered yet.</li>
          )}
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6 text-neutral-100">
      <header className="flex items-baseline justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{project}</h1>
          <p className="text-sm text-neutral-400">
            Each card is a requirement. Its solution steps, technical needs, and exceptions are
            subtasks — read from the project&rsquo;s own register.
          </p>
        </div>
        <a
          href="/kanban"
          className="shrink-0 rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
        >
          All projects
        </a>
      </header>

      <KanbanBoard project={project} />
    </div>
  );
}
