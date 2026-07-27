import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

/**
 * Agent authority: LR-04 classification + scope enforcement (S-12 rewritten,
 * FR-11, see docs/architecture/09-agent-authority.md).
 *
 * IDEA does not invent a permission scheme — it adopts Loom's. The axis is
 * **Kernel Rule 20**: reversible narrowings may be auto-approved, irreversible
 * ones require confirmation. Capability is not the question; recoverability is.
 *
 * Pure and total. Execution belongs to the agent loop (S-13); this module only
 * decides and explains.
 */

/* -------------------------------------------------------------------------- */
/* Categories (LR-04)                                                          */
/* -------------------------------------------------------------------------- */

export const PermissionCategory = z.enum([
  "auto",
  "external_service_setup",
  "destructive_actions",
  "credentials",
]);
export type PermissionCategory = z.infer<typeof PermissionCategory>;

/** Enforcement per LR-04. `hard` blocks pending confirmation (Rule 20). */
export const Enforcement = z.enum(["auto", "soft", "hard"]);
export type Enforcement = z.infer<typeof Enforcement>;

export const ENFORCEMENT: Record<PermissionCategory, Enforcement> = {
  auto: "auto",
  external_service_setup: "soft",
  credentials: "soft",
  destructive_actions: "hard",
};

/**
 * Patterns mirrored from Loom's `.claude/loom-permissions.yaml` (ADR-0027).
 *
 * Kept in sync deliberately rather than parsed at runtime: IDEA must classify
 * consistently even for a project that has no Loom checkout. A project's own
 * `loom-permissions.local.yaml` may extend these once YAML parsing lands.
 */
