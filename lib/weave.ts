import { explainEventType, explainRule } from "@/lib/explain";
import type { LoomEvent } from "@/lib/observatory";

/**
 * Real Loom events → the weave's Rule-22 v2 schema (BR_05, spec §4.2 / §16).
 *
 * The weave dashboard (`vendor/loom-observatory.html`, spec
 * `docs/observatory/SPEC.md`) was designed against authored demo data in which
 * every event carries `intent`, `justification`, and a causal `trigger`. Real
 * logs record what happened, not why. This adapter maps what IS recorded and is
 * explicit about what is not:
 *
 * - `intent` / `just` come from recorded fields (`reason`, `rule`) where they
 *   exist, and say "(not recorded)" where they do not. **Nothing is invented** —
 *   a fabricated why, rendered in an Inspector whose whole job is why, would be
 *   the worst lie this product could tell (BR_05_BE-01).
 * - Causal parents are drawn only where the log supports them — a tool_result
 *   points at its tool_call, nothing more (deviation I4). Sparse honest arcs
 *   beat a dense fictional lattice.
 * - Cumulative token snapshots become per-event **deltas**; a snapshot that
 *   decreases contributes zero rather than a negative or a re-count
 *   (BR_05_BE-04 — the 30x over-count must not return here).
 *
 * Pure functions only. Reading files is the caller's job.
 */

/* ── Spec shapes (§4.2, §4.3) ─────────────────────────────────────────────── */

export interface WeaveTokens {
  in: number;
  out: number;
  cache: number;
}

export interface WeaveEvent {
  id: string;
  ts: string;
  from: string;
  to: string;
  cls: string;
  action: string;
  layer: string;
  target: string;
  intent: string;
  just: string;
  trigger: { rule: string | null; parent: string | null };
  tokens: WeaveTokens;
  dur: number;
  verdict: "pass" | "fail" | "blocked" | null;
  cap: string;
  model?: string;
  thought?: string;
}

export interface WeaveRun {
  id: string;
  title: string;
  started: string;
  state: "queued" | "ready" | "weaving" | "gate" | "complete" | "halted";
  specialist: string;
  events: WeaveEvent[];
  tails: null;
  cursor: number;
  decision: null;
  note: string | null;
}

export interface WeaveProject {
  id: string;
  name: string;
  stage: string;
  operator: string;
  session: string;
  lastUsed: string;
  desc: string;
  runs: WeaveRun[];
}

export interface GlossEntry {
  id: string;
  kind: string;
  title: string;
  src: string;
  body: string;
  related: string[];
}

/** Keep the weave renderable: an SVG row per event, so volume must be bounded. */
export const MAX_EVENTS_PER_RUN = 150;
export const MAX_RUNS_PER_PROJECT = 10;

/* ── Field helpers ────────────────────────────────────────────────────────── */

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const NOT_RECORDED = "(not recorded — Loom's hooks do not yet emit this field)";

/** `2026-07-18T20:33:21.123Z` → `20:33:21.123`, padded when ms are absent. */
function tsOf(event: LoomEvent): string {
  const iso = str(event.timestamp);
  if (!iso) return "00:00:00.000";
  const t = iso.slice(11, 23);
  return t.length >= 12 ? t : `${t.padEnd(8, "0")}.000`;
}

/** Loom base-agent names → the 17 fixed warp threads (spec §4.4). */
const AGENT_THREADS: Record<string, string> = {
  critic: "critic",
  "memory-keeper": "mem",
  mem: "mem",
  hr: "hr",
  "hr-agent": "hr",
  eac: "eac",
  "constitution-service": "cs",
  "constitution-svc": "cs",
  supervisor: "sup",
  "human-replica": "rep",
  builder: "smith",
};

