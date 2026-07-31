import type { LoomEvent } from "@/lib/observatory";

/**
 * A readable trace of what actually happened (FR-13.1).
 *
 * The dashboard answered "how many" — sessions, errors, decisions — which tells
 * you a system is busy, not what it did. This answers the questions the architect
 * actually asked: **who** acted, **what** they did, **where**, **when**, **why**,
 * and **what it cost**.
 *
 * Built from the same events the panels already read. Nothing new is required
 * upstream; the information was there and was being summed instead of shown.
 */

/** What kind of thing happened. Drives colour, so keep it small and meaningful. */
export type EventKind =
  | "session" // a run started or ended
  | "tool" // something was executed
  | "governance" // a rule was consulted, an action was gated
  | "violation" // an attempt against the guardrails
  | "claim" // an agent asserted something, with confidence
  | "agent" // an agent was spawned, retired, or invoked
  | "skill" // a skill was used
  | "test" // a test ran
  | "deploy"
  | "cost" // token usage was recorded
  | "other";

/** Who did it. "Unknown" is a real answer and is shown as one. */
export type Actor = "agent" | "model" | "script" | "system" | "unknown";

export interface TimelineEvent {
  at: string | null;
  sessionId: string | null;
  kind: EventKind;
  /** The raw `event_type`, kept so nothing is lost in translation. */
  type: string;
  actor: Actor;
  /** The named agent, where the log says. */
  actorName: string | null;
  /** WHAT happened, in a phrase. */
  what: string;
  /** WHERE — a tool, a file, a command. Null when the log does not say. */
  where: string | null;
  /** WHY — the rule, the reason, the decision that produced it. */
  why: string | null;
  /** The governing rule id (`LR-04`, `ADR-0047`), when cited. */
  rule: string | null;
  /** Tokens, when this event carries them. Null means unmeasured, not zero. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Code ran, inference ran, or we cannot tell. */
  execution: "deterministic" | "model" | "unknown";
  /** Did it fail? Drives the red. */
  failed: boolean;
}

/** Events that represent an attempt the guardrails had to rule on. */
const ATTEMPT_TYPES = new Set([
  "destructive_actions_attempted",
  "destructive_action_decision",
  "production_mutation_attempted",
  "browser_credential_automation_attempted",
  "external_service_setup_attempted",
  "credentials_attempted",
  "constitution_check_missing",
  "destructive_op",
]);

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Who performed this event.
 *
 * The log names an agent on `claim` and on the new provenance events; a tool
 * call is code executing; everything else is the harness. Guessing beyond that
 * would put a confident wrong name on a row, so `unknown` stays available.
 */
function actorFor(event: LoomEvent, type: string): { actor: Actor; actorName: string | null } {
  const named = str(event.agent) ?? str(event.specialist) ?? str(event.parent_agent);
  if (named) return { actor: "agent", actorName: named };

  if (type === "tool_call" || type === "tool_result" || type === "destructive_op") {
    const kind = str(event.execution_kind);
    // A tool call is a model's decision executed as code. Where the emitter says
    // which, believe it; otherwise say so.
    if (kind === "model") return { actor: "model", actorName: null };
    if (kind === "deterministic") return { actor: "script", actorName: null };
    return { actor: "unknown", actorName: null };
  }
  if (type.startsWith("session_") || type.startsWith("auto_bootstrap") || type === "observatory_auto_started") {
    return { actor: "system", actorName: null };
  }
  if (type.startsWith("test_") || type === "efficacy_run" || type === "runtime_discovery_run") {
    return { actor: "script", actorName: null };
  }
  return { actor: "unknown", actorName: null };
}

function kindFor(type: string, failed: boolean): EventKind {
  if (type === "session_start" || type === "session_end") return "session";
  if (type === "claim") return "claim";
  if (type === "skill_invoked") return "skill";
  if (type === "agent_invoked" || type === "specialist_spawned" || type === "specialist_retired") {
    return "agent";
  }
  if (type.startsWith("test_")) return "test";
  if (type.startsWith("deployment_")) return "deploy";
  if (type === "session_token_usage" || type === "turn_token_usage" || type === "loop_cost_summary") {
    return "cost";
  }
  if (ATTEMPT_TYPES.has(type)) {
    // A refused or missing check is a violation; an attempt that was ruled on is
    // governance working. The difference is the whole point of the colour.
    return failed ? "violation" : "governance";
  }
  if (type === "tool_call" || type === "tool_result") return "tool";
  return "other";
}

/**
 * Turn one raw event into a row a person can read.
 *
 * Every field may be null. A timeline that invents a `why` because the column
 * looked empty is worse than one with gaps — the gaps are exactly what tells you
 * which instrumentation to add next.
 */
