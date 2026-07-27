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
  };
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
    compliance: { destructiveOps: [], constitutionChecksMissing: 0 },
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
      note(state, "compliance", "production mutation without a constitution check", at);
      break;

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
