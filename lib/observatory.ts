import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { redactUnknown } from "@/lib/redact";

/**
 * The Observatory projection (S-37, FR-12).
 *
 * IDEA's dashboard **is** the Loom Observatory. Rather than running a separate
 * server per project, IDEA reads each project's append-only event log and folds
 * it into the same shape Loom's aggregator produces.
 *
 * **Data, never code (E-12.a).** Importing a cloned repo's
 * `observatory/lib/aggregator.mjs` would execute repo content in IDEA's
 * process — the thing E-8.c forbids for provisioning, for the same reason. The
 * event log is JSONL: data, safe to read.
 */

export const EVENT_LOG_DIR = join("memory", "event-log");

/** Every event type Loom's aggregator handles, as of kernel v6 tooling. */
export const KNOWN_EVENT_TYPES = [
  "session_start",
  "session_end",
  "tool_call",
  "tool_result",
  "destructive_op",
  "constitution_check_missing",
  "deployment_started",
  "deployment_completed",
  "deployment_non_progressing",
  "specialist_spawned",
  "specialist_retired",
  "reputation_event",
  "efficacy_run",
  "deliberation",
  "verifier_result",
  "bootstrapped_this_session",
  "loop_cost_summary",
  "session_token_usage",
  "test_result",
  "test_run_summary",
  "test_case",
  "ticket",
  "subagent_suggestion",
  "oauth_preference_hint",
  "lessons_autosuggest",
  // S-39: eleven types Loom actually emits that were being dropped into
  // `unknownEventTypes` and rendered nowhere. Every event carrying a `rule`
  // field was in this set, so all rule and ADR attribution was being received
  // and discarded.
  "claim",
  "runtime_discovery_run",
  "destructive_actions_attempted",
  "destructive_action_decision",
  "production_mutation_attempted",
  "browser_credential_automation_attempted",
  "external_service_setup_attempted",
  "credentials_attempted",
  "observatory_auto_started",
  "auto_bootstrap_attempted",
  "auto_bootstrap_result",
  // Upstream provenance instrumentation (loom-template, 2026-07-28) — added to
  // the reader in the same change as the writer, so the drift that hid 244
  // events cannot repeat for these.
  "skill_invoked",
  "agent_invoked",
  "turn_token_usage",
] as const;

/**
 * Permission-attempt events, all of which carry a `rule`.
 *
 * These are the governance record: what an agent tried, which rule governed it,
 * and what was decided. They belong together in the compliance view rather than
 * scattered by event name.
 */
