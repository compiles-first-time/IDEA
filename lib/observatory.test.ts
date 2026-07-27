import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EVENT_LOG_DIR,
  KNOWN_EVENT_TYPES,
  parseEventLog,
  projectState,
  redactState,
  summarize,
  type LoomEvent,
} from "@/lib/observatory";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

async function projectWithLog(events: LoomEvent[][]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "idea-obs-"));
  const logDir = join(dir, EVENT_LOG_DIR);
  await mkdir(logDir, { recursive: true });

  for (const [i, day] of events.entries()) {
    const date = `2026-07-${String(20 + i).padStart(2, "0")}`;
    await writeFile(join(logDir, `${date}.jsonl`), day.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return dir;
}

const SESSION = "sess-abcdef123456";

function baseDay(): LoomEvent[] {
  return [
    { event_type: "session_start", timestamp: "2026-07-20T10:00:00Z", session_id: SESSION, source: "cli" },
    { event_type: "tool_call", timestamp: "2026-07-20T10:00:05Z", session_id: SESSION, tool: "bash" },
    { event_type: "tool_call", timestamp: "2026-07-20T10:00:09Z", session_id: SESSION, tool: "read_file" },
    {
      event_type: "tool_result",
      timestamp: "2026-07-20T10:00:10Z",
      session_id: SESSION,
      tool: "bash",
      exit_code: 1,
      error_signature: "ENOENT",
      error_preview: "no such file",
    },
    {
      event_type: "session_token_usage",
      timestamp: "2026-07-20T10:05:00Z",
      session_id: SESSION,
      input_tokens: 1000,
      output_tokens: 500,
      estimated_usd: 0.02,
    },
  ] as LoomEvent[];
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

test("parses JSONL and tolerates a partially-written last line", () => {
  const raw = `{"event_type":"session_start"}\n{"event_type":"tool_call"}\n{"event_type":"tru`;
  const events = parseEventLog(raw);
  assert.equal(events.length, 2, "a live session's trailing partial line is normal");
});

test("a record without event_type is skipped rather than crashing", () => {
  assert.deepEqual(parseEventLog(`{"foo":1}\n`), []);
});

test("blank lines are ignored", () => {
  assert.equal(parseEventLog("\n\n").length, 0);
});

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

test("folds a session's events into state", async (t) => {
  const dir = await projectWithLog([baseDay()]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");

  assert.equal(state.project, "demo");
  assert.equal(state.sessions.active.length, 1, "an unended session is still active");
  assert.equal(state.sessions.active[0].toolCalls, 2);
  assert.equal(state.sessions.active[0].errors, 1);
  assert.equal(state.sessions.active[0].lastTool, "read_file");
  assert.equal(state.cost.estimatedUsd, 0.02);
  assert.equal(state.cost.inputTokens, 1000);
  assert.equal(state.failures.errors.length, 1);
  assert.equal(state.failures.signatures.ENOENT, 1);
});

test("a repeated error signature is counted — Rule 10 territory", async (t) => {
  const day = baseDay();
  day.push({ ...day[3], timestamp: "2026-07-20T11:00:00Z" } as LoomEvent);
  const dir = await projectWithLog([day]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.equal(state.failures.signatures.ENOENT, 2, "a repeat is no longer innocent ignorance");
});

test("session_end moves a session to history with its counts", async (t) => {
  const day = baseDay();
  day.push({
    event_type: "session_end",
    timestamp: "2026-07-20T11:00:00Z",
    session_id: SESSION,
    ended_at: "2026-07-20T11:00:00Z",
  } as LoomEvent);
  const dir = await projectWithLog([day]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.equal(state.sessions.active.length, 0);
  assert.equal(state.sessions.history.length, 1);
  assert.equal(state.sessions.history[0].toolCalls, 2, "counts carry over from the live session");
  assert.equal(state.sessions.history[0].active, false);
});

test("destructive operations and missing constitution checks surface", async (t) => {
  const dir = await projectWithLog([
    [
      { event_type: "destructive_op", timestamp: "2026-07-20T10:00:00Z", command: "rm -rf dist" },
      { event_type: "constitution_check_missing", timestamp: "2026-07-20T10:00:01Z" },
    ] as LoomEvent[],
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.equal(state.compliance.destructiveOps.length, 1);
  assert.equal(state.compliance.destructiveOps[0].detail, "rm -rf dist");
  assert.equal(state.compliance.constitutionChecksMissing, 1);
});

test("specialists, deploys, tests and tickets project", async (t) => {
  const dir = await projectWithLog([
    [
      { event_type: "specialist_spawned", timestamp: "2026-07-20T10:00:00Z", specialist: "auth" },
      { event_type: "deployment_non_progressing", timestamp: "2026-07-20T10:01:00Z", target: "prod" },
      { event_type: "test_run_summary", timestamp: "2026-07-20T10:02:00Z", passed: 12, failed: 2 },
      { event_type: "ticket", timestamp: "2026-07-20T10:03:00Z", id: "T-1", state: "open", title: "Fix it" },
    ] as LoomEvent[],
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.deepEqual(state.agents.spawned, ["auth"]);
  assert.equal(state.deploys.history[0].status, "non_progressing");
  assert.equal(state.testing.passed, 12);
  assert.equal(state.testing.failed, 2);
  assert.deepEqual(state.tickets, [{ id: "T-1", state: "open", title: "Fix it" }]);
});

test("a ticket update replaces rather than duplicates", async (t) => {
  const dir = await projectWithLog([
    [
      { event_type: "ticket", id: "T-1", state: "open", title: "Fix it" },
      { event_type: "ticket", id: "T-1", state: "done", title: "Fix it" },
    ] as LoomEvent[],
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.equal(state.tickets.length, 1);
  assert.equal(state.tickets[0].state, "done");
});

test("events across several days all fold in", async (t) => {
  const dir = await projectWithLog([baseDay(), baseDay(), baseDay()]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.equal(state.meta.filesRead, 3);
  assert.equal(state.cost.estimatedUsd, 0.06);
});

/* -------------------------------------------------------------------------- */
/* Drift is visible (FR-12.5)                                                  */
/* -------------------------------------------------------------------------- */

test("unknown event types are counted, never silently dropped", async (t) => {
  const dir = await projectWithLog([
    [
      { event_type: "session_start", session_id: SESSION },
      { event_type: "quantum_entanglement_achieved" },
      { event_type: "quantum_entanglement_achieved" },
    ] as LoomEvent[],
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.equal(state.unknownEventTypes.quantum_entanglement_achieved, 2);
  assert.equal(state.meta.eventsRead, 3, "unknown events still count as read");
});

test("every event type Loom's aggregator handles is known here", () => {
  // Kept in sync deliberately — the schema is the contract, not the code.
  assert.ok(KNOWN_EVENT_TYPES.includes("session_start"));
  assert.ok(KNOWN_EVENT_TYPES.includes("loop_cost_summary"));
  assert.ok(KNOWN_EVENT_TYPES.includes("deliberation"));
  assert.equal(new Set(KNOWN_EVENT_TYPES).size, KNOWN_EVENT_TYPES.length, "no duplicates");
});

/* -------------------------------------------------------------------------- */
/* Absent or broken logs                                                       */
/* -------------------------------------------------------------------------- */

test("a project with no event log yields an empty state, not an error", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "idea-obs-empty-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "fresh");
  assert.equal(state.meta.hasEventLog, false);
  assert.equal(state.meta.eventsRead, 0);
  assert.deepEqual(state.sessions.active, []);
});

test("a corrupt log line does not lose the rest of the file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "idea-obs-bad-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, EVENT_LOG_DIR), { recursive: true });
  await writeFile(
    join(dir, EVENT_LOG_DIR, "2026-07-20.jsonl"),
    `{"event_type":"session_start","session_id":"a"}\n{{{ not json\n{"event_type":"session_start","session_id":"b"}\n`,
  );

  const state = await projectState(dir, "demo");
  assert.equal(state.sessions.active.length, 2);
});

test("reading is bounded so a huge log cannot hang the page", async (t) => {
  const day = Array.from({ length: 500 }, (_, i) => ({
    event_type: "tool_call",
    session_id: SESSION,
    timestamp: `2026-07-20T10:00:${String(i % 60).padStart(2, "0")}Z`,
  })) as LoomEvent[];
  const dir = await projectWithLog([day]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo", { maxEvents: 100 });
  assert.ok(state.meta.eventsRead <= 101, `read ${state.meta.eventsRead}, expected the cap to hold`);
});

/* -------------------------------------------------------------------------- */
/* Redaction before display (E-12.c)                                           */
/* -------------------------------------------------------------------------- */

test("a secret in the event log never reaches the browser", async (t) => {
  const token = "ghp_" + "k".repeat(36);
  const dir = await projectWithLog([
    [
      {
        event_type: "destructive_op",
        timestamp: "2026-07-20T10:00:00Z",
        command: `curl -H "Authorization: ${token}" https://x`,
      },
    ] as LoomEvent[],
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.ok(JSON.stringify(state).includes(token), "the raw projection does contain it");

  const safe = redactState(state);
  assert.equal(
    JSON.stringify(safe).includes(token),
    false,
    "Rule 22 logs tool args in cleartext by design; the browser must not see them",
  );
});

/* -------------------------------------------------------------------------- */
/* Across projects (FR-12.3)                                                   */
/* -------------------------------------------------------------------------- */

test("summarize rolls up across projects — impossible from one project's server", async (t) => {
  const a = await projectWithLog([baseDay()]);
  const b = await projectWithLog([baseDay(), baseDay()]);
  t.after(() => rm(a, { recursive: true, force: true }));
  t.after(() => rm(b, { recursive: true, force: true }));

  const summary = summarize([await projectState(a, "alpha"), await projectState(b, "beta")]);

  assert.deepEqual(
    summary.projects.map((p) => p.name),
    ["alpha", "beta"],
  );
  assert.equal(summary.totals.activeSessions, 2);
  assert.equal(summary.totals.errors, 3, "1 from alpha, 2 from beta");
  assert.equal(summary.totals.estimatedUsd, 0.06);
});

test("a project with no activity still appears in the roll-up", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "idea-obs-quiet-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const summary = summarize([await projectState(dir, "quiet")]);
  assert.equal(summary.projects[0].hasEventLog, false);
  assert.equal(summary.projects[0].totalSessions, 0);
});

/* -------------------------------------------------------------------------- */
/* Data, never code (E-12.a)                                                   */
/* -------------------------------------------------------------------------- */

test("the projection never imports or executes project code", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./observatory.ts", import.meta.url), "utf8"),
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const banned of ["import(", "require(", "createRequire", "vm.", "eval("]) {
    assert.equal(
      code.includes(banned),
      false,
      `observatory.ts must not use ${banned} — importing a cloned repo's aggregator would execute repo content`,
    );
  }
});

test("a duplicate session_start does not create a second session", async (t) => {
  const dir = await projectWithLog([
    [
      { event_type: "session_start", session_id: "dup", timestamp: "2026-07-20T10:00:00Z" },
      { event_type: "session_start", session_id: "dup", timestamp: "2026-07-20T10:00:00Z" },
    ] as LoomEvent[],
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const state = await projectState(dir, "demo");
  assert.equal(state.sessions.active.length, 1, "logs can be re-read; that must be idempotent");
});
