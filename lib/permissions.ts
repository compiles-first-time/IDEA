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

/**
 * Verification duty, scaled to stakes (Kernel Rule 15).
 *
 * *"Trivial actions can rely on face-value information. Actions approaching
 * bright-line territory require near-absolute verification."*
 */
export const VerificationDuty = z.enum(["face_value", "corroborated", "near_absolute"]);
export type VerificationDuty = z.infer<typeof VerificationDuty>;

export function verificationDuty(category: PermissionCategory): VerificationDuty {
  if (category === "destructive_actions") return "near_absolute";
  if (category === "auto") return "face_value";
  return "corroborated";
}

/** Where a piece of influencing information came from, and how far to trust it. */
export const TraceSource = z.object({
  kind: z.enum(["user", "repo_context", "tool_result", "registry", "external"]),
  ref: z.string(),
  /** LR-01: retrieved and external content is untrusted until validated. */
  trust: z.enum(["trusted", "untrusted"]),
});
export type TraceSource = z.infer<typeof TraceSource>;

/**
 * A Kernel Rule 22 record.
 *
 * Rule 22 requires records be "verbose, explicit, and structurally accurate,"
 * capturing five things. Each field below maps to one of them — the shape is
 * the rule, not a convenience.
 */
export const KernelTrace = z.object({
  ts: z.string(),
  /** (i) what information the agent had access to */
  inputs: z.object({
    tool: z.string(),
    command: z.string().nullable(),
    argKeys: z.array(z.string()),
    paths: z.array(z.string()),
  }),
  /** (ii) what sources it came from and what trust level was assigned */
  sources: z.array(TraceSource),
  /** (iii) what reasoning was applied */
  reasoning: z.string(),
  /** (iv) what alternatives were considered and why rejected */
  alternatives: z.array(z.object({ option: Decision, rejected: z.string() })),
  /** (v) confidence level in the resulting decision */
  confidence: z.enum(["high", "medium", "low"]),
  category: PermissionCategory,
  enforcement: Enforcement,
  matched: z.string().nullable(),
  decision: Decision,
  verificationDuty: VerificationDuty,
});
export type KernelTrace = z.infer<typeof KernelTrace>;

export interface GateInput {
  call: ToolCall;
  /** Paths the call will touch, if known. */
  paths?: readonly string[];
  scope: ScopeContext;
  /** False when the agent runs unattended — nobody is there to confirm. */
  humanPresent: boolean;
  /** What informed this call. Untrusted sources raise the verification bar. */
  sources?: readonly TraceSource[];
  /** ISO timestamp; a parameter so the gate stays pure and testable. */
  now?: Date;
}

export interface GateResult {
  decision: Decision;
  classification: Classification;
  /** Human-readable, shown to the user or handed back to the agent. */
  reason: string;
  /** Kernel Rule 22 record. */
  trace: KernelTrace;
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
  const untrusted = (input.sources ?? []).filter((s) => s.trust === "untrusted");

  // Scope is checked first: an out-of-bounds path is refused outright, never
  // escalated to a confirmation the user might wave through.
  for (const path of input.paths ?? []) {
    const verdict = checkPath(path, input.scope);
    if (!verdict.allowed) {
      return build("refuse", classification, `Refused: ${verdict.reason}.`, input, [
        { option: "allow", rejected: verdict.reason ?? "outside the agent's scope" },
        { option: "confirm", rejected: "a scope violation must not become a prompt a user can wave through" },
      ]);
    }
  }

  if (classification.enforcement === "hard") {
    /* Rule 15: near-absolute verification is required at this stake level. An
       untrusted source informing an irreversible action is exactly the Rule
       13/14 shape — a fabricating supplier steering an agent as an instrument. */
    const rule15 =
      untrusted.length > 0
        ? ` Rule 15 — this action was informed by ${untrusted.length} untrusted source(s) ` +
          `(${untrusted.map((s) => s.ref).join(", ")}) and requires near-absolute verification before proceeding.`
        : "";

    const reason = input.humanPresent
      ? `Confirmation required: ${describe(classification)} Kernel Rule 20 — destructive operations require confirmation.${rule15}`
      : `Paused: this is an irreversible action (${classification.category}) and no one is available to confirm it. ` +
        `Kernel Rule 20 requires confirmation before destructive operations.${rule15}`;

    return build("confirm", classification, reason, input, [
      { option: "allow", rejected: "irreversible under Rule 20 — reversibility is the axis, not capability" },
      { option: "refuse", rejected: "the action is in scope and may be legitimate; Rule 8 leaves the choice to the human" },
    ]);
  }

  if (classification.enforcement === "soft") {
    return build(
      "allow",
      classification,
      `Allowed and logged: ${describe(classification)} LR-04 soft enforcement — the Critic reviews drift.`,
      input,
      [
        { option: "confirm", rejected: "reversible — Rule 20 does not require confirmation" },
        { option: "refuse", rejected: "in scope and reversible" },
      ],
    );
  }

  return build("allow", classification, "Reversible action — auto-approved (Kernel Rule 20).", input, [
    { option: "confirm", rejected: "no pattern matched any non-auto category" },
    { option: "refuse", rejected: "in scope" },
  ]);
}

function describe(c: Classification): string {
  const quota = c.requiresPreFlightQuota ? " This operation is billable." : "";
  return `classified ${c.category}${c.matched ? ` (matched \`${c.matched}\`)` : ""}.${quota}`;
}

/**
 * Confidence in the decision (Rule 22 item v).
 *
 * A matched pattern is positive evidence — high confidence. An `auto`
 * classification rests on the *absence* of a match, which is weaker: the
 * pattern list is curated and will miss novel forms, exactly as LR-02 and LR-04
 * say of their own heuristics. Saying so is the honest reading of Rule 22.
 */
function confidenceOf(c: Classification, untrustedCount: number): "high" | "medium" | "low" {
  if (c.matched) return "high";
  if (untrustedCount > 0) return "low";
  return "medium";
}

function build(
  decision: Decision,
  classification: Classification,
  reason: string,
  input: GateInput,
  alternatives: Array<{ option: Decision; rejected: string }>,
): GateResult {
  const sources = [...(input.sources ?? [])];
  const untrustedCount = sources.filter((s) => s.trust === "untrusted").length;

  return {
    decision,
    classification,
    reason,
    trace: KernelTrace.parse({
      ts: (input.now ?? new Date()).toISOString(),
      inputs: {
        tool: input.call.tool,
        command: input.call.command ?? null,
        argKeys: Object.keys(input.call.args ?? {}).sort(),
        paths: [...(input.paths ?? [])],
      },
      sources,
      reasoning: reason,
      alternatives: alternatives.filter((a) => a.option !== decision),
      confidence: confidenceOf(classification, untrustedCount),
      category: classification.category,
      enforcement: classification.enforcement,
      matched: classification.matched,
      decision,
      verificationDuty: verificationDuty(classification.category),
    }),
  };
}