export const PERMISSION_EVENT_TYPES = [
  "destructive_actions_attempted",
  "destructive_action_decision",
  "production_mutation_attempted",
  "browser_credential_automation_attempted",
  "external_service_setup_attempted",
  "credentials_attempted",
  "constitution_check_missing",
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/** A record from the log. Only `event_type` is required — the rest varies. */
export const LoomEvent = z
  .object({
    event_type: z.string(),
    timestamp: z.string().optional(),
    session_id: z.string().optional(),
  })
  .passthrough();

export type LoomEvent = z.infer<typeof LoomEvent> & Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Projection state                                                            */
/* -------------------------------------------------------------------------- */

export interface SessionSummary {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  toolCalls: number;
  errors: number;
  lastTool: string | null;
  active: boolean;
}

export interface ActivityItem {
  at: string | null;
  kind: string;
  detail: string;
}

export interface ObservatoryState {
  project: string;
  sessions: { active: SessionSummary[]; history: SessionSummary[] };
  cost: {
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
    bySession: Record<string, { inputTokens: number; outputTokens: number; estimatedUsd: number }>;
  };
  failures: {
    errors: Array<{ at: string | null; sessionId: string | null; tool: string | null; preview: string | null }>;
    /** Repeat signatures are the ones worth writing a lesson about (Rule 10). */
    signatures: Record<string, number>;
  };
  compliance: {
    destructiveOps: Array<{ at: string | null; detail: string }>;
    constitutionChecksMissing: number;
    /**
     * FR-13.4 — which rule governed which decision, both directions.
     * Keyed by rule id (`LR-04`, `ADR-0047`, kernel rule).
     */
    byRule: Record<
      string,
      {
        count: number;
        decisions: Array<{
          at: string | null;
          eventType: string;
          decision: string | null;
          detail: string | null;
        }>;
      }
    >;
    /** Every permission attempt, newest last, whatever rule it cited. */
    attempts: Array<{
      at: string | null;
      eventType: string;
      rule: string | null;
      decision: string | null;
      detail: string | null;
    }>;
  };
  /**
   * Claim events — the only place agent identity appears in the log today.
   * A low-confidence claim with no sources is what a reviewer wants to see.
   */
  claims: Array<{
    at: string | null;
    agent: string | null;
    claim: string | null;
    confidence: string | null;
    sources: number;
    whatWouldRaise: string | null;
  }>;
  /** FR-13.1 — which agent used which skill. */
  skills: Record<string, { count: number; agents: string[] }>;
  /** FR-13.5 — which agent invoked which agent. */
  agentEdges: Array<{ parent: string; child: string; at: string | null }>;
  /**
   * FR-13.2/13.3 — per-turn cost and execution kind.
   *
   * Deliberately NOT added to `cost` totals: `session_token_usage` is already
   * session-cumulative, so summing both would double-count. These exist to
   * attribute cost to a *node*, which the session total cannot do.
   */
  turns: Array<{
    at: string | null;
    sessionId: string | null;
    turnIndex: number;
    inputTokens: number;
    outputTokens: number;
    model: string | null;
    tools: string[];
  }>;
  /** How much of the log ran as code rather than inference. */
  executionKinds: Record<string, number>;
  agents: { spawned: string[]; retired: string[] };
  deploys: { history: Array<{ at: string | null; status: string; detail: string }> };
  testing: { lastRun: string | null; passed: number; failed: number };
  tickets: Array<{ id: string; state: string; title: string }>;
  activity: ActivityItem[];
  /** FR-12.5 — drift is surfaced, never silently dropped. */
  unknownEventTypes: Record<string, number>;
  meta: {
    eventsRead: number;
    filesRead: number;
    /** Null when the project has no event log yet. */
    newestEventAt: string | null;
    hasEventLog: boolean;
  };
}

function emptyState(project: string): ObservatoryState {
  return {
    project,
    sessions: { active: [], history: [] },
    cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0, bySession: {} },
    failures: { errors: [], signatures: {} },
    compliance: { destructiveOps: [], constitutionChecksMissing: 0, byRule: {}, attempts: [] },
    claims: [],
    skills: {},
    agentEdges: [],
    turns: [],
    executionKinds: {},
    agents: { spawned: [], retired: [] },
    deploys: { history: [] },
    testing: { lastRun: null, passed: 0, failed: 0 },
    tickets: [],
    activity: [],
    unknownEventTypes: {},
    meta: { eventsRead: 0, filesRead: 0, newestEventAt: null, hasEventLog: false },
  };
}

/* -------------------------------------------------------------------------- */
/* Folding                                                                     */
/* -------------------------------------------------------------------------- */

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function sessionFor(state: ObservatoryState, id: string | null): SessionSummary | undefined {
  if (!id) return undefined;
  return state.sessions.active.find((s) => s.sessionId === id);
}

/** Keep the newest claims; a long-running project would otherwise grow the state. */
const MAX_CLAIMS = 100;
/** Same bound for the permission ledger. */
const MAX_ATTEMPTS = 200;
/** Per-turn cost rows and agent edges are bounded for the same reason. */
const MAX_TURNS = 300;
const MAX_EDGES = 200;

/**
 * Fold one permission-attempt event into the compliance record (FR-13.4).
 *
 * Indexes by rule so the view works in both directions: a decision links to the
 * rule that governed it, and a rule lists every decision it governed. An event
 * with no rule is still recorded — dropping it would hide an ungoverned action,
 * which is the more alarming case, not the less.
 */
function recordPermissionAttempt(
  state: ObservatoryState,
  eventType: string,
  event: LoomEvent,
  at: string | null,
): { rule: string | null; decision: string | null; detail: string | null } {
  const rule = str(event.rule);
  const decision = str(event.decision) ?? str(event.outcome) ?? str(event.result);
  const detail =
    str(event.command) ?? str(event.detail) ?? str(event.tool) ?? str(event.reason);

  state.compliance.attempts.push({ at, eventType, rule, decision, detail });
  if (state.compliance.attempts.length > MAX_ATTEMPTS) state.compliance.attempts.shift();

  if (rule) {
    const bucket = (state.compliance.byRule[rule] ??= { count: 0, decisions: [] });
    bucket.count += 1;
    bucket.decisions.push({ at, eventType, decision, detail });
    if (bucket.decisions.length > 25) bucket.decisions.shift();
  }

  return { rule, decision, detail };
}

