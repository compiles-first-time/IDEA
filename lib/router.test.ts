import test from "node:test";
import assert from "node:assert/strict";

import { RoutingDecision } from "@/lib/contracts/routing";
import {
  RouterError,
  TIER_THRESHOLDS,
  WEIGHTS,
  orderByCost,
  route,
  scoreComplexity,
  selectModel,
  tierForScore,
  type ModelOrder,
} from "@/lib/router";
import type { ModelRecord } from "@/lib/registry";

function m(
  id: string,
  tier: ModelRecord["tier"],
  inputWeight: number,
  outputWeight: number,
): ModelRecord {
  return {
    id,
    provider: "anthropic",
    label: id,
    tier,
    inputWeight,
    outputWeight,
    contextWindow: 200000,
    enabled: true,
  } as ModelRecord;
}

const CHEAP = m("cheap", "light", 1, 5);
const MID = m("mid", "standard", 3, 15);
const TOP = m("top", "heavy", 5, 25);
const ALL = [CHEAP, MID, TOP];

const BASE = {
  mode: "auto" as const,
  candidates: ALL,
  score: 10,
  signals: {
    tokens: 100,
    codeFences: 0,
    fileCount: 0,
    reasoningKeywords: 0,
    needsTools: false,
  },
  requiredTier: "light" as const,
  inputTokens: 100,
};

/* -------------------------------------------------------------------------- */
/* Scoring — purity and totality                                               */
/* -------------------------------------------------------------------------- */

test("scoreComplexity is deterministic", () => {
  const input = { prompt: "why does this fail?", context: "x".repeat(4000), fileCount: 2 };
  assert.deepEqual(scoreComplexity(input), scoreComplexity(input));
});

test("scoreComplexity never throws on empty or hostile input", () => {
  assert.doesNotThrow(() => scoreComplexity({ prompt: "" }));
  assert.doesNotThrow(() => scoreComplexity({ prompt: "x", fileCount: -5 }));
  assert.doesNotThrow(() => scoreComplexity({ prompt: "x".repeat(2_000_000) }));
});

test("an empty prompt scores zero and routes light", () => {
  const r = scoreComplexity({ prompt: "" });
  assert.equal(r.score, 0);
  assert.equal(r.requiredTier, "light");
});

test("negative fileCount is clamped, not trusted", () => {
  assert.equal(scoreComplexity({ prompt: "x", fileCount: -5 }).signals.fileCount, 0);
});

/* -------------------------------------------------------------------------- */
/* Scoring — the acceptance cases from S-08                                    */
/* -------------------------------------------------------------------------- */

test("a trivial one-liner routes light", () => {
  const r = scoreComplexity({ prompt: "what port does the server use?" });
  assert.equal(r.requiredTier, "light");
});

test("a multi-file refactor with code fences routes heavy", () => {
  const r = scoreComplexity({
    prompt: "Refactor this module and explain the trade-off. Why is the design like this?",
    context: "```ts\n" + "const x = 1;\n".repeat(400) + "```",
    fileCount: 6,
  });
  assert.equal(r.requiredTier, "heavy", `score was ${r.score}`);
});

test("tool use alone lifts a trivial prompt off the light tier", () => {
  const plain = scoreComplexity({ prompt: "list the files" });
  const tooled = scoreComplexity({ prompt: "list the files", needsTools: true });
  assert.equal(plain.requiredTier, "light");
  assert.ok(tooled.score > plain.score);
  assert.equal(tooled.signals.needsTools, true);
});

test("needsTools comes from the request, never inferred from prose", () => {
  // Mentioning tools in text must not set the flag — that's a fact, not a guess.
  const r = scoreComplexity({ prompt: "please use the read_repo_file tool" });
  assert.equal(r.signals.needsTools, false);
});

test("signals are counted, not guessed", () => {
  const r = scoreComplexity({
    prompt: "why is this slow? compare the two approaches",
    context: "```js\na\n```\n```py\nb\n```",
    fileCount: 3,
  });
  assert.equal(r.signals.codeFences, 2);
  assert.equal(r.signals.fileCount, 3);
  assert.ok(r.signals.reasoningKeywords >= 2); // "why", "compare"
});

