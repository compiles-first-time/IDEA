import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ProjectStatus,
  hasDependencies,
  isProvisioned,
  parseProjects,
  type ProjectRecord,
  type ProjectsFile,
} from "@/lib/projects";
import { isDashboardUp } from "@/lib/provision";

/**
 * Reading and writing `config/projects.json`, plus live status.
 *
 * Lives in `lib/` rather than inside a route so the projects page can load its
 * data server-side — which removes a client effect that only existed to fetch
 * on mount, and with it the loading flash.
 */

export function registryPath(ideaRoot = process.cwd()): string {
  return join(ideaRoot, "config", "projects.json");
}

export async function loadProjects(ideaRoot = process.cwd()): Promise<ProjectsFile> {
  const path = registryPath(ideaRoot);
  if (!existsSync(path)) return { projects: [] };
  return parseProjects(JSON.parse(await readFile(path, "utf8")));
}

export async function saveProjects(file: ProjectsFile, ideaRoot = process.cwd()): Promise<void> {
  await mkdir(join(ideaRoot, "config"), { recursive: true });
  await writeFile(registryPath(ideaRoot), JSON.stringify(file, null, 2) + "\n", "utf8");
}

/**
 * Live state, derived from disk and a port probe.
 *
 * Never from a remembered pid: that would be wrong the moment IDEA restarts,
 * and a stale "running" badge is worse than no badge.
 */
export async function statusOf(
  project: ProjectRecord,
  ideaRoot = process.cwd(),
): Promise<ProjectStatus> {
  const base = { name: project.name, dashboardUrl: project.dashboardUrl, pid: null, error: null };

  if (!isProvisioned(ideaRoot, project)) {
    return ProjectStatus.parse({ ...base, state: "unprovisioned" });
  }
  if (await isDashboardUp(project)) {
    return ProjectStatus.parse({ ...base, state: "running" });
  }
  return ProjectStatus.parse({
    ...base,
    state: hasDependencies(ideaRoot, project) ? "ready" : "unprovisioned",
  });
}

export interface ProjectView {
  name: string;
  title: string;
  gitUrl: string;
  owner: string;
  repo: string;
  dashboardUrl: string;
  seededFrom: string | null;
  status: ProjectStatus;
}

/** Everything the projects page needs, in one call. */
export async function projectViews(ideaRoot = process.cwd()): Promise<ProjectView[]> {
  const file = await loadProjects(ideaRoot);
  const statuses = await Promise.all(file.projects.map((p) => statusOf(p, ideaRoot)));
  return file.projects.map((p, i) => ({
    name: p.name,
    title: p.title,
    gitUrl: p.gitUrl,
    owner: p.owner,
    repo: p.repo,
    dashboardUrl: p.dashboardUrl,
    seededFrom: p.seededFrom ?? null,
    status: statuses[i],
  }));
}
