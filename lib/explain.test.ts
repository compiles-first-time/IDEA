import test from "node:test";
import assert from "node:assert/strict";

import { explainEventType, explainRowType, explainRule } from "@/lib/explain";

test("an ADR id is expanded into what an ADR is", () => {
  const e = explainRule("ADR-0047");
  assert.equal(e.label, "ADR-0047");
  assert.match(e.meaning, /Architecture Decision Record 47/);
  assert.match(e.meaning, /revisited rather than re-argued/);
});

test("a known Loom rule explains what it actually governs", () => {
  assert.match(explainRule("LR-04").meaning, /which actions need a human to confirm/);
  assert.match(explainRule("LR-02").meaning, /constitution check/);
});

test("an uncatalogued rule in a known family still gets a useful answer", () => {
  // Echoing "LR-99" back at the reader teaches them nothing.
  const e = explainRule("LR-99");
  assert.equal(e.label, "LR-99");
  assert.match(e.meaning, /Loom Local Rule 99/);
});

test("kernel rules are recognised and explained", () => {
  assert.match(explainRule("Rule 20").meaning, /reversible actions may proceed/);
  assert.match(explainRule("Rule 22").meaning, /record of why/);
});

test("an unrecognised rule says so rather than pretending", () => {
  assert.match(explainRule("XYZ-1").meaning, /not one IDEA recognises/);
});

test("id spellings vary and are all handled", () => {
  assert.equal(explainRule("adr_47").label, "ADR-47");
  assert.equal(explainRule("lr-4").label, "LR-04");
});

/* ── Row types ───────────────────────────────────────────────────────────── */

test("SE and BE are explained as the different things they are", () => {
  assert.match(explainRowType("SE").meaning, /Worth retrying/);
  assert.match(explainRowType("BE").meaning, /Retrying just fails again/);
});

test("TR is explained as the thing no agent can clear", () => {
  assert.match(explainRowType("TR").meaning, /account, a credential, a paid tier, or a human step/);
});

/* ── Event types ─────────────────────────────────────────────────────────── */

test("snake_case event names become sentences", () => {
  assert.equal(explainEventType("session_start").label, "Session started");
  assert.match(explainEventType("skill_invoked").meaning, /written procedure/);
});

test("a missed constitution check is described as a guardrail being missed", () => {
  const e = explainEventType("constitution_check_missing");
  assert.match(e.meaning, /guardrail being missed, not a guardrail working/);
});

test("a claim explains why sources matter", () => {
  assert.match(explainEventType("claim").meaning, /no sources is worth a second look/);
});

test("the _attempted family is explained generically rather than echoed", () => {
  const e = explainEventType("browser_credential_automation_attempted");
  assert.doesNotMatch(e.label, /_/);
  assert.match(e.meaning, /permission rules cover/);
});

test("an unknown event type degrades to a readable label, not a crash", () => {
  const e = explainEventType("some_future_event");
  assert.equal(e.label, "some future event");
  assert.equal(e.meaning, "");
});
