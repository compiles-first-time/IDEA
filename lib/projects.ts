import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { z } from "zod";

/**
 * Project registry (S-18, FR-7.1, expanded by 07-amendments §3).
 *
 * A project is a **fresh clone of `loom-template` that became its own repo** —
 * holding that project's source, Loom state, and conversations. The registry
 * records where it lives and how to run it; the checkout itself is git-ignored
 * and never committed into IDEA (E-7.b).
 *
 * The validation here is security-relevant, not cosmetic: `root` feeds a
 * process spawn (S-29) and `dashboardUrl` feeds a link or a proxy, so a
 * registry that accepted `../../..` or `http://evil.com` would turn those
 * stories into vulnerabilities.
 */

/** Where project checkouts live, relative to the IDEA repo. Git-ignored. */
export const PROJECTS_DIR = "projects";

export const DEFAULT_CONVERSATION_BRANCH = "idea/conversations";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

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
    launch: z.string().min(1).default("node observatory/server.mjs"),
    dashboardUrl: z.url(),
    configPath: z.string().optional().default("observatory/config.yaml"),
    conversationBranch: z.string().min(1).default(DEFAULT_CONVERSATION_BRANCH),
    /** Provenance — which template this project was seeded from. */
    seededFrom: z.string().optional(),
    autostart: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    if (isAbsolute(p.root) || p.root.split(/[\\/]/).includes("..")) {
      ctx.addIssue({
        code: "custom",
        path: ["root"],
        message: "must be a relative path inside the repo, with no traversal",
      });
    }
    let url: URL;
    try {
      url = new URL(p.dashboardUrl);
    } catch {
      ctx.addIssue({ code: "custom", path: ["dashboardUrl"], message: "is not a URL" });
      return;
    }
    if (!LOCAL_HOSTS.has(url.hostname)) {
      ctx.addIssue({
        code: "custom",
        path: ["dashboardUrl"],
        message: "must be local (127.0.0.1 or localhost) — dashboards are not hosted remotely",
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

/** Absolute checkout path, validated to stay inside the workspace. */
export function projectRoot(ideaRoot: string, project: ProjectRecord): string {
  const abs = resolve(ideaRoot, project.root);
  const rel = relative(resolve(ideaRoot), abs);
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

export const ProjectState = z.enum(["unprovisioned", "provisioning", "ready", "running", "error"]);
export type ProjectState = z.infer<typeof ProjectState>;

export const ProjectStatus = z.object({
  name: z.string(),
  state: ProjectState,
  dashboardUrl: z.url(),
  pid: z.number().nullable(),
  /** Present when state is `error`. */
  error: z.string().nullable(),
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
  dashboardPort?: number;
}): ProjectRecord {
  return ProjectRecord.parse({
    name: input.name,
    title: input.title ?? input.name,
    gitUrl: `https://github.com/${input.owner}/${input.repo}.git`,
    owner: input.owner,
    repo: input.repo,
    root: `${PROJECTS_DIR}/${input.name}`,
    dashboardUrl: `http://127.0.0.1:${input.dashboardPort ?? 4040}`,
    ...(input.seededFrom ? { seededFrom: input.seededFrom } : {}),
  });
}