function note(state: ObservatoryState, kind: string, detail: string, at: string | null) {
  state.activity.push({ at, kind, detail });
}

/** Fold one event into the state. Pure and total — a bad record is ignored. */
export function applyEvent(state: ObservatoryState, event: LoomEvent): void {
  const type = event.event_type;
  const at = str(event.timestamp);
  const sid = str(event.session_id);

  if (at && (!state.meta.newestEventAt || at > state.meta.newestEventAt)) {
    state.meta.newestEventAt = at;
  }
  state.meta.eventsRead += 1;

  if (!(KNOWN_EVENT_TYPES as readonly string[]).includes(type)) {
    state.unknownEventTypes[type] = (state.unknownEventTypes[type] ?? 0) + 1;
    return;
  }

  switch (type) {
    case "session_start": {
      if (!sid) break;
      // A duplicate start for a session already tracked is ignored rather than
      // creating a second entry — logs can be re-read, and an event can appear
      // twice without the session having restarted.
      if (state.sessions.active.some((s) => s.sessionId === sid)) break;
      state.sessions.active.push({
        sessionId: sid,
        startedAt: at,
        endedAt: null,
        toolCalls: 0,
        errors: 0,
        lastTool: null,
        active: true,
      });
      note(state, "session", `session ${sid.slice(0, 8)} started`, at);
      break;
    }

    case "session_end": {
      const idx = state.sessions.active.findIndex((s) => s.sessionId === sid);
      const session =
        idx >= 0
          ? state.sessions.active.splice(idx, 1)[0]
          : {
              sessionId: sid ?? "unknown",
              startedAt: str(event.started_at),
              endedAt: null,
              toolCalls: 0,
              errors: 0,
              lastTool: null,
              active: true,
            };
      state.sessions.history.push({
        ...session,
        endedAt: str(event.ended_at) ?? at,
        toolCalls: session.toolCalls || num(event.tool_calls),
        errors: session.errors || num(event.errors),
        active: false,
      });
      break;
    }

    case "tool_call": {
      const session = sessionFor(state, sid);
      if (session) {
        session.toolCalls += 1;
        session.lastTool = str(event.tool);
      }
      // FR-13.3 — code vs inference. Absent on older events, which is honestly
      // "unknown" rather than either answer.
      const kind = str(event.execution_kind) ?? "unknown";
      state.executionKinds[kind] = (state.executionKinds[kind] ?? 0) + 1;
      break;
    }

    case "tool_result": {
      const exit = num(event.exit_code);
      if (exit === 0) break;
      const session = sessionFor(state, sid);
      if (session) session.errors += 1;

      state.failures.errors.push({
        at,
        sessionId: sid,
        tool: str(event.tool),
        preview: str(event.error_preview),
      });
      const sig = str(event.error_signature);
      if (sig) state.failures.signatures[sig] = (state.failures.signatures[sig] ?? 0) + 1;
      break;
    }

    case "destructive_op": {
      const detail = str(event.command) ?? str(event.detail) ?? "destructive operation";
      state.compliance.destructiveOps.push({ at, detail });
      note(state, "destructive", detail, at);
      break;
    }

    case "constitution_check_missing":
      state.compliance.constitutionChecksMissing += 1;
      recordPermissionAttempt(state, type, event, at);
      note(state, "compliance", "production mutation without a constitution check", at);
      break;

    // S-39 — the permission-attempt family. These carry the `rule` field, which
    // is the whole governance record: what was tried and what governed it.
    case "destructive_actions_attempted":
    case "destructive_action_decision":
    case "production_mutation_attempted":
    case "browser_credential_automation_attempted":
    case "external_service_setup_attempted":
    case "credentials_attempted": {
      const { rule, decision, detail } = recordPermissionAttempt(state, type, event, at);
      const label = type.replace(/_/g, " ");
      note(
        state,
        "compliance",
        [label, rule && `(${rule})`, decision && `→ ${decision}`, detail]
          .filter(Boolean)
          .join(" "),
        at,
      );
      break;
    }

    case "claim": {
      const sources = Array.isArray(event.sources)
        ? event.sources.length
        : event.source !== undefined
          ? 1
          : 0;
      state.claims.push({
        at,
        agent: str(event.agent),
        claim: str(event.claim),
        confidence: str(event.confidence),
        sources,
        whatWouldRaise: str(event.what_would_raise_to_95),
      });
      if (state.claims.length > MAX_CLAIMS) state.claims.shift();
      const who = str(event.agent) ?? "an agent";
      note(state, "claim", `${who}: ${str(event.claim) ?? "claim"}`, at);
      break;
    }

    case "runtime_discovery_run":
      note(state, "discovery", "runtime discovery ran", at);
      break;

    case "skill_invoked": {
      const skill = str(event.skill);
      if (!skill) break;
      const bucket = (state.skills[skill] ??= { count: 0, agents: [] });
      bucket.count += 1;
      const who = str(event.agent);
      if (who && !bucket.agents.includes(who)) bucket.agents.push(who);
      note(state, "skill", `${who ?? "an agent"} used /${skill}`, at);
      break;
    }

    case "agent_invoked": {
      const child = str(event.agent);
      if (!child) break;
      const parent = str(event.parent_agent) ?? "main";
      state.agentEdges.push({ parent, child, at });
      if (state.agentEdges.length > MAX_EDGES) state.agentEdges.shift();
      if (!state.agents.spawned.includes(child)) state.agents.spawned.push(child);
      note(state, "agent", `${parent} → ${child}`, at);
      break;
    }

    case "turn_token_usage": {
      // Not folded into cost totals — session_token_usage already covers the
      // session, and adding both would double-count. This exists to attach cost
      // to a node, which a session total cannot do.
      const tools = Array.isArray(event.tool_uses)
        ? (event.tool_uses as Array<{ tool?: unknown }>)
            .map((t) => str(t?.tool))
            .filter((t): t is string => Boolean(t))
        : [];
      state.turns.push({
        at,
        sessionId: sid,
        turnIndex: num(event.turn_index),
        inputTokens: num(event.input_tokens),
        outputTokens: num(event.output_tokens),
        model: str(event.model),
        tools,
      });
      if (state.turns.length > MAX_TURNS) state.turns.shift();
      break;
    }

    case "observatory_auto_started":
    case "auto_bootstrap_attempted":
    case "auto_bootstrap_result": {
      const detail = str(event.result) ?? str(event.status) ?? str(event.detail);
      note(state, "bootstrap", [type.replace(/_/g, " "), detail].filter(Boolean).join(": "), at);
      break;
    }

    case "specialist_spawned": {
      const name = str(event.specialist) ?? str(event.name);
      if (name && !state.agents.spawned.includes(name)) state.agents.spawned.push(name);
      if (name) note(state, "agent", `${name} spawned`, at);
      break;
    }

    case "specialist_retired": {
      const name = str(event.specialist) ?? str(event.name);
      if (name && !state.agents.retired.includes(name)) state.agents.retired.push(name);
      break;
    }

    case "deployment_started":
    case "deployment_completed":
    case "deployment_non_progressing": {
      const status = type.replace("deployment_", "");
      const detail = str(event.target) ?? str(event.detail) ?? status;
      state.deploys.history.push({ at, status, detail });
      note(state, "deploy", `${status}: ${detail}`, at);
      break;
    }

    case "session_token_usage":
    case "loop_cost_summary": {
      const input = num(event.input_tokens) || num(event.estimated_tokens);
      const output = num(event.output_tokens);
      const usd = num(event.estimated_usd) || num(event.cost_usd);

      state.cost.inputTokens += input;
      state.cost.outputTokens += output;
      state.cost.estimatedUsd += usd;

      const key = sid ?? "unattributed";
      const bucket = (state.cost.bySession[key] ??= {
        inputTokens: 0,
        outputTokens: 0,
        estimatedUsd: 0,
      });
      bucket.inputTokens += input;
      bucket.outputTokens += output;
      bucket.estimatedUsd += usd;
      break;
    }

    case "test_run_summary": {
      state.testing.lastRun = at;
      state.testing.passed += num(event.passed);
      state.testing.failed += num(event.failed);
      note(state, "tests", `${num(event.passed)} passed, ${num(event.failed)} failed`, at);
      break;
    }

    case "test_result":
    case "test_case": {
      if (event.ok === false || str(event.status) === "failed") state.testing.failed += 1;
      else state.testing.passed += 1;
      break;
    }

    case "ticket": {
      const id = str(event.id);
      if (!id) break;
      const existing = state.tickets.find((t) => t.id === id);
      const ticket = {
        id,
        state: str(event.state) ?? "unknown",
        title: str(event.title) ?? id,
      };
      if (existing) Object.assign(existing, ticket);
      else state.tickets.push(ticket);
      break;
    }

    // Recorded as activity; these carry no projection of their own yet.
    case "reputation_event":
    case "efficacy_run":
    case "deliberation":
    case "verifier_result":
    case "bootstrapped_this_session":
    case "subagent_suggestion":
    case "oauth_preference_hint":
    case "lessons_autosuggest":
      note(state, type, str(event.detail) ?? str(event.summary) ?? type, at);
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** Parse a JSONL log. A corrupt line is skipped, not fatal. */
export function parseEventLog(contents: string): LoomEvent[] {
  const events: LoomEvent[] = [];
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = LoomEvent.safeParse(JSON.parse(line));
      if (parsed.success) events.push(parsed.data as LoomEvent);
    } catch {
      // A partially-written last line is normal while a session is live.
    }
  }
  return events;
}

