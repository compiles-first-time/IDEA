import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  KNOWN_EVENT_TYPES,
  PERMISSION_EVENT_TYPES,
  applyEvent,
  parseEventLog,
  redactState,
  type LoomEvent,
  type ObservatoryState,
} from "@/lib/observatory";

/**
 * S-39 — the eleven event types Loom emits that were being dropped, and the rule
 * attribution that came with them.
 */

function fold(events: LoomEvent[]): ObservatoryState {
  // emptyState is internal; fold from a known-empty projection instead.
  const state = blank();
  for (const e of events) applyEvent(state, e);
  return state;
}

function blank(): ObservatoryState {
  return {
    project: "t",
    sessions: { active: [], history: [] },
    cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0, bySession: {} },
    failures: { errors: [], signatures: {} },
    compliance: { destructiveOps: [], constitutionChecksMissing: 0, byRule: {}, attempts: [] },
    claims: [],
    skills: {},
    agentEdges: [],
    turns: [],
    executionKinds: {},
    timeline: [],
    agents: { spawned: [], retired: [] },
    deploys: { history: [] },
    testing: { lastRun: null, passed: 0, failed: 0 },
    tickets: [],
    activity: [],
    unknownEventTypes: {},
    meta: { eventsRead: 0, filesRead: 0, newestEventAt: null, hasEventLog: true },
  };
}

/* -------------------------------------------------------------------------- */
/* The types are known now                                                     */
/* -------------------------------------------------------------------------- */

const RECOVERED = [
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
] as const;

test("every recovered type is known, so none lands in unknownEventTypes", () => {
  for (const type of RECOVERED) {
    assert.ok(KNOWN_EVENT_TYPES.includes(type), `${type} should be known`);
    const state = fold([{ event_type: type }]);
    assert.equal(
      state.unknownEventTypes[type],
      undefined,
      `${type} was still dropped into unknownEventTypes`,
    );
  }
});

test("a genuinely unknown type is still counted — drift must stay visible", () => {
  const state = fold([{ event_type: "some_future_event" }]);
  assert.equal(state.unknownEventTypes.some_future_event, 1);
});

/* -------------------------------------------------------------------------- */
/* Rule attribution — the point of the story                                   */
/* -------------------------------------------------------------------------- */

test("a permission event indexes under the rule that governed it", () => {
  const state = fold([
    {
      event_type: "destructive_action_decision",
      rule: "ADR-0047",
      decision: "confirm",
      command: "rm -rf build",
      timestamp: "2026-07-27T10:00:00Z",
    },
  ]);

  assert.equal(state.compliance.byRule["ADR-0047"].count, 1);
  assert.equal(state.compliance.byRule["ADR-0047"].decisions[0].decision, "confirm");
  assert.equal(state.compliance.attempts.length, 1);
  assert.equal(state.compliance.attempts[0].rule, "ADR-0047");
});

test("repeat citations of one rule accumulate under it", () => {
  const state = fold([
    { event_type: "destructive_actions_attempted", rule: "LR-04" },
    { event_type: "credentials_attempted", rule: "LR-04" },
    { event_type: "external_service_setup_attempted", rule: "LR-04" },
  ]);
  assert.equal(state.compliance.byRule["LR-04"].count, 3);
});

test("an attempt with NO rule is still recorded", () => {
  // An ungoverned action is the more alarming case, not the less. Dropping it
  // for lacking the field would hide exactly what matters.
  const state = fold([{ event_type: "production_mutation_attempted", detail: "wrote to prod" }]);
  assert.equal(state.compliance.attempts.length, 1);
  assert.equal(state.compliance.attempts[0].rule, null);
  assert.deepEqual(state.compliance.byRule, {});
});

test("constitution_check_missing still counts AND now carries its rule", () => {
  const state = fold([{ event_type: "constitution_check_missing", rule: "LR-02" }]);
  assert.equal(state.compliance.constitutionChecksMissing, 1);
  assert.equal(state.compliance.byRule["LR-02"].count, 1);
});

test("every permission type routes into the compliance ledger", () => {
  for (const type of PERMISSION_EVENT_TYPES) {
    const state = fold([{ event_type: type, rule: "LR-04" }]);
    assert.equal(state.compliance.attempts.length, 1, `${type} did not record an attempt`);
  }
});

/* -------------------------------------------------------------------------- */
/* Claims — the only place agent identity appears                              */
/* -------------------------------------------------------------------------- */

test("a claim records its agent, confidence, and source count", () => {
  const state = fold([
    {
      event_type: "claim",
      agent: "builder",
      claim: "the panel degrades gracefully",
      confidence: "medium",
      sources: ["a", "b"],
      what_would_raise_to_95: "a live run with the second model down",
    },
  ]);

  const c = state.claims[0];
  assert.equal(c.agent, "builder");
  assert.equal(c.confidence, "medium");
  assert.equal(c.sources, 2);
  assert.match(c.whatWouldRaise ?? "", /second model/);
});

test("a claim with no sources reports zero rather than guessing one", () => {
  const state = fold([{ event_type: "claim", agent: "builder", claim: "it works" }]);
  assert.equal(state.claims[0].sources, 0);
});

