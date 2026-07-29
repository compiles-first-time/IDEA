import test from "node:test";
import assert from "node:assert/strict";

import { describeDecision, reconcileSelection, turnBody } from "@/lib/chat-routing";

const MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku" },
  { id: "claude-sonnet-5", label: "Sonnet" },
  { id: "claude-opus-5", label: "Opus" },
];

/* ── BR_01: the turn carries the user's mode ─────────────────────────────── */

test("BR_01 — manual mode sends the chosen model", () => {
  const body = turnBody({ mode: "manual", modelId: "claude-opus-5", models: MODELS });
  assert.deepEqual(body, { mode: "manual", model: "claude-opus-5" });
});

test("BR_01 — auto mode omits the model rather than sending an ignored one", () => {
  // Sending a model the router is about to override implies the choice mattered.
  const body = turnBody({ mode: "auto", modelId: "claude-opus-5", models: MODELS });
  assert.deepEqual(body, { mode: "auto" });
  assert.equal("model" in body, false);
});

test("BR_01 — a turn always states its mode, so the server never silently defaults", () => {
  for (const mode of ["auto", "manual"] as const) {
    assert.equal(turnBody({ mode, modelId: MODELS[0].id, models: MODELS }).mode, mode);
  }
});

test("BR_02_BE-02 — an unknown model id is not sent", () => {
  const body = turnBody({ mode: "manual", modelId: "claude-retired-1", models: MODELS });
  assert.equal(body.model, undefined, "the server should default rather than fail on a stale id");
});

/* ── BR_02: the picker stays honest ──────────────────────────────────────── */

test("BR_02_BE-02 — a stored model that is gone resets, and reports the reset", () => {
  const r = reconcileSelection("claude-retired-1", MODELS, "claude-sonnet-5");
  assert.equal(r.modelId, "claude-sonnet-5");
  assert.equal(r.reset, true, "the user should be told their selection changed");
});

test("BR_02_BE-02 — a still-valid selection is left alone", () => {
  const r = reconcileSelection("claude-opus-5", MODELS);
  assert.deepEqual(r, { modelId: "claude-opus-5", reset: false });
});

test("BR_02_BE-02 — no stored selection is not a reset", () => {
  // Nothing changed under the user, so there is nothing to warn about.
  const r = reconcileSelection("", MODELS, "claude-sonnet-5");
  assert.deepEqual(r, { modelId: "claude-sonnet-5", reset: false });
});

test("BR_02_BE-01 — with no models at all the selection is empty, not invented", () => {
  const r = reconcileSelection("claude-opus-5", []);
  assert.deepEqual(r, { modelId: "", reset: false });
});

test("BR_02_BE-02 — an unreachable fallback falls through to a real model", () => {
  const r = reconcileSelection("gone", MODELS, "also-gone");
  assert.equal(r.modelId, MODELS[0].id);
});

/* ── BR_01_ShowDecision: the decision reaches the user ───────────────────── */

test("BR_01 — the decision names the model that answered", () => {
  assert.match(describeDecision({ chosenModelId: "claude-opus-5", mode: "auto" }), /claude-opus-5/);
});

test("BR_01_BE-02 — a skip is surfaced, because it explains a surprising answer", () => {
  const line = describeDecision({
    chosenModelId: "claude-haiku-4-5",
    mode: "auto",
    skipped: [
      {
        modelId: "claude-opus-5",
        trigger: "budget",
        detail: "estimated cost exceeds the remaining allocation",
      },
    ],
  });
  assert.match(line, /claude-opus-5/);
  assert.match(line, /remaining allocation/);
});

test("BR_01 — several skips are summarised rather than listed forever", () => {
  const line = describeDecision({
    chosenModelId: "claude-haiku-4-5",
    skipped: [
      { modelId: "a", trigger: "budget", detail: "too expensive" },
      { modelId: "b", trigger: "capability", detail: "below the required tier" },
    ],
  });
  assert.match(line, /2 models/);
});

test("BR_01 — no decision renders nothing rather than a placeholder", () => {
  assert.equal(describeDecision(null), "");
  assert.equal(describeDecision(undefined), "");
  assert.equal(describeDecision({ chosenModelId: "" }), "");
});