export function toTimelineEvent(event: LoomEvent): TimelineEvent | null {
  const type = str(event.event_type);
  if (!type) return null;

  const exit = num(event.exit_code);
  const decision = str(event.decision) ?? str(event.outcome) ?? str(event.result);
  const failed =
    (exit !== null && exit !== 0) ||
    type === "constitution_check_missing" ||
    type === "deployment_non_progressing" ||
    decision === "refuse" ||
    decision === "denied" ||
    Boolean(str(event.error_signature));

  const rule = str(event.rule);
  const where =
    str(event.tool) ??
    str(event.command) ??
    str(event.skill) ??
    str(event.target) ??
    str(event.cwd);

  const why =
    str(event.reason) ??
    str(event.justification) ??
    (decision ? `decision: ${decision}` : null) ??
    (rule ? `governed by ${rule}` : null) ??
    str(event.error_preview) ??
    str(event.what_would_raise_to_95);

  const what = describe(event, type, decision);
  const { actor, actorName } = actorFor(event, type);

  const execution = ((): TimelineEvent["execution"] => {
    const k = str(event.execution_kind);
    return k === "model" || k === "deterministic" ? k : "unknown";
  })();

  return {
    at: str(event.timestamp),
    sessionId: str(event.session_id),
    kind: kindFor(type, failed),
    type,
    actor,
    actorName,
    what,
    where,
    why,
    rule,
    inputTokens: num(event.input_tokens),
    outputTokens: num(event.output_tokens),
    execution,
    failed,
  };
}

/** A phrase for the row. Falls back to the event name rather than inventing prose. */
function describe(event: LoomEvent, type: string, decision: string | null): string {
  switch (type) {
    case "session_start":
      return "session started";
    case "session_end":
      return "session ended";
    case "tool_call":
      return `called ${str(event.tool) ?? "a tool"}`;
    case "tool_result":
      return `${str(event.tool) ?? "a tool"} returned`;
    case "claim":
      return str(event.claim) ?? "made a claim";
    case "skill_invoked":
      return `used /${str(event.skill) ?? "a skill"}`;
    case "agent_invoked":
      return `${str(event.parent_agent) ?? "main"} → ${str(event.agent) ?? "an agent"}`;
    case "specialist_spawned":
      return "spawned a specialist";
    case "specialist_retired":
      return "retired a specialist";
    case "constitution_check_missing":
      return "production mutation with no constitution check";
    case "destructive_op":
      return "destructive operation";
    case "test_run_summary":
      return "test run finished";
    case "session_token_usage":
    case "turn_token_usage":
      return "token usage recorded";
    default:
      if (ATTEMPT_TYPES.has(type)) {
        const label = type.replace(/_/g, " ");
        return decision ? `${label} → ${decision}` : label;
      }
      return type.replace(/_/g, " ");
  }
}

export interface SessionTrace {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  events: TimelineEvent[];
  /** Null when nothing in the session recorded tokens — never 0. */
  inputTokens: number | null;
  outputTokens: number | null;
  failures: number;
  violations: number;
}

/**
 * Group a timeline into sessions, newest session first.
 *
 * Token totals stay **null** when nothing measured them. Summing to zero and
 * showing "0 tokens" would read as a free session rather than an unmeasured one
 * — the defect this dashboard has reproduced twice already.
 */
export function groupIntoSessions(events: readonly TimelineEvent[]): SessionTrace[] {
  const byId = new Map<string, SessionTrace>();

  for (const e of events) {
    const id = e.sessionId ?? "unattributed";
    let trace = byId.get(id);
    if (!trace) {
      trace = {
        sessionId: id,
        startedAt: null,
        endedAt: null,
        events: [],
        inputTokens: null,
        outputTokens: null,
        failures: 0,
        violations: 0,
      };
      byId.set(id, trace);
    }

    trace.events.push(e);
    if (e.type === "session_start" && e.at) trace.startedAt = e.at;
    if (e.type === "session_end" && e.at) trace.endedAt = e.at;
    if (e.failed) trace.failures += 1;
    if (e.kind === "violation") trace.violations += 1;

    if (e.inputTokens !== null) trace.inputTokens = (trace.inputTokens ?? 0) + e.inputTokens;
    if (e.outputTokens !== null) trace.outputTokens = (trace.outputTokens ?? 0) + e.outputTokens;
  }

  const traces = [...byId.values()];
  for (const t of traces) {
    t.events.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
    if (!t.startedAt) t.startedAt = t.events.find((e) => e.at)?.at ?? null;
  }

  // Newest first: the session you care about is almost always the last one.
  traces.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return traces;
}