/* -------------------------------------------------------------------------- */
/* Bounds and redaction                                                        */
/* -------------------------------------------------------------------------- */

test("claims are bounded so a long project cannot grow the state without limit", () => {
  const state = fold(
    Array.from({ length: 150 }, (_, i) => ({ event_type: "claim", claim: `c${i}` })),
  );
  assert.ok(state.claims.length <= 100);
  // The newest survive — the oldest are the ones to drop.
  assert.equal(state.claims.at(-1)?.claim, "c149");
});

test("a secret in a permission command is redacted before display (E-12.c)", () => {
  const state = fold([
    {
      event_type: "destructive_action_decision",
      rule: "LR-04",
      command: "curl -H 'Authorization: Bearer ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'",
    },
  ]);
  assert.match(state.compliance.attempts[0].detail ?? "", /ghp_/, "raw projection keeps it");

  const safe = redactState(state);
  assert.doesNotMatch(
    JSON.stringify(safe.compliance),
    /ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/,
    "the token must not reach the browser",
  );
});

/* -------------------------------------------------------------------------- */
/* Against the real logs                                                       */
/* -------------------------------------------------------------------------- */

test("the real local Loom logs project with no unknown types", async (t) => {
  // The measurement that motivated S-39: 244 of 10,015 real events were being
  // dropped. If this regresses, drift has returned.
  const roots = ["sovereign-forge", "ravenwise", "ripple", "process-cartographer"];
  const state = blank();
  let read = 0;

  for (const name of roots) {
    const dir = join("C:", "Users", "14134", "dev", name, "memory", "event-log");
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue; // Not this machine — the assertions below simply do not run.
    }
    for (const f of files.filter((f) => f.endsWith(".jsonl"))) {
      for (const e of parseEventLog(await readFile(join(dir, f), "utf8"))) {
        applyEvent(state, e);
        read++;
      }
    }
  }

  if (read === 0) {
    t.skip("no local Loom event logs on this machine");
    return;
  }

  t.diagnostic(`${read} real events; rules seen: ${Object.keys(state.compliance.byRule).join(", ")}`);
  assert.deepEqual(
    state.unknownEventTypes,
    {},
    `still dropping: ${Object.keys(state.unknownEventTypes).join(", ")}`,
  );
  assert.ok(Object.keys(state.compliance.byRule).length > 0, "no rule attribution recovered");
});

/* -------------------------------------------------------------------------- */
/* Upstream provenance instrumentation (loom-template, 2026-07-28)             */
/* -------------------------------------------------------------------------- */

test("skill_invoked builds the agent → skill map", () => {
  const state = fold([
    { event_type: "skill_invoked", skill: "testcase", agent: "builder" },
    { event_type: "skill_invoked", skill: "testcase", agent: "critic" },
    { event_type: "skill_invoked", skill: "handoff", agent: "builder" },
  ]);
  assert.equal(state.skills.testcase.count, 2);
  assert.deepEqual(state.skills.testcase.agents, ["builder", "critic"]);
  assert.equal(state.skills.handoff.count, 1);
});

test("agent_invoked draws the parent → child edge", () => {
  const state = fold([
    { event_type: "agent_invoked", agent: "critic", parent_agent: "builder" },
  ]);
  assert.deepEqual(state.agentEdges[0].parent, "builder");
  assert.deepEqual(state.agentEdges[0].child, "critic");
  assert.ok(state.agents.spawned.includes("critic"), "the child is a known agent");
});

test("an edge with no parent attributes to main rather than vanishing", () => {
  const state = fold([{ event_type: "agent_invoked", agent: "auth" }]);
  assert.equal(state.agentEdges[0].parent, "main");
});

test("execution_kind is counted, and absent means unknown — never a guess", () => {
  const state = fold([
    { event_type: "tool_call", execution_kind: "deterministic" },
    { event_type: "tool_call", execution_kind: "deterministic" },
    { event_type: "tool_call", execution_kind: "model" },
    { event_type: "tool_call" }, // an older event, before the field existed
  ]);
  assert.equal(state.executionKinds.deterministic, 2);
  assert.equal(state.executionKinds.model, 1);
  assert.equal(state.executionKinds.unknown, 1);
});

test("turn_token_usage attributes cost to a node WITHOUT double-counting the session", () => {
  const state = fold([
    { event_type: "session_token_usage", session_id: "s1", input_tokens: 100, output_tokens: 50 },
    {
      event_type: "turn_token_usage",
      session_id: "s1",
      turn_index: 0,
      input_tokens: 60,
      output_tokens: 30,
      model: "claude-opus-5",
      tool_uses: [{ id: "t1", tool: "Bash" }, { id: "t2", tool: "Read" }],
    },
  ]);

  // The session total must not absorb the per-turn rows — they describe the
  // same tokens at a finer grain, so adding both would report double.
  assert.equal(state.cost.inputTokens, 100);
  assert.equal(state.cost.outputTokens, 50);

  assert.equal(state.turns.length, 1);
  assert.deepEqual(state.turns[0].tools, ["Bash", "Read"]);
  assert.equal(state.turns[0].model, "claude-opus-5");
});
