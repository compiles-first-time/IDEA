import test from "node:test";
import assert from "node:assert/strict";

import type { LoomEvent } from "@/lib/observatory";
import {
  MAX_EVENTS_PER_RUN,
  glossaryFor,
  mapProject,
  mapSessionToRun,
} from "@/lib/weave";

const NOW = new Date("2026-07-31T12:00:00Z");

const ev = (o: Record<string, unknown>): LoomEvent => o as never;

function session(n: number, sid = "abc12345-0000"): LoomEvent[] {
  const out: LoomEvent[] = [
    ev({ event_type: "session_start", session_id: sid, timestamp: "2026-07-30T10:00:00.000Z", cwd: "/p" }),
  ];
  for (let i = 0; i < n; i++) {
    out.push(
      ev({
        event_type: "tool_call",
        session_id: sid,
        timestamp: `2026-07-30T10:00:${String(Math.min(59, i + 1)).padStart(2, "0")}.000Z`,
        tool: "Bash",
        tool_args_summary: `cmd ${i}`,
      }),
    );
  }
  out.push(ev({ event_type: "session_end", session_id: sid, timestamp: "2026-07-30T11:00:00.000Z" }));
  return out;
}

/* ── Spec §4.2 mandatory fields, honestly filled ─────────────────────────── */

test("every mapped event carries the mandatory fields, non-empty", () => {
  const run = mapSessionToRun("abc12345", session(5), 0, NOW);
  for (const e of run.events) {
    for (const field of ["id", "ts", "from", "to", "cls", "action", "layer", "target", "intent", "just", "cap"] as const) {
      assert.ok(String(e[field]).length > 0, `${e.id} has empty ${field}`);
    }
    assert.ok(e.trigger, `${e.id} missing trigger`);
  }
});

test("what the log does not record says so — it is never invented (BR_05_BE-01)", () => {
  const run = mapSessionToRun("abc12345", session(2), 0, NOW);
  const call = run.events.find((e) => e.action.startsWith("tool_call"))!;
  assert.match(call.intent, /not recorded/);
  assert.match(call.cap, /not yet record authored intent/);
});

test("ids are sequential and unique; parents point earlier (spec §4.8)", () => {
  const events = [
    ...session(3),
    ev({ event_type: "tool_result", session_id: "abc12345-0000", timestamp: "2026-07-30T10:30:00.000Z", tool: "Bash", exit_code: 0 }),
  ];
  const run = mapSessionToRun("abc12345", events, 0, NOW);
  const ids = run.events.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of run.events) {
    if (!e.trigger.parent) continue;
    assert.ok(ids.indexOf(e.trigger.parent) < ids.indexOf(e.id), "parent must be earlier");
  }
});

test("a tool_result parents to its tool_call — and nothing else does (I4)", () => {
  const events = [
    ...session(1),
    ev({ event_type: "tool_result", session_id: "abc12345-0000", timestamp: "2026-07-30T10:30:00.000Z", tool: "Bash", exit_code: 1, error_signature: "E" }),
  ];
  const run = mapSessionToRun("abc12345", events, 0, NOW);
  const result = run.events.find((e) => e.action.startsWith("tool_result"))!;
  const call = run.events.find((e) => e.action.startsWith("tool_call"))!;
  assert.equal(result.trigger.parent, call.id);
  assert.equal(result.verdict, "fail");
  assert.equal(call.trigger.parent, null, "calls are not given fictional parents");
});

/* ── Amber ≠ red (spec §1.4) ─────────────────────────────────────────────── */

test("a governance ruling that halted is amber-blocked, not red", () => {
  const run = mapSessionToRun(
    "abc12345",
    [
      ...session(1),
      ev({
        event_type: "destructive_action_decision",
        session_id: "abc12345-0000",
        timestamp: "2026-07-30T10:40:00.000Z",
        rule: "ADR-0047",
        decision: "ask",
        command: "rm -rf build",
      }),
    ],
    0,
    NOW,
  );
  const gate = run.events.find((e) => e.cls === "block")!;
  assert.equal(gate.verdict, "blocked");
  assert.equal(gate.trigger.rule, "ADR-0047");
});

test("a MISSING constitution check is red — the system failing to engage", () => {
  const run = mapSessionToRun(
    "abc12345",
    [...session(1), ev({ event_type: "constitution_check_missing", session_id: "abc12345-0000", timestamp: "2026-07-30T10:41:00.000Z" })],
    0,
    NOW,
  );
  const miss = run.events.find((e) => e.action.includes("MISSING"))!;
  assert.equal(miss.verdict, "fail");
});

/* ── Token honesty (BR_05_BE-04) ─────────────────────────────────────────── */

