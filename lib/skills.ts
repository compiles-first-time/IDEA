import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { ManifestError, parseAgentDefinition, type AgentDefinition } from "@/lib/manifest";
import { unknownTools } from "@/lib/tools";

/**
 * Skill discovery (S-14, FR-5.1).
 *
 * Reads `SKILL.md` files from a project's own checkout. Local-first resolved
 * the story's open question — there is no "will this file exist on Vercel?"
 * problem, because the project is on disk.
 *
 * Discovery is **scoped to the project directory** for the same reason tool
 * calls are (E-11.e): a skill list is a thing an agent acts on, so where it can
 * come from is a boundary.
 */

/** Directories searched, in order, relative to the project root. */
export const SKILL_ROOTS = ["agents", "skills", ".claude/skills"] as const;

/** Depth cap — Loom nests specialists 3 deep; beyond that is someone's mistake. */
export const MAX_DEPTH = 5;

export interface DiscoveredSkill {
  definition: AgentDefinition;
  /** Project-relative path, for display and for re-reading. */
  path: string;
  /** Tool names the skill declares that this build does not provide. */
  missingTools: string[];
}

export interface SkippedSkill {
  path: string;
  reason: string;
}

export interface DiscoveryResult {
  skills: DiscoveredSkill[];
  /** A malformed skill is reported, never fatal to the listing. */
  skipped: SkippedSkill[];
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== "");
}

async function findSkillFiles(root: string, dir: string, depth: number): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // a missing root is normal, not an error
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (!isInside(root, full)) continue; // symlink escape

    if (entry.isDirectory()) {
      found.push(...(await findSkillFiles(root, full, depth + 1)));
    } else if (/^SKILL\.md$/i.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Discover every skill in a project.
 *
 * A malformed `SKILL.md` becomes a `skipped` entry naming the file and the
 * problem — one bad skill must not hide the other nineteen.
 */
export async function discoverSkills(projectRoot: string): Promise<DiscoveryResult> {
  const root = resolve(projectRoot);
  const skills: DiscoveredSkill[] = [];
  const skipped: SkippedSkill[] = [];
  const seen = new Set<string>();

  for (const sub of SKILL_ROOTS) {
    for (const file of await findSkillFiles(root, join(root, sub), 0)) {
      const rel = relative(root, file).split(sep).join("/");
      if (seen.has(rel)) continue;
      seen.add(rel);

      try {
        const raw = await readFile(file, "utf8");
        const definition = parseAgentDefinition(raw, rel);
        skills.push({
          definition,
          path: rel,
          missingTools: unknownTools(definition.tools),
        });
      } catch (e) {
        skipped.push({
          path: rel,
          reason: e instanceof ManifestError ? e.message : (e as Error).message,
        });
      }
    }
  }

  // Deterministic ordering so the UI does not shuffle between requests.
  skills.sort((a, b) => a.definition.name.localeCompare(b.definition.name));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { skills, skipped };
}

export class SkillNotFoundError extends Error {}

/**
 * Resolve a skill by name.
 *
 * The name is matched against *discovered* skills rather than being turned into
 * a path — so a name like `../../etc/passwd` simply matches nothing, and there
 * is no traversal to defend against.
 */
export async function findSkill(projectRoot: string, name: string): Promise<DiscoveredSkill> {
  const { skills } = await discoverSkills(projectRoot);
  const match = skills.find((s) => s.definition.name === name);
  if (!match) {
    throw new SkillNotFoundError(
      `no skill named "${name}" in this project (found: ${skills.map((s) => s.definition.name).join(", ") || "none"})`,
    );
  }
  return match;
}