test("keyword stuffing does not inflate the score without bound", () => {
  const once = scoreComplexity({ prompt: "why" }).score;
  const many = scoreComplexity({ prompt: "why why why why why why why why" }).score;
  assert.ok(many - once < WEIGHTS.reasoningKeyword, "presence, not frequency");
});

test("tierForScore respects the published thresholds", () => {
  assert.equal(tierForScore(TIER_THRESHOLDS.standard - 0.01), "light");
  assert.equal(tierForScore(TIER_THRESHOLDS.standard), "standard");
  assert.equal(tierForScore(TIER_THRESHOLDS.heavy - 0.01), "standard");
  assert.equal(tierForScore(TIER_THRESHOLDS.heavy), "heavy");
  assert.equal(tierForScore(NaN), "heavy"); // fail toward capability
});

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

test("auto picks the cheapest model meeting the floor", () => {
  const d = selectModel({ ...BASE, requiredTier: "light" });
  assert.equal(d.chosenModelId, "cheap");
  assert.equal(d.degraded, false);
});

test("the capability floor is never bypassed for cost", () => {
  const d = selectModel({ ...BASE, requiredTier: "heavy" });
  assert.equal(d.chosenModelId, "top");
});

test("a standard floor excludes the light model", () => {
  const d = selectModel({ ...BASE, requiredTier: "standard" });
  assert.equal(d.chosenModelId, "mid");
});

test("the decision validates against the RoutingDecision contract", () => {
  assert.doesNotThrow(() => RoutingDecision.parse(selectModel(BASE)));
});

test("the reason names the signals that drove the tier", () => {
  const scored = scoreComplexity({
    prompt: "why does this break?",
    fileCount: 2,
    needsTools: true,
  });
  const d = selectModel({
    ...BASE,
    score: scored.score,
    signals: scored.signals,
    requiredTier: scored.requiredTier,
  });
  assert.match(d.reason, /tool use requested/);
  assert.match(d.reason, /2 files/);
  assert.ok(d.reason.includes(String(scored.score)));
});

test("routing is identical for identical input", () => {
  assert.deepEqual(selectModel(BASE), selectModel(BASE));
});

test("an empty candidate list is an explicit error, not a crash", () => {
  assert.throws(() => selectModel({ ...BASE, candidates: [] }), RouterError);
});

/* -------------------------------------------------------------------------- */
/* Under-served capability                                                     */
/* -------------------------------------------------------------------------- */

test("no model at the required tier uses the best available and says so loudly", () => {
  const d = selectModel({ ...BASE, candidates: [CHEAP], requiredTier: "heavy" });
  assert.equal(d.chosenModelId, "cheap");
  assert.equal(d.degraded, true);
  assert.match(d.reason, /No model meets the required heavy tier/);
});

test("under-serving picks the most capable available, not the cheapest", () => {
  const d = selectModel({ ...BASE, candidates: [CHEAP, MID], requiredTier: "heavy" });
  assert.equal(d.chosenModelId, "mid");
  assert.equal(d.degraded, true);
  assert.ok(d.fallbacks.some((f) => f.modelId === "cheap" && f.trigger === "capability"));
});

/* -------------------------------------------------------------------------- */
/* Budget pressure (E-4.b)                                                     */
/* -------------------------------------------------------------------------- */

const BIG = 1_000_000;

test("budget pressure forces a cheaper capable model", () => {
  // top costs $25/M out; mid $15/M out. A cap between them forces mid.
  const d = selectModel({
    ...BASE,
    inputTokens: BIG,
    outputTokens: BIG,
    requiredTier: "standard",
    budget: { capUsd: 20, spentUsd: 0 },
  });
  assert.equal(d.chosenModelId, "mid");
  assert.equal(d.degraded, false, "mid genuinely fits — this is selection, not degradation");
});