test("cumulative snapshots become deltas, never re-counts", () => {
  const sid = "abc12345-0000";
  const mk = (t: string, tin: number) =>
    ev({ event_type: "session_token_usage", session_id: sid, timestamp: t, input_tokens: tin, output_tokens: 0, model: "claude-opus-5" });
  const run = mapSessionToRun(
    "abc12345",
    [...session(0), mk("2026-07-30T10:10:00.000Z", 100), mk("2026-07-30T10:20:00.000Z", 350), mk("2026-07-30T10:30:00.000Z", 400)],
    0,
    NOW,
  );
  const usage = run.events.filter((e) => e.action.includes("snapshot"));
  assert.deepEqual(
    usage.map((e) => e.tokens.in),
    [100, 250, 50],
    "the sum of deltas equals the final snapshot, not 850",
  );
});

test("a decreasing snapshot contributes zero, never a negative", () => {
  const sid = "abc12345-0000";
  const mk = (t: string, tin: number) =>
    ev({ event_type: "session_token_usage", session_id: sid, timestamp: t, input_tokens: tin, output_tokens: 0 });
  const run = mapSessionToRun("abc12345", [...session(0), mk("2026-07-30T10:10:00.000Z", 500), mk("2026-07-30T10:20:00.000Z", 200)], 0, NOW);
  const usage = run.events.filter((e) => e.action.includes("snapshot"));
  assert.deepEqual(usage.map((e) => e.tokens.in), [500, 0]);
});

/* ── Volume (BR_05_BE-02) ────────────────────────────────────────────────── */

test("an oversized session keeps the newest events and says how many were cut", () => {
  const run = mapSessionToRun("abc12345", session(400), 0, NOW);
  assert.ok(run.events.length <= MAX_EVENTS_PER_RUN);
  assert.match(run.note ?? "", /showing the last \d+ of 402 events/);
  // The newest survive: session_end is among the kept.
  assert.ok(run.events.some((e) => e.action.startsWith("session_end")));
});

test("truncation cannot leave a dangling parent", () => {
  const sid = "abc12345-0000";
  const events = [
    ...session(300), // the call at the start will be truncated away
    ev({ event_type: "tool_result", session_id: sid, timestamp: "2026-07-30T12:00:00.000Z", tool: "Zed", exit_code: 0 }),
  ];
  const run = mapSessionToRun("abc12345", events, 0, NOW);
  const ids = new Set(run.events.map((e) => e.id));
  for (const e of run.events) {
    if (e.trigger.parent) assert.ok(ids.has(e.trigger.parent));
  }
});

/* ── Run + project shape ─────────────────────────────────────────────────── */

test("an ended session is complete; a fresh one is weaving", () => {
  const done = mapSessionToRun("abc12345", session(2), 0, NOW);
  assert.equal(done.state, "complete");

  const fresh = mapSessionToRun(
    "def67890",
    [ev({ event_type: "session_start", session_id: "def", timestamp: "2026-07-31T11:55:00.000Z" }),
     ev({ event_type: "tool_call", session_id: "def", timestamp: "2026-07-31T11:56:00.000Z", tool: "Read" })],
    0,
    NOW,
  );
  assert.equal(fresh.state, "weaving", "recent activity with no end is live");
});

test("cursor sits on the last event, so the fabric is readable on open", () => {
  const run = mapSessionToRun("abc12345", session(3), 0, NOW);
  assert.equal(run.cursor, run.events.length - 1);
});

test("a project with no events still opens — one queued placeholder run (SE-01)", () => {
  const p = mapProject({ name: "empty", title: "Empty", operator: "nick", events: [] }, NOW);
  assert.equal(p.runs.length, 1);
  assert.equal(p.runs[0].state, "queued");
  assert.equal(p.runs[0].cursor, -1);
});

test("a project maps newest session first and is labelled live, not scripted", () => {
  const a = session(2, "aaaa1111-0000");
  const b = session(2, "bbbb2222-0000").map((e) =>
    ev({ ...e, timestamp: String(e.timestamp).replace("2026-07-30", "2026-07-31") }),
  );
  const p = mapProject({ name: "x", title: "X", operator: "nick", events: [...a, ...b] }, NOW);
  assert.match(p.runs[0].title, /bbbb2222/);
  assert.match(p.desc, /not scripted/);
  assert.equal(p.id, "live-x");
});

/* ── Glossary (BR_05_BE-03) ──────────────────────────────────────────────── */

test("rules seen in the log get glossary entries with real explanations", () => {
  const { entries, aliases } = glossaryFor([
    ev({ event_type: "destructive_action_decision", rule: "LR-04" }),
    ev({ event_type: "destructive_action_decision", rule: "ADR-0047" }),
  ]);
  const lr = entries.find((e) => e.id === "LR-04")!;
  assert.match(lr.body, /permissions protocol/);
  const adr = entries.find((e) => e.id === "ADR-0047")!;
  assert.match(adr.body, /Architecture Decision Record 47/);
  assert.equal(aliases["LR-04"], "LR-04");
});