export interface ReadOptions {
  /** Only read logs from the most recent N days. */
  days?: number;
  /** Cap total events folded, newest files first. */
  maxEvents?: number;
}

/**
 * Build the projection for a project.
 *
 * Never throws for an absent or unreadable log: a project that has not run yet
 * simply has an empty Observatory, and the UI says so.
 */
export async function projectState(
  projectRoot: string,
  projectName: string,
  opts: ReadOptions = {},
): Promise<ObservatoryState> {
  const state = emptyState(projectName);
  const dir = join(projectRoot, EVENT_LOG_DIR);
  if (!existsSync(dir)) return state;

  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort();
  } catch {
    return state;
  }
  if (files.length === 0) return state;

  state.meta.hasEventLog = true;
  const window = opts.days ?? 30;
  const recent = files.slice(-window);
  const maxEvents = opts.maxEvents ?? 50_000;

  for (const file of recent) {
    const full = join(dir, file);
    try {
      // Skip anything implausibly large rather than reading it into memory.
      if ((await stat(full)).size > 64 * 1024 * 1024) continue;
      const events = parseEventLog(await readFile(full, "utf8"));
      state.meta.filesRead += 1;
      for (const event of events) {
        if (state.meta.eventsRead >= maxEvents) break;
        applyEvent(state, event);
      }
    } catch {
      // A file that vanished or is locked mid-read is skipped.
    }
  }

  // Newest first for display.
  state.activity.reverse();
  state.failures.errors.reverse();
  state.sessions.history.reverse();

  return state;
}