test("nothing affordable degrades to the cheapest capable model and warns", () => {
  const d = selectModel({
    ...BASE,
    inputTokens: BIG,
    outputTokens: BIG,
    requiredTier: "standard",
    budget: { capUsd: 0.01, spentUsd: 0 },
  });
  assert.equal(d.degraded, true);
  assert.equal(d.chosenModelId, "mid"); // cheapest that still meets the floor
  assert.match(d.reason, /Budget exceeded/);
  assert.ok(d.fallbacks.some((f) => f.trigger === "budget"));
});

test("degradation never drops below the capability floor", () => {
  const d = selectModel({
    ...BASE,
    inputTokens: BIG,
    outputTokens: BIG,
    requiredTier: "heavy",
    budget: { capUsd: 0.0001, spentUsd: 0 },
  });
  assert.equal(d.chosenModelId, "top", "must not fall back to a sub-tier model to save money");
  assert.equal(d.degraded, true);
});

test("budgetRemaining is null when no cap is configured", () => {
  assert.equal(selectModel(BASE).budgetRemaining, null);
});

test("budgetRemaining reports the real remainder when capped", () => {
  const d = selectModel({ ...BASE, budget: { capUsd: 5, spentUsd: 1.25 } });
  assert.equal(d.budgetRemaining, 3.75);
});

/* -------------------------------------------------------------------------- */
/* Manual mode                                                                 */
/* -------------------------------------------------------------------------- */

test("manual mode honors the user's pick even when a cheaper one would do", () => {
  const d = selectModel({ ...BASE, mode: "manual", requestedModelId: "top" });
  assert.equal(d.chosenModelId, "top");
  assert.equal(d.mode, "manual");
  assert.match(d.reason, /Manual selection/);
});

test("manual mode with an unknown model falls back and records why", () => {
  const d = selectModel({ ...BASE, mode: "manual", requestedModelId: "ghost" });
  assert.equal(d.chosenModelId, "cheap");
  assert.ok(d.fallbacks.some((f) => f.modelId === "ghost" && f.trigger === "unavailable"));
});

/* -------------------------------------------------------------------------- */
/* Injected ordering (the S-33 seam)                                           */
/* -------------------------------------------------------------------------- */

test("the ordering function is injected, not hard-coded to cost", () => {
  const preferTop: ModelOrder = (models) =>
    [...models].sort((a, b) => (a.id === "top" ? -1 : b.id === "top" ? 1 : 0));

  const byCost = selectModel({ ...BASE, requiredTier: "light" });
  const byChain = selectModel({ ...BASE, requiredTier: "light", order: preferTop });

  assert.equal(byCost.chosenModelId, "cheap");
  assert.equal(byChain.chosenModelId, "top", "a user chain must be able to override cost order");
});

test("an injected order still respects the capability floor and the budget", () => {
  const preferCheap: ModelOrder = (models) =>
    [...models].sort((a, b) => (a.id === "cheap" ? -1 : b.id === "cheap" ? 1 : 0));
  const d = selectModel({ ...BASE, requiredTier: "heavy", order: preferCheap });
  assert.equal(d.chosenModelId, "top", "ordering cannot smuggle a sub-tier model past the floor");
});

test("orderByCost is exported and sorts ascending", () => {
  const ordered = orderByCost(ALL, { inputTokens: 1000, outputTokens: 1000 });
  assert.deepEqual(
    ordered.map((x) => x.id),
    ["cheap", "mid", "top"],
  );
});

/* -------------------------------------------------------------------------- */
/* route() convenience                                                         */
/* -------------------------------------------------------------------------- */

test("route scores and selects in one call", () => {
  const d = route(
    { prompt: "hello" },
    { mode: "auto", candidates: ALL },
  );
  assert.equal(d.chosenModelId, "cheap");
  assert.equal(d.signals.tokens > 0, true);
});

test("route makes no model call — the module is pure", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./router.ts", import.meta.url), "utf8"),
  );
  for (const banned of ["streamText", "generateText", "anthropic(", "fetch("]) {
    assert.equal(src.includes(banned), false, `router.ts must not contain ${banned} (AD-3)`);
  }
});
