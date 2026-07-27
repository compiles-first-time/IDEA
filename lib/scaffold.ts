import type { Octokit } from "@octokit/rest";

import { projectFor, type ProjectRecord } from "@/lib/projects";

/**
 * Project creation from the template (S-30, FR-8.2).
 *
 * A project is a **fresh repo seeded from `loom-template`** under the user's
 * account, which then becomes that project's own repo — its source, its Loom
 * state, and its conversations.
 *
 * `loom-template` itself is never written to (E-8.e): it is upstream, shared,
 * and owned separately. That is enforced here, not left to convention.
 */

export const TEMPLATE_OWNER = "compiles-first-time";
export const TEMPLATE_REPO = "loom-template";

export class ScaffoldError extends Error {
  constructor(
    message: string,
    readonly code:
      | "name_taken"
      | "template_unavailable"
      | "no_permission"
      | "forbidden_target"
      | "upstream",
  ) {
    super(message);
  }
}

export interface CreateProjectInput {
  octokit: Octokit;
  /** The signed-in user's GitHub login — repos are only ever made under it. */
  owner: string;
  name: string;
  title?: string;
  description?: string;
  /** Repos hold conversation transcripts, so private is the default (E-8.b). */
  isPrivate?: boolean;
}

/**
 * Create the project repo and return its registry record.
 *
 * Prefers GitHub's template-generate API, which produces a clean repo with no
 * shared history and no fork relationship. Falls back to a plain repo when the
 * upstream is not marked as a template, and says so — silently producing a
 * different thing than the user asked for would be worse than a clear message.
 */
export async function createProjectRepo(input: CreateProjectInput): Promise<{
  project: ProjectRecord;
  seededFromTemplate: boolean;
  htmlUrl: string;
}> {
  const { octokit, owner, name } = input;
  const isPrivate = input.isPrivate ?? true;

  if (owner === TEMPLATE_OWNER && name === TEMPLATE_REPO) {
    throw new ScaffoldError(
      `refusing to target ${TEMPLATE_OWNER}/${TEMPLATE_REPO} — the template is upstream and shared (E-8.e)`,
      "forbidden_target",
    );
  }

  // Fail before doing any work if the name is taken.
  if (await repoExists(octokit, owner, name)) {
    throw new ScaffoldError(`you already have a repository named "${name}"`, "name_taken");
  }

  const template = await templateInfo(octokit);
  let htmlUrl: string;
  let seededFromTemplate = false;

  if (template.isTemplate) {
    try {
      const { data } = await octokit.repos.createUsingTemplate({
        template_owner: TEMPLATE_OWNER,
        template_repo: TEMPLATE_REPO,
        owner,
        name,
        description: input.description,
        private: isPrivate,
        include_all_branches: false,
      });
      htmlUrl = data.html_url;
      seededFromTemplate = true;
    } catch (e) {
      throw toScaffoldError(e);
    }
  } else {
    // Not marked as a template upstream. Create an empty repo and tell the
    // caller — the project will need seeding another way.
    try {
      const { data } = await octokit.repos.createForAuthenticatedUser({
        name,
        description: input.description,
        private: isPrivate,
        auto_init: true,
      });
      htmlUrl = data.html_url;
    } catch (e) {
      throw toScaffoldError(e);
    }
  }

  const project = projectFor({
    name,
    title: input.title ?? name,
    owner,
    repo: name,
    seededFrom: seededFromTemplate ? `${TEMPLATE_OWNER}/${TEMPLATE_REPO}` : undefined,
  });

  return { project, seededFromTemplate, htmlUrl };
}

async function repoExists(octokit: Octokit, owner: string, repo: string): Promise<boolean> {
  try {
    await octokit.repos.get({ owner, repo });
    return true;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return false;
    throw toScaffoldError(e);
  }
}

/** Is the upstream actually marked as a GitHub template repo? */
export async function templateInfo(
  octokit: Octokit,
): Promise<{ isTemplate: boolean; reachable: boolean }> {
  try {
    const { data } = await octokit.repos.get({ owner: TEMPLATE_OWNER, repo: TEMPLATE_REPO });
    return { isTemplate: data.is_template === true, reachable: true };
  } catch {
    return { isTemplate: false, reachable: false };
  }
}

function toScaffoldError(e: unknown): ScaffoldError {
  const err = e as { status?: number; message?: string };
  if (err.status === 403 || err.status === 401) {
    return new ScaffoldError(
      "your GitHub token cannot create repositories — the `repo` scope is required",
      "no_permission",
    );
  }
  if (err.status === 422) {
    return new ScaffoldError(err.message ?? "GitHub rejected the repository name", "name_taken");
  }
  if (err.status === 404) {
    return new ScaffoldError(
      `${TEMPLATE_OWNER}/${TEMPLATE_REPO} is not reachable with your token`,
      "template_unavailable",
    );
  }
  return new ScaffoldError(err.message ?? "GitHub request failed", "upstream");
}
