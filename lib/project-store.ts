import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ProjectStatus,
  hasDependencies,
  isProvisioned,
  observatoryPathFor,
  parseProjects,
  type ProjectRecord,
  type ProjectsFile,
} from "@/lib/projects";

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
 * Live state, derived from disk.
 *
 * There is no `running` state and no port probe: a project is not a process.
 * IDEA renders its Observatory itself (10-observatory-merged), so a project is
 * either set up or it isn't.
 */
export function statusOf(project: ProjectRecord, ideaRoot = process.cwd()): ProjectStatus {
  const base = {
    name: project.name,
    error: null,
    observatoryPath: observatoryPathFor(project.name),
  };

  if (!isProvisioned(ideaRoot, project)) {
    return ProjectStatus.parse({ ...base, state: "unprovisioned" });
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
  seededFrom: string | null;
  status: ProjectStatus;
}

/** Everything the projects page needs, in one call. */
export async function projectViews(ideaRoot = process.cwd()): Promise<ProjectView[]> {
  const file = await loadProjects(ideaRoot);
  return file.projects.map((p) => ({
    name: p.name,
    title: p.title,
    gitUrl: p.gitUrl,
    owner: p.owner,
    repo: p.repo,
    seededFrom: p.seededFrom ?? null,
    status: statusOf(p, ideaRoot),
  }));
}
