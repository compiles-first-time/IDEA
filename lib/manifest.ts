import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { Tier } from "@/lib/contracts/routing";

/**
 * Skill manifest parser (S-11, FR-5.1/5.2).
 *
 * Turns a Loom-style `SKILL.md` into a validated, portable manifest — the thing
 * that makes a skill runnable on any provider.
 *
 * **Loom's own skills come in two shapes**, and both must parse:
 *   1. Specialists (under `agents/specialists/_registry/`) — YAML frontmatter
 *      with `name`, `summary`, `tools`, `context_budget`, `credential_scope`, …
 *   2. Base agents (`agents/critic/SKILL.md`, …) — **no frontmatter at all**,
 *      just markdown opening with an `# H1` and a `> **Role:**` blockquote.
 *
 * 14 of Loom's 20 skills have frontmatter; 6 do not. A parser that required it
 * would silently drop every base agent — the Critic, Constitution Service,
 * Memory-Keeper — which are the ones that matter most.
 *
 * Pure: callers pass the raw string. No filesystem access here.
 */

export const ModelPolicy = z.object({
  mode: z.enum(["manual", "auto"]).default("auto"),
  preferredTier: Tier.optional(),
  pinnedModelId: z.string().optional(),
});

export const SkillManifest = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** The markdown body — becomes the skill's system prompt. */
  system: z.string(),
  /** Tool names. Validated against the real allowlist at run time, not here. */
  tools: z.array(z.string()).default([]),
  modelPolicy: ModelPolicy.default({ mode: "auto" }),
  /** Path or URL the skill was read from. */
  source: z.string(),
  /* Loom-specific fields, preserved so the Critic can audit them. */
  tier: z.string().optional(),
  contextBudget: z.number().int().positive().optional(),
  /** LR-07 — keyring service name + scope, for scope-at-each-hop auditing. */
  credentialScope: z.string().optional(),
  verifierType: z.string().optional(),
  /** True when the file had no frontmatter and fields were inferred. */
  inferred: z.boolean().default(false),
});

export const AgentDefinition = SkillManifest.extend({
  maxSteps: z.number().int().positive().default(12),
});

export type ModelPolicy = z.infer<typeof ModelPolicy>;
export type SkillManifest = z.infer<typeof SkillManifest>;
export type AgentDefinition = z.infer<typeof AgentDefinition>;

export class ManifestError extends Error {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(`${source}: ${message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Frontmatter                                                                 */
/* -------------------------------------------------------------------------- */

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

interface Split {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

function splitFrontmatter(raw: string, source: string): Split {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { frontmatter: null, body: raw };

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch (e) {
    throw new ManifestError(
      `frontmatter is not valid YAML — ${(e as Error).message}`,
      source,
    );
  }
  if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new ManifestError("frontmatter must be a mapping of keys to values", source);
  }
  return {
    frontmatter: (parsed as Record<string, unknown>) ?? {},
    body: raw.slice(match[0].length),
  };
}

/* -------------------------------------------------------------------------- */
/* Inference for frontmatter-less skills                                       */
/* -------------------------------------------------------------------------- */

/** `agents/critic/SKILL.md` → `critic`. Falls back to the filename. */
export function nameFromSource(source: string): string {
  const parts = source.replace(/\\/g, "/").split("/").filter(Boolean);
  const file = parts[parts.length - 1] ?? "";
  if (/^skill\.md$/i.test(file) && parts.length >= 2) return parts[parts.length - 2];
  return file.replace(/\.md$/i, "") || "unnamed";
}

/**
 * Best-effort description when there is no `summary:`.
 *
 * Loom's base agents open with `> **Role:** …`, so that is tried first; then
 * the first ordinary paragraph.
 */
function inferDescription(body: string): string {
  const role = /^>\s*\*\*Role:\*\*\s*(.+)$/m.exec(body);
  if (role) return role[1].trim();

  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith(">") || t.startsWith("---")) continue;
    return t;
  }
  return "";
}

/* -------------------------------------------------------------------------- */
/* Coercion helpers                                                            */
/* -------------------------------------------------------------------------- */

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function asStringArray(v: unknown, source: string, key: string): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.map((x) => asString(x)).filter((x): x is string => !!x);
  }
  // `tools: Read, Glob, Grep` — tolerated because humans write it.
  if (typeof v === "string") {
    return v
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  throw new ManifestError(`\`${key}\` must be a list of names, got ${typeof v}`, source);
}

function asPositiveInt(v: unknown, source: string, key: string): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[_,]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new ManifestError(`\`${key}\` must be a positive integer, got ${String(v)}`, source);
  }
  return n;
}

/* -------------------------------------------------------------------------- */
/* Parse                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Parse a `SKILL.md` into a manifest.
 *
 * Tool *names* are carried through as written; whether a name is permitted is
 * decided at execution time by `lib/permissions.ts`. A manifest naming a
 * forbidden tool must parse cleanly and then be refused when it runs, so the
 * error says "tool not allowed" rather than "parse failed".
 */
export function parseSkillMd(raw: string, source: string): SkillManifest {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ManifestError("file is empty", source);
  }

  const { frontmatter, body } = splitFrontmatter(raw, source);
  const fm = frontmatter ?? {};
  const inferred = frontmatter === null;

  const name = asString(fm.name) ?? nameFromSource(source);
  const description = asString(fm.summary) ?? asString(fm.description) ?? inferDescription(body);

  const policy: ModelPolicy = {
    mode: (asString(fm.model_mode) as ModelPolicy["mode"]) ?? "auto",
    ...(asString(fm.preferred_tier)
      ? { preferredTier: asString(fm.preferred_tier) as ModelPolicy["preferredTier"] }
      : {}),
    ...(asString(fm.model) ? { pinnedModelId: asString(fm.model) } : {}),
  };

  const candidate = {
    name,
    description,
    system: body.trim(),
    tools: asStringArray(fm.tools, source, "tools"),
    modelPolicy: policy,
    source,
    tier: asString(fm.tier),
    contextBudget: asPositiveInt(fm.context_budget, source, "context_budget"),
    credentialScope: asString(fm.credential_scope),
    verifierType: asString(fm.verifier_type),
    inferred,
  };

  const result = SkillManifest.safeParse(candidate);
  if (!result.success) {
    throw new ManifestError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; "),
      source,
    );
  }
  return result.data;
}

export function parseAgentDefinition(raw: string, source: string): AgentDefinition {
  const manifest = parseSkillMd(raw, source);
  const { frontmatter } = splitFrontmatter(raw, source);
  const maxSteps = asPositiveInt(frontmatter?.max_steps, source, "max_steps");
  return AgentDefinition.parse({ ...manifest, ...(maxSteps ? { maxSteps } : {}) });
}

/** Round-trip: manifest → frontmatter + body, for writing a skill back out. */
export function serializeSkillMd(manifest: SkillManifest): string {
  const lines = ["---", `name: ${manifest.name}`];
  if (manifest.description) lines.push(`summary: ${JSON.stringify(manifest.description)}`);
  if (manifest.tier) lines.push(`tier: ${manifest.tier}`);
  if (manifest.contextBudget) lines.push(`context_budget: ${manifest.contextBudget}`);
  if (manifest.tools.length) lines.push(`tools: [${manifest.tools.join(", ")}]`);
  if (manifest.credentialScope) lines.push(`credential_scope: ${manifest.credentialScope}`);
  if (manifest.verifierType) lines.push(`verifier_type: ${manifest.verifierType}`);
  lines.push("---", "", manifest.system, "");
  return lines.join("\n");
}