export const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  // Local destructive
  /\brm\s+-[rf]+\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\s+(?:.*\s+)?(?:--force|-f)\b/i,
  /\bgit\s+branch\s+-D\b/,
  /\bgit\s+clean\s+-[fd]+\b/i,
  /\bRemove-Item\s+.*\s+-Recurse\s+-Force\b/i,
  // Remote code execution — piping a download into a shell
  /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python[0-9.]*|perl|ruby|node)\b/i,
  /\b(?:sh|bash|zsh)\s+<\(\s*(?:curl|wget)\b/i,
  /\b(?:iex|Invoke-Expression)\b.*(?:DownloadString|Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\birm\b|curl|wget)/i,
  /\.DownloadString\(/i,
  // Database destructive
  /\bdrop\s+(?:table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bprisma\s+migrate\s+reset\b/i,
  /\bsupabase\s+db\s+reset\b/i,
  // Production mutation (was LR-02)
  /\bvercel\s+deploy\b/i,
  /\bvercel\s+(?:.*\s+)?--prod\b/i,
  /\bnpm\s+publish\b/i,
  /\bgh\s+release\s+create\b/i,
  /\bgit\s+push\s+(?:.*\s+)?origin\s+(?:main|master|prod|production)\b/i,
  /\bprisma\s+migrate\s+deploy\b/i,
  /\bterraform\s+apply\b/i,
  /\bkubectl\s+apply\s+.*\s+(?:prod|production)\b/i,
];

export const EXTERNAL_SETUP_PATTERNS: readonly RegExp[] = [
  /\bvercel\s+projects\s+(?:add|create)\b/i,
  /\bfly\s+apps\s+create\b/i,
  /\brender\s+services\s+create\b/i,
  /\bsupabase\s+projects\s+create\b/i,
  /\brailway\s+init\b/i,
  /\bplanetscale\s+(?:database|branch)\s+create\b/i,
  /\bdoctl\s+(?:apps|compute)\s+create\b/i,
  /\bgcloud\s+\w+\s+create\b/i,
  /\baws\s+\w+\s+create-\w+\b/i,
  /\baz\s+\w+\s+create\b/i,
  /\bsupabase\s+link\b/i,
  /\bvercel\s+domains\b/i,
  /\bgh\s+repo\s+create\b/i,
];

export const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /--token\b/i,
  /\bnpm\s+login\b/i,
  /\bgh\s+auth\b/i,
  /\bvercel\s+env\s+add\b/i,
  /\bdocker\s+login\b/i,
  /\baws\s+configure\b/i,
];

/** Billable operations warrant a quota pre-flight (ADR-0032 §B). */
export const BILLABLE_PATTERNS: readonly RegExp[] = [
  /\bvercel\s+deploy\b/i,
  /\bnetlify\s+deploy\b/i,
  /\bfly\s+deploy\b/i,
  /\brender\s+deploy\b/i,
  /\brailway\s+(?:up|deploy)\b/i,
];

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

export interface ToolCall {
  tool: string;
  args?: Record<string, unknown>;
  /** The command line, for shell-style tools. */
  command?: string;
}

export interface Classification {
  category: PermissionCategory;
  enforcement: Enforcement;
  /** The pattern that matched, for the audit trail (Rule 22). */
  matched: string | null;
  requiresPreFlightQuota: boolean;
}

/** Everything the classifier can see, flattened for pattern matching. */
function surfaceOf(call: ToolCall): string {
  const parts = [call.tool, call.command ?? ""];
  if (call.args) {
    for (const v of Object.values(call.args)) {
      if (typeof v === "string") parts.push(v);
      else if (v != null) parts.push(JSON.stringify(v));
    }
  }
  return parts.join(" ");
}

function firstMatch(text: string, patterns: readonly RegExp[]): string | null {
  for (const re of patterns) if (re.test(text)) return re.source;
  return null;
}

/**
 * Classify a tool call (LR-04). Destructive wins over the others: a call that is
 * both a credential operation and a production mutation must get the stricter
 * treatment, not the friendlier one.
 */
export function classify(call: ToolCall): Classification {
  const text = surfaceOf(call);
  const billable = firstMatch(text, BILLABLE_PATTERNS) !== null;

  const destructive = firstMatch(text, DESTRUCTIVE_PATTERNS);
  if (destructive) {
    return {
      category: "destructive_actions",
      enforcement: "hard",
      matched: destructive,
      requiresPreFlightQuota: billable,
    };
  }
  const external = firstMatch(text, EXTERNAL_SETUP_PATTERNS);
  if (external) {
    return {
      category: "external_service_setup",
      enforcement: "soft",
      matched: external,
      requiresPreFlightQuota: billable,
    };
  }
  const credential = firstMatch(text, CREDENTIAL_PATTERNS);
  if (credential) {
    return {
      category: "credentials",
      enforcement: "soft",
      matched: credential,
      requiresPreFlightQuota: billable,
    };
  }
  return {
    category: "auto",
    enforcement: "auto",
    matched: null,
    requiresPreFlightQuota: billable,
  };
}

/* -------------------------------------------------------------------------- */
/* Scope (E-11.a/b/e)                                                          */
/* -------------------------------------------------------------------------- */

export interface ScopeContext {
  /** Absolute path to the active project. An agent lives inside this. */
  projectRoot: string;
  /** Absolute path to IDEA's own source — never agent-writable (E-11.b). */
  ideaRoot: string;
  /** Absolute path to the vendored loom-template checkout, if present (E-11.a). */
  loomTemplateRoot?: string;
}

export interface ScopeVerdict {
  allowed: boolean;
  reason: string | null;
}

/** Paths that are off-limits regardless of where the project sits. */
const SENSITIVE_SEGMENTS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".npmrc"];

