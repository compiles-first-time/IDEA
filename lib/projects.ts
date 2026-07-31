import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { z } from "zod";

/**
 * Project registry (S-18, FR-7.1, expanded by 07-amendments §3).
 *
 * A project is a **fresh clone of `loom-template` that became its own repo** —
 * holding that project's source, Loom state, and conversations. The registry
 * records where it lives; the checkout itself is git-ignored and never
 * committed into IDEA (E-7.b).
 *
 * ⚠️ There is no `launch` command and no `dashboardUrl`. A project is not a
 * process: **IDEA's dashboard is the Observatory**
 * ([10-observatory-merged.md](../docs/architecture/10-observatory-merged.md)),
 * rendering each project's event log at an in-app route.
 *
 * `root` validation is still security-relevant — it feeds a clone target and a
 * command's `cwd`, so a registry accepting `../../..` would be a vulnerability.
 */

/** Where project checkouts live, relative to the IDEA repo. Git-ignored. */
export const PROJECTS_DIR = "projects";

export const DEFAULT_CONVERSATION_BRANCH = "idea/conversations";

export const ProjectRecord = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i, "must be a safe directory name"),
    title: z.string().min(1),
    /** The project's own GitHub repo. */
    gitUrl: z.url(),
    owner: z.string().min(1),
    repo: z.string().min(1),
    /** Checkout location, relative to the IDEA repo (e.g. `projects/my-app`). */
    root: z.string().min(1),
    configPath: z.string().optional().default("observatory/config.yaml"),
    conversationBranch: z.string().min(1).default(DEFAULT_CONVERSATION_BRANCH),
    /** Provenance — which template this project was seeded from. */
    seededFrom: z.string().optional(),
    autostart: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    // Absolute roots are allowed — an existing checkout should not have to be
    // cloned a second time (see `projectRoot`). Traversal is not: `..` in a
    // relative root is an attempt to leave the workspace by spelling, and an
    // absolute path already says plainly where it points.
    if (p.root.split(/[\\/]/).includes("..")) {
      ctx.addIssue({
        code: "custom",
        path: ["root"],
        message: "must not contain '..' — give a relative path inside the repo, or an absolute one",
      });
    }
    if (!p.gitUrl.includes(`${p.owner}/${p.repo}`)) {
      ctx.addIssue({
        code: "custom",
        path: ["gitUrl"],
        message: `must match owner/repo (${p.owner}/${p.repo}) — a mismatch writes conversations to the wrong repository`,
      });
    }
    if (p.conversationBranch === "main" || p.conversationBranch === "master") {
      ctx.addIssue({
        code: "custom",
        path: ["conversationBranch"],
        message: "must not be the default branch (E-9.a)",
      });
    }
  });

export const ProjectsFile = z.object({ projects: z.array(ProjectRecord).default([]) });

export type ProjectRecord = z.infer<typeof ProjectRecord>;
export type ProjectsFile = z.infer<typeof ProjectsFile>;

export class ProjectRegistryError extends Error {}

export function parseProjects(raw: unknown): ProjectsFile {
  const result = ProjectsFile.safeParse(raw);
  if (!result.success) {
    throw new ProjectRegistryError(
      `invalid project registry: ${result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  }
  const seen = new Set<string>();
  for (const p of result.data.projects) {
    if (seen.has(p.name)) throw new ProjectRegistryError(`duplicate project name "${p.name}"`);
    seen.add(p.name);
  }
  return result.data;
}

export function getProject(file: ProjectsFile, name: string): ProjectRecord | undefined {
  return file.projects.find((p) => p.name === name);
}

/**
 * Absolute checkout path for a project.
 *
 * Two shapes are allowed, and the difference matters:
 *
 * - **Relative** (`projects/my-app`) — a project IDEA provisioned into its own
 *   workspace. Resolved against `ideaRoot` and required to stay inside it, so a
 *   traversal in the registry cannot reach the rest of the disk.
 * - **Absolute** (`C:/Users/me/dev/my-app`) — a checkout that already existed.
 *   Deliberately permitted: requiring a second clone of a repo the user is
 *   already working in is not a security property, it is an inconvenience that
 *   produces two diverging copies.
 *
 * The isolation guarantee is unchanged either way. E-11.e says an agent working
 * on project A cannot reach project B — that is about *scope*, enforced by
 * pinning every tool to this one root, not about where the root sits. If
 * anything an external root is safer: E-11.b (IDEA's own source is never
 * agent-writable) is only hard to hold when projects are nested inside IDEA.
 *
 * What is still refused: a root that is IDEA's own tree, or that contains it.
 * Either would put IDEA's source inside an agent's scope.
 */
export function projectRoot(ideaRoot: string, project: ProjectRecord): string {
  const base = resolve(ideaRoot);

  if (isAbsolute(project.root)) {
    const abs = resolve(project.root);
    if (abs === base || relative(abs, base) === "" || !relative(abs, base).startsWith("..")) {
      // `relative(abs, base)` not starting with ".." means base is inside abs.
      throw new ProjectRegistryError(
        `project "${project.name}" would place IDEA's own source inside the agent's scope: ${abs} (E-11.b)`,
      );
    }
    return abs;
  }

  const abs = resolve(base, project.root);
  const rel = relative(base, abs);
  if (rel.startsWith("..") || rel.startsWith(sep) || isAbsolute(rel)) {
    throw new ProjectRegistryError(
      `project "${project.name}" resolves outside the workspace: ${abs}`,
    );
  }
  return abs;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

export const ProjectState = z.enum(["unprovisioned", "provisioning", "ready", "error"]);
export type ProjectState = z.infer<typeof ProjectState>;

export const ProjectStatus = z.object({
  name: z.string(),
  state: ProjectState,
  /** Present when state is `error`. */
  error: z.string().nullable(),
  /** Where IDEA renders this project's Observatory — an in-app route (FR-12.1). */
  observatoryPath: z.string(),
});
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * Is this project cloned and installed?
 *
 * Derived from disk rather than remembered, so the answer survives an IDEA
 * restart — a pid held in memory does not.
 */
export function isProvisioned(ideaRoot: string, project: ProjectRecord): boolean {
  const root = projectRoot(ideaRoot, project);
  return existsSync(join(root, ".git"));
}

export function hasDependencies(ideaRoot: string, project: ProjectRecord): boolean {
  const root = projectRoot(ideaRoot, project);
  // No package.json means nothing to install — vacuously satisfied.
  if (!existsSync(join(root, "package.json"))) return true;
  return existsSync(join(root, "node_modules"));
}

/** Build a record for a newly created project, with sane defaults. */
export function projectFor(input: {
  name: string;
  title?: string;
  owner: string;
  repo: string;
  seededFrom?: string;
}): ProjectRecord {
  return ProjectRecord.parse({
    name: input.name,
    title: input.title ?? input.name,
    gitUrl: `https://github.com/${input.owner}/${input.repo}.git`,
    owner: input.owner,
    repo: input.repo,
    root: `${PROJECTS_DIR}/${input.name}`,
    ...(input.seededFrom ? { seededFrom: input.seededFrom } : {}),
  });
}

/** Where IDEA renders this project's Observatory (FR-12.1). */
export function observatoryPathFor(name: string): string {
  return `/observatory?project=${encodeURIComponent(name)}`;
}
