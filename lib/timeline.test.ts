import test from "node:test";
import assert from "node:assert/strict";

import { groupIntoSessions, toTimelineEvent } from "@/lib/timeline";

const row = (e: Record<string, unknown>) => toTimelineEvent(e as never)!;

/* ── WHO ─────────────────────────────────────────────────────────────────── */

test("a named agent is credited by name", () => {
  const e = row({ event_type: "claim", agent: "critic", claim: "it holds" });
  assert.equal(e.actor, "agent");
  assert.equal(e.actorName, "critic");
});

test("execution_kind decides model vs code for a tool call", () => {
  assert.equal(row({ event_type: "tool_call", execution_kind: "model" }).actor, "model");
  assert.equal(row({ event_type: "tool_call", execution_kind: "deterministic" }).actor, "script");
});

test("an unmarked tool call says unknown rather than guessing", () => {
  // Historical events predate execution_kind. A confident wrong attribution is
  // worse than an honest gap.
  const e = row({ event_type: "tool_call", tool: "Bash" });
  assert.equal(e.actor, "unknown");
  assert.equal(e.execution, "unknown");
});

test("session lifecycle is the system, not an agent", () => {
  assert.equal(row({ event_type: "session_start" }).actor, "system");
});

/* ── WHAT / WHERE / WHY ──────────────────────────────────────────────────── */

test("a tool call says what it called and where", () => {
  const e = row({ event_type: "tool_call", tool: "Bash", command: "npm test" });
  assert.match(e.what, /called Bash/);
  assert.equal(e.where, "Bash");
});

test("the governing rule is carried through", () => {
  const e = row({
    event_type: "destructive_action_decision",
    rule: "ADR-0047",
    decision: "ask",
    command: "rm -rf build",
  });
  assert.equal(e.rule, "ADR-0047");
  assert.match(e.what, /ask/);
  assert.match(e.why ?? "", /ask/);
});

test("why falls back through reason, decision, rule — and stays null when absent", () => {
  assert.match(row({ event_type: "tool_call", reason: "because" }).why ?? "", /because/);
  assert.match(row({ event_type: "tool_call", rule: "LR-04" }).why ?? "", /LR-04/);
  assert.equal(row({ event_type: "tool_call", tool: "Read" }).why, null);
});

/* ── Attention: red is earned, not decorative ────────────────────────────── */

test("a missing constitution check is a violation", () => {
  const e = row({ event_type: "constitution_check_missing", rule: "LR-02" });
  assert.equal(e.kind, "violation");
  assert.equal(e.failed, true);
});

test("a governed attempt that was ruled on is governance, not violation", () => {
  // The guardrail working is not an alarm. If every governed action were red,
  // red would stop meaning anything.
  const e = row({ event_type: "destructive_action_decision", rule: "ADR-0047", decision: "ask" });
  assert.equal(e.kind, "governance");
  assert.equal(e.failed, false);
});

test("a non-zero exit marks the row failed", () => {
  assert.equal(row({ event_type: "tool_result", tool: "Bash", exit_code: 1 }).failed, true);
  assert.equal(row({ event_type: "tool_result", tool: "Bash", exit_code: 0 }).failed, false);
});

test("an error signature marks failure even without an exit code", () => {
  assert.equal(row({ event_type: "tool_result", error_signature: "ENOENT" }).failed, true);
});

/* ── Tokens: null is not zero ────────────────────────────────────────────── */

test("an event with no token fields reports null, never 0", () => {
  const e = row({ event_type: "tool_call", tool: "Read" });
  assert.equal(e.inputTokens, null);
  assert.equal(e.outputTokens, null);
});

test("token counts are carried when present", () => {
  const e = row({ event_type: "session_token_usage", input_tokens: 120, output_tokens: 40 });
  assert.equal(e.inputTokens, 120);
  assert.equal(e.outputTokens, 40);
});

/* ── Sessions ────────────────────────────────────────────────────────────── */

test("events group by session, newest session first", () => {
  const events = [
    row({ event_type: "session_start", session_id: "a", timestamp: "2026-07-01T10:00:00Z" }),
    row({ event_type: "session_start", session_id: "b", timestamp: "2026-07-02T10:00:00Z" }),
    row({ event_type: "tool_call", session_id: "a", tool: "Read", timestamp: "2026-07-01T10:01:00Z" }),
  ];
  const sessions = groupIntoSessions(events);
  assert.equal(sessions[0].sessionId, "b", "the session you care about is the last one");
  assert.equal(sessions[1].events.length, 2);
});

test("a session with no measured tokens totals null, not zero", () => {
  const sessions = groupIntoSessions([
    row({ event_type: "tool_call", session_id: "a", tool: "Read" }),
  ]);
  assert.equal(sessions[0].inputTokens, null, "0 would read as a free session");
});

test("measured tokens accumulate across a session", () => {
  const sessions = groupIntoSessions([
    row({ event_type: "session_token_usage", session_id: "a", input_tokens: 10, output_tokens: 5 }),
    row({ event_type: "session_token_usage", session_id: "a", input_tokens: 7, output_tokens: 3 }),
  ]);
  assert.equal(sessions[0].inputTokens, 17);
  assert.equal(sessions[0].outputTokens, 8);
});

test("violations and failures are counted per session", () => {
  const sessions = groupIntoSessions([
    row({ event_type: "constitution_check_missing", session_id: "a" }),
    row({ event_type: "tool_result", session_id: "a", exit_code: 1 }),
    row({ event_type: "tool_result", session_id: "a", exit_code: 0 }),
  ]);
  assert.equal(sessions[0].violations, 1);
  assert.equal(sessions[0].failures, 2, "a violation is also a failure");
});

test("events with no session id are grouped rather than dropped", () => {
  const sessions = groupIntoSessions([row({ event_type: "ticket" })]);
  assert.equal(sessions[0].sessionId, "unattributed");
});

test("an event with no type yields no row", () => {
  assert.equal(toTimelineEvent({ timestamp: "x" } as never), null);
});