function threadForAgent(name: string): string {
  return AGENT_THREADS[name.toLowerCase()] ?? "smith";
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ── One event ────────────────────────────────────────────────────────────── */

interface MapContext {
  runId: string;
  seq: number;
  /** Open tool_call ids by tool name, for honest result→call parenting. */
  openCalls: Map<string, string>;
  /** Previous cumulative token snapshot for this session. */
  prevTokens: { in: number; out: number };
}

/**
 * Map one real event. Returns null for types that have no visual meaning on the
 * weave (heartbeats and hints) — dropping them is a display choice, not data
 * loss, and the panels view still shows everything.
 */
export function mapEvent(event: LoomEvent, ctx: MapContext): WeaveEvent | null {
  const type = str(event.event_type);
  if (!type) return null;

  const id = `evt-${ctx.runId}-${String(ctx.seq).padStart(3, "0")}`;
  const rule = str(event.rule);
  const agent = str(event.agent) ?? str(event.specialist) ?? str(event.parent_agent);
  const explained = explainEventType(type);

  const base: WeaveEvent = {
    id,
    ts: tsOf(event),
    from: "sup",
    to: "script",
    cls: "tool",
    action: type.replace(/_/g, " "),
    layer: "L5",
    target: "—",
    intent: NOT_RECORDED,
    just: rule ? `Governed by ${rule}. ${NOT_RECORDED}` : NOT_RECORDED,
    trigger: { rule, parent: null },
    tokens: { in: 0, out: 0, cache: 0 },
    dur: 260,
    verdict: null,
    cap:
      (explained.meaning ? `${explained.meaning} ` : "") +
      "<b>Live event.</b> This narration is derived from the event type — Loom's hooks do not yet record authored intent.",
  };

  switch (type) {
    case "session_start":
      return {
        ...base,
        from: "nick",
        to: "sup",
        cls: "human",
        action: "session_start",
        target: str(event.cwd) ?? "session",
        intent: "A work session opened in this project.",
        verdict: "pass",
      };

    case "session_end":
      // The exact action string matters: the engine's halt/repair logic keys on
      // the `session_end` prefix (spec §4.7).
      return {
        ...base,
        from: "sup",
        to: "nick",
        cls: "human",
        action: "session_end · report",
        target: "session",
        intent: "The session ended.",
        verdict: "pass",
      };

    case "tool_call": {
      const tool = str(event.tool) ?? "tool";
      ctx.openCalls.set(tool, id);
      const kind = str(event.execution_kind);
      return {
        ...base,
        from: kind === "deterministic" ? "script" : "llm",
        to: "script",
        cls: "tool",
        action: `tool_call · ${tool}`,
        layer: "L4",
        target: truncate(str(event.tool_args_summary) ?? tool, 90),
      };
    }

    case "tool_result": {
      const tool = str(event.tool) ?? "tool";
      const exit = event.exit_code;
      const failed =
        (typeof exit === "number" && exit !== 0) || Boolean(str(event.error_signature));
      const parent = ctx.openCalls.get(tool) ?? null;
      ctx.openCalls.delete(tool);
      return {
        ...base,
        from: "script",
        to: "llm",
        cls: failed ? "fail" : "tool",
        action: `tool_result · ${tool}`,
        layer: "L4",
        target: truncate(str(event.error_preview) ?? tool, 90),
        trigger: { rule, parent },
        verdict: failed ? "fail" : "pass",
        intent: failed ? "The tool reported a failure." : base.intent,
      };
    }

    case "destructive_action_decision":
    case "destructive_actions_attempted":
    case "production_mutation_attempted":
    case "browser_credential_automation_attempted":
    case "external_service_setup_attempted":
    case "credentials_attempted": {
      const decision = str(event.decision) ?? str(event.outcome) ?? str(event.result);
      const halted = decision === "ask" || decision === "confirm" || decision === "refuse" || decision === "denied";
      return {
        ...base,
        from: "cs",
        to: "sup",
        cls: halted ? "block" : "gov",
        action: decision ? `${type.replace(/_/g, " ")} · ${decision.toUpperCase()}` : type.replace(/_/g, " "),
        layer: "L0",
        target: truncate(str(event.command) ?? str(event.tool) ?? str(event.detail) ?? "—", 90),
        intent: str(event.reason) ?? "The permission rules classified this action.",
        verdict: halted ? "blocked" : "pass",
      };
    }

    case "constitution_check_missing":
      // Red, not amber: a check that DID NOT RUN is the system failing to
      // engage, which the amber≠red doctrine (spec §1.4) puts on the red side.
      return {
        ...base,
        from: "sup",
        to: "cs",
        cls: "gov",
        action: "constitution_check · MISSING",
        layer: "L0",
        target: truncate(str(event.command) ?? str(event.tool) ?? "—", 90),
        intent: "A production mutation happened without the required check.",
        verdict: "fail",
      };

    case "claim": {
      const confidence = str(event.confidence);
      const sources = Array.isArray(event.sources) ? event.sources.length : 0;
      return {
        ...base,
        from: agent ? threadForAgent(agent) : "llm",
        to: "sup",
        cls: "ok",
        action: "claim",
        layer: "L3",
        target: "self-knowledge",
        intent: truncate(str(event.claim) ?? "An agent stated a belief.", 160),
        just: `Confidence: ${confidence ?? "unstated"} · sources: ${sources}. ${
          str(event.what_would_raise_to_95)
            ? `Would raise to 95%: ${str(event.what_would_raise_to_95)}`
            : NOT_RECORDED
        }`,
        verdict: "pass",
      };
    }

    case "skill_invoked":
      return {
        ...base,
        from: agent ? threadForAgent(agent) : "llm",
        to: "script",
        cls: "tool",
        action: `skill_invoked · /${str(event.skill) ?? "skill"}`,
        layer: "L4",
        target: `/${str(event.skill) ?? "skill"}`,
        verdict: "pass",
      };

    case "agent_invoked":
    case "specialist_spawned":
      // Unhides the specialist column via the engine's own side-effect path.
      return {
        ...base,
        from: "eac",
        to: "smith",
        cls: "ok",
        action: "specialist_spawned",
        layer: "L2",
        target: str(event.agent) ?? str((event.specialists as string[] | undefined)?.[0]) ?? "specialist",
        intent: "An agent was brought into this session.",
        verdict: "pass",
      };

    case "specialist_retired":
      return {
        ...base,
        from: "eac",
        to: "smith",
        cls: "ok",
        action: "specialist_retired",
        layer: "L2",
        target: str(event.specialist) ?? "specialist",
        verdict: "pass",
      };

    case "session_token_usage":
    case "turn_token_usage": {
      const cumulative = type === "session_token_usage";
      const rawIn = num(event.input_tokens);
      const rawOut = num(event.output_tokens);
      let dIn = rawIn;
      let dOut = rawOut;
      if (cumulative) {
        // Deltas against the previous snapshot; a decrease yields zero, never a
        // negative and never a resummed total (BR_05_BE-04).
        dIn = Math.max(0, rawIn - ctx.prevTokens.in);
        dOut = Math.max(0, rawOut - ctx.prevTokens.out);
        ctx.prevTokens.in = Math.max(ctx.prevTokens.in, rawIn);
        ctx.prevTokens.out = Math.max(ctx.prevTokens.out, rawOut);
      }
      return {
        ...base,
        from: "llm",
        to: "sup",
        cls: "llm",
        action: cumulative ? "llm_usage · session snapshot" : "llm_usage · turn",
        layer: "L6",
        target: str(event.model) ?? "usage",
        intent: cumulative
          ? "Cumulative token snapshot; shown as the delta since the last one."
          : "Tokens this turn consumed.",
        tokens: { in: dIn, out: dOut, cache: 0 },
        model: str(event.model) ?? undefined,
        verdict: "pass",
        dur: 400,
      };
    }

    case "test_run_summary":
      return {
        ...base,
        from: "script",
        to: "f_ws",
        cls: "tool",
        action: "test_run · summary",
        layer: "L4",
        target: `${num(event.passed)} passed · ${num(event.failed)} failed`,
        verdict: num(event.failed) > 0 ? "fail" : "pass",
      };

    case "ticket":
      return {
        ...base,
        from: "sup",
        to: "f_led",
        cls: "ledger",
        action: "ticket",
        layer: "L5",
        target: truncate(`${str(event.id) ?? ""} ${str(event.title) ?? ""}`.trim() || "ticket", 90),
        verdict: "pass",
      };

    case "runtime_discovery_run":
      return {
        ...base,
        from: "script",
        to: "f_ws",
        cls: "read",
        action: "runtime_discovery",
        layer: "L8",
        target: "tools/discovered-runtime.md",
        verdict: "pass",
      };

    case "lessons_autosuggest":
      return {
        ...base,
        from: "mem",
        to: "f_mem",
        cls: "mem",
        action: "lesson_autosuggest",
        layer: "L3",
        target: "lessons-learned/",
        verdict: "pass",
      };

    // Display-noise types: numerous, low signal on a weave. The panels view
    // still shows them; dropping here is bounded to exactly this list.
    case "test_case":
    case "test_result":
    case "subagent_suggestion":
    case "oauth_preference_hint":
    case "observatory_auto_started":
    case "auto_bootstrap_attempted":
    case "auto_bootstrap_result":
    case "bootstrapped_this_session":
    case "loop_cost_summary":
      return null;

    default:
      return { ...base, target: type, verdict: null };
  }
}

/* ── Sessions → runs ──────────────────────────────────────────────────────── */

const STALE_MS = 30 * 60 * 1000;

export function mapSessionToRun(
  sessionId: string,
  events: readonly LoomEvent[],
  index: number,
  now: Date,
): WeaveRun {
  const runId = `s${String(index + 1).padStart(2, "0")}`;
  const sorted = [...events].sort((a, b) =>
    String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")),
  );

  const total = sorted.length;
  const kept = sorted.slice(-MAX_EVENTS_PER_RUN);

  const ctx: MapContext = {
    runId,
    seq: 1,
    openCalls: new Map(),
    prevTokens: { in: 0, out: 0 },
  };

  const mapped: WeaveEvent[] = [];
  let specialist = "live agent";
  for (const raw of kept) {
    const ev = mapEvent(raw, ctx);
    if (!ev) continue;
    ev.id = `evt-${runId}-${String(ctx.seq).padStart(3, "0")}`;
    ctx.seq += 1;
    if (ev.action === "specialist_spawned" && ev.target !== "specialist") {
      specialist = ev.target;
    }
    mapped.push(ev);
  }

  // Parents must point at kept, earlier events (spec §4.8) — anything that
  // referenced a truncated event is silently rooted instead of dangling.
  const ids = new Set(mapped.map((e) => e.id));
  for (const ev of mapped) {
    if (ev.trigger.parent && !ids.has(ev.trigger.parent)) ev.trigger.parent = null;
  }

  const hasEnd = mapped.some((e) => e.action.startsWith("session_end"));
  const newest = str(sorted[sorted.length - 1]?.timestamp);
  const ageMs = newest ? now.getTime() - new Date(newest).getTime() : Infinity;
  const live = !hasEnd && ageMs < STALE_MS;

  const notes: string[] = [];
  if (total > kept.length) {
    notes.push(`showing the last ${mapped.length} of ${total} events`);
  }
  if (!hasEnd && !live) notes.push("no session_end recorded");

  return {
    id: runId,
    title: `live session ${sessionId.slice(0, 8)}`,
    started: tsOf(sorted[0] ?? {} as LoomEvent).slice(0, 5),
    state: live ? "weaving" : "complete",
    specialist,
    events: mapped,
    tails: null,
    cursor: mapped.length - 1,
    decision: null,
    note: notes.length ? notes.join(" · ") : null,
  };
}

/* ── A whole project ──────────────────────────────────────────────────────── */

export function mapProject(
  input: {
    name: string;
    title: string;
    operator: string;
    events: readonly LoomEvent[];
  },
  now: Date,
): WeaveProject {
  const bySession = new Map<string, LoomEvent[]>();
  for (const e of input.events) {
    const sid = str(e.session_id) ?? "unattributed";
    const list = bySession.get(sid) ?? [];
    list.push(e);
    bySession.set(sid, list);
  }

  // Newest session first — it is the one being asked about.
  const sessions = [...bySession.entries()].sort((a, b) => {
    const ta = String(a[1][a[1].length - 1]?.timestamp ?? "");
    const tb = String(b[1][b[1].length - 1]?.timestamp ?? "");
    return tb.localeCompare(ta);
  });

  const keptSessions = sessions.slice(0, MAX_RUNS_PER_PROJECT);
  const runs = keptSessions.map(([sid, evs], i) => mapSessionToRun(sid, evs, i, now));

  // openProject indexes RUNS[0]; a project with no runs must still open
  // (BR_05_SE-01), so an empty project gets one honest queued placeholder.
  if (runs.length === 0) {
    runs.push({
      id: "s01",
      title: "Awaiting the first recorded session",
      started: "—",
      state: "queued",
      specialist: "live agent",
      events: [],
      tails: null,
      cursor: -1,
      decision: null,
      note: "no events in memory/event-log yet",
    });
  }

  const newest = str(input.events[input.events.length - 1]?.timestamp);
  const activeRecently = newest
    ? now.getTime() - new Date(newest).getTime() < 7 * 24 * 3600 * 1000
    : false;

  const omitted = sessions.length - keptSessions.length;

  return {
    id: `live-${input.name}`,
    name: input.title || input.name,
    stage: activeRecently ? "development" : "maintenance",
    operator: input.operator,
    session: keptSessions[0]?.[0]?.slice(0, 12) ?? "—",
    lastUsed: newest ? `${newest.slice(0, 10)} ${newest.slice(11, 16)}` : "—",
    desc:
      `Live project — woven from memory/event-log, not scripted.` +
      (omitted > 0 ? ` ${omitted} older session${omitted === 1 ? "" : "s"} not shown.` : ""),
    runs,
  };
}

/* ── Glossary additions for real rules (BR_05_BE-03) ─────────────────────── */

export function glossaryFor(events: readonly LoomEvent[]): {
  entries: GlossEntry[];
  aliases: Record<string, string>;
} {
  const rules = new Set<string>();
  for (const e of events) {
    const r = str(e.rule);
    if (r) rules.add(r);
  }

  const entries: GlossEntry[] = [];
  const aliases: Record<string, string> = {};
  for (const id of rules) {
    const ex = explainRule(id);
    entries.push({
      id: ex.label,
      kind: /^ADR/i.test(id) ? "ADR" : "local rule",
      title: ex.label,
      src: /^ADR/i.test(id) ? "adr/" : "constitution/local-rules.md",
      body: ex.meaning,
      related: [],
    });
    aliases[id] = ex.label;
    aliases[ex.label] = ex.label;
  }
  return { entries, aliases };
}
