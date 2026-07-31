import test from "node:test";
import assert from "node:assert/strict";

import { normalizeStatus, parentOf, parseRegisterFile, rollUp } from "@/lib/register";

/** A table in the exact shape Loom's real registers use. */
const REAL = `# BR_06 — Passive agent-reputation projection

| ID | Type | Framework Location | Usecase | Expected Input | Expected Output | Actual Input | Actual Output | Justification | Status |
|---|---|---|---|---|---|---|---|---|---|
| BR_06 | BR | Observatory projection | Transparent per-agent reputation | events | score per agent | — | — | Panel dependency | ✅ pass |
| BR-06_Compute | --- | observatory/lib/reputation.mjs | Pure computeReputation | event array | {agents} | — | — | Deterministic | ✅ pass |
| BR-06_TR-01 | TR | event-log | Agent-scoped signals exist | event stream | track record | — | — | A projection needs a substrate | ✅ pass |
| BR-06_SE-01 | SE | observatory/lib/reputation.mjs | Malformed event | no agent | skipped, no throw | — | — | Dirty logs must not crash | ✅ pass |
| BR-06_BE-01 | BE | observatory/lib/reputation.mjs | Used for dispatch | assert exports | exports match | — | — | Rule 2 | pending |
`;

test("a real register parses into one requirement with its subtasks", () => {
  const { requirements, errors } = parseRegisterFile("BR_06.md", REAL);
  assert.deepEqual(errors, []);
  assert.equal(requirements.length, 1);

  const r = requirements[0];
  assert.equal(r.id, "BR_06");
  assert.equal(r.row?.type, "BR");
  assert.equal(r.solutions.length, 1);
  assert.equal(r.technical.length, 1);
  assert.equal(r.exceptions.length, 2, "SE and BE are both exceptions");
});

test("the title comes from the heading, after the dash", () => {
  assert.equal(parseRegisterFile("BR_06.md", REAL).requirements[0].title, "Passive agent-reputation projection");
});

test("ids link to their BR whether written BR_06 or BR-06_", () => {
  // Real registers mix both spellings in one file; a parser that picked one
  // would orphan half the subtasks.
  assert.equal(parentOf("BR_06"), "BR_06");
  assert.equal(parentOf("BR-06_SE-01"), "BR_06");
  assert.equal(parentOf("BR-6_SE-01"), "BR_06", "single digits normalise");
});

test("the Justification column is captured — it is the one people skip", () => {
  const r = parseRegisterFile("BR_06.md", REAL).requirements[0];
  assert.equal(r.technical[0].justification, "A projection needs a substrate");
});

/* ── Status honesty ──────────────────────────────────────────────────────── */

test("decorated statuses are read", () => {
  assert.equal(normalizeStatus("✅ pass"), "pass");
  assert.equal(normalizeStatus("❌ fail"), "fail");
  assert.equal(normalizeStatus("blocked"), "blocked");
});

test("an unreadable status is pending, never pass", () => {
  // A row whose state cannot be read has not been shown to work. Defaulting to
  // pass would turn an unparseable board green.
  assert.equal(normalizeStatus("who knows"), "pending");
  assert.equal(normalizeStatus(""), "pending");
  assert.equal(normalizeStatus(undefined), "pending");
});

test("a requirement rolls up to its worst row", () => {
  assert.equal(rollUp(["pass", "pass", "fail"]), "fail");
  assert.equal(rollUp(["pass", "blocked"]), "blocked");
  assert.equal(rollUp(["pass", "pending"]), "pending");
  assert.equal(rollUp(["pass", "pass"]), "pass");
});

test("one pending subtask stops a requirement counting as verified", () => {
  const r = parseRegisterFile("BR_06.md", REAL).requirements[0];
  assert.equal(r.status, "pending", "four passing rows and one pending is not done");
});

/* ── Malformed input is visible ──────────────────────────────────────────── */

test("an unknown Type is reported rather than skipped", () => {
  const bad = REAL.replace("| BR-06_SE-01 | SE |", "| BR-06_SE-01 | WHAT |");
  const { errors } = parseRegisterFile("BR_06.md", bad);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /unknown Type/);
  assert.match(errors[0].message, /BR-06_SE-01/);
});

test("a file with no table is reported, not silently empty", () => {
  const { errors, requirements } = parseRegisterFile("notes.md", "# Just prose\n\nnothing here.");
  assert.deepEqual(requirements, []);
  assert.match(errors[0].message, /no ADR-0022 register table/);
});

test("columns are found by name, so a reordered table still parses", () => {
  const reordered = `# BR_09 — Reordered

| Type | ID | Status | Usecase | Justification |
|---|---|---|---|---|
| BR | BR_09 | pass | Something | Because |
`;
  const r = parseRegisterFile("BR_09.md", reordered).requirements[0];
  assert.equal(r.id, "BR_09");
  assert.equal(r.status, "pass");
  assert.equal(r.row?.justification, "Because");
});

test("em-dash placeholders become null rather than the literal dash", () => {
  const r = parseRegisterFile("BR_06.md", REAL).requirements[0];
  assert.equal(r.row?.actualInput, null);
});