function contains(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Is this path inside the agent's blast radius?
 *
 * The boundary is the **project**, not the capability (E-11.e). Inside it an
 * agent is a capable collaborator; outside it has no reach.
 */
export function checkPath(target: string, ctx: ScopeContext): ScopeVerdict {
  if (!target) return { allowed: false, reason: "empty path" };

  const abs = isAbsolute(target) ? resolve(target) : resolve(ctx.projectRoot, target);

  if (ctx.loomTemplateRoot && contains(ctx.loomTemplateRoot, abs)) {
    return {
      allowed: false,
      reason: "loom-template is upstream and shared — never written to (E-11.a)",
    };
  }
  if (contains(ctx.ideaRoot, abs) && !contains(ctx.projectRoot, abs)) {
    return {
      allowed: false,
      reason: "IDEA's own source is not agent-writable while it is running (E-11.b)",
    };
  }
  if (!contains(ctx.projectRoot, abs)) {
    return {
      allowed: false,
      reason: `outside the active project — agents are scoped to ${ctx.projectRoot} (E-11.e)`,
    };
  }
  const segments = abs.split(sep).map((s) => s.toLowerCase());
  const hit = SENSITIVE_SEGMENTS.find((s) => segments.includes(s));
  if (hit) {
    return { allowed: false, reason: `${hit} holds credentials and is never readable by an agent` };
  }
  return { allowed: true, reason: null };
}

/* -------------------------------------------------------------------------- */
/* The Rule 20 gate                                                            */
/* -------------------------------------------------------------------------- */

export const Decision = z.enum(["allow", "confirm", "refuse"]);
export type Decision = z.infer<typeof Decision>;

export interface GateInput {
  call: ToolCall;
  /** Paths the call will touch, if known. */
  paths?: readonly string[];
  scope: ScopeContext;
  /** False when the agent runs unattended — nobody is there to confirm. */
  humanPresent: boolean;
}

export interface GateResult {
  decision: Decision;
  classification: Classification;
  /** Human-readable, shown to the user or handed back to the agent. */
  reason: string;
  /** Rule 22: what gets written to the trace log. */
  trace: {
    tool: string;
    category: PermissionCategory;
    enforcement: Enforcement;
    matched: string | null;
    decision: Decision;
  };
}

/**
 * Decide whether a call proceeds (Kernel Rule 20).
 *
 * Reversible actions auto-approve. Irreversible ones require confirmation —
 * whether the agent reasoned its way there or was talked into it. That last
 * clause is the point: this gate is the one layer that does not depend on the
 * model's judgment, which is what makes broad latitude elsewhere safe to grant.
 */
export function gate(input: GateInput): GateResult {
  const classification = classify(input.call);

  // Scope is checked first: an out-of-bounds path is refused outright, never
  // escalated to a confirmation the user might wave through.
  for (const path of input.paths ?? []) {
    const verdict = checkPath(path, input.scope);
    if (!verdict.allowed) {
      return result("refuse", classification, `Refused: ${verdict.reason}.`, input.call);
    }
  }

  if (classification.enforcement === "hard") {
    if (!input.humanPresent) {
      // FR-11.5 — pause and surface rather than proceed or silently fail.
      return result(
        "confirm",
        classification,
        `Paused: this is an irreversible action (${classification.category}) and no one is available to confirm it. ` +
          `Kernel Rule 20 requires confirmation before destructive operations.`,
        input.call,
      );
    }
    return result(
      "confirm",
      classification,
      `Confirmation required: ${describe(classification)} Kernel Rule 20 — destructive operations require confirmation.`,
      input.call,
    );
  }

  if (classification.enforcement === "soft") {
    return result(
      "allow",
      classification,
      `Allowed and logged: ${describe(classification)} LR-04 soft enforcement — the Critic reviews drift.`,
      input.call,
    );
  }

  return result("allow", classification, "Reversible action — auto-approved (Kernel Rule 20).", input.call);
}

function describe(c: Classification): string {
  const quota = c.requiresPreFlightQuota ? " This operation is billable." : "";
  return `classified ${c.category}${c.matched ? ` (matched \`${c.matched}\`)` : ""}.${quota}`;
}

function result(
  decision: Decision,
  classification: Classification,
  reason: string,
  call: ToolCall,
): GateResult {
  return {
    decision,
    classification,
    reason,
    trace: {
      tool: call.tool,
      category: classification.category,
      enforcement: classification.enforcement,
      matched: classification.matched,
      decision,
    },
  };
}