/**
 * Redact before display (E-12.c).
 *
 * Loom's hooks capture tool arguments in cleartext by design — that is Rule 22
 * working. It also means a secret that reached the log must not reach a browser.
 */
export function redactState(state: ObservatoryState): ObservatoryState {
  return redactUnknown(state).value as ObservatoryState;
}

/** Roll several projects into one view — the thing no per-project server could do. */
export interface CrossProjectSummary {
  projects: Array<{
    name: string;
    activeSessions: number;
    totalSessions: number;
    errors: number;
    estimatedUsd: number;
    lastActivityAt: string | null;
    hasEventLog: boolean;
  }>;
  totals: { activeSessions: number; errors: number; estimatedUsd: number };
}

export function summarize(states: readonly ObservatoryState[]): CrossProjectSummary {
  const projects = states.map((s) => ({
    name: s.project,
    activeSessions: s.sessions.active.length,
    totalSessions: s.sessions.active.length + s.sessions.history.length,
    errors: s.failures.errors.length,
    estimatedUsd: Math.round(s.cost.estimatedUsd * 1e6) / 1e6,
    lastActivityAt: s.meta.newestEventAt,
    hasEventLog: s.meta.hasEventLog,
  }));

  return {
    projects,
    totals: {
      activeSessions: projects.reduce((n, p) => n + p.activeSessions, 0),
      errors: projects.reduce((n, p) => n + p.errors, 0),
      estimatedUsd: Math.round(projects.reduce((n, p) => n + p.estimatedUsd, 0) * 1e6) / 1e6,
    },
  };
}
