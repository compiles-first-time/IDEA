import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSUMED_OUTPUT_TOKENS,
  CHARS_PER_TOKEN,
  checkBudget,
  compareByCost,
  estimateCostUsd,
  estimateInputTokens,
  estimateTokens,
  formatUsd,
} from "@/lib/cost";
import type { ModelRecord } from "@/lib/registry";

function model(over: Partial<ModelRecord> = {}): ModelRecord {
  return {
    id: "m",
    provider: "anthropic",
    label: "M",
    tier: "standard",
    inputWeight: 3,
    outputWeight: 15,
    contextWindow: 1000,
    enabled: true,
    ...over,
  } as ModelRecord;
}

/* -------------------------------------------------------------------------- */
/* Token estimation                                                            */
/* -------------------------------------------------------------------------- */

test("estimateTokens is proportional and handles empty input", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("a".repeat(CHARS_PER_TOKEN * 10)), 10);
  assert.equal(estimateTokens("abc"), 1); // rounds up — never under-counts
});

test("estimateTokens is deterministic", () => {
  const s = "the quick brown fox".repeat(50);
  assert.equal(estimateTokens(s), estimateTokens(s));
});

test("estimateInputTokens sums prompt and context", () => {
  const p = "a".repeat(40); // 10 tokens
  const c = "b".repeat(80); // 20 tokens
  assert.equal(estimateInputTokens(p, c), 30);
  assert.equal(estimateInputTokens(p), 10);
});

/* -------------------------------------------------------------------------- */
/* Cost                                                                        */
/* -------------------------------------------------------------------------- */

test("estimateCostUsd applies input and output rates separately", () => {
  // 1M input @ $3 + 1M output @ $15 = $18
  assert.equal(estimateCostUsd(model(), 1_000_000, 1_000_000), 18);
});

test("a zero-cost model is free, not broken", () => {
  const local = model({ inputWeight: 0, outputWeight: 0 });
  assert.equal(estimateCostUsd(local, 500_000, 500_000), 0);
});

test("a zero-cost model still sorts cheapest", () => {
  const free = model({ id: "free", inputWeight: 0, outputWeight: 0 });
  const paid = model({ id: "paid" });
  assert.ok(compareByCost(free, paid, 1000, 1000) < 0);
});

test("unusable rate data is treated as infinitely expensive, never free (NFR-4)", () => {
  for (const bad of [NaN, Infinity, -1, undefined, null, "3"]) {
    const m = model({ inputWeight: bad as never });
    assert.equal(estimateCostUsd(m, 1000, 1000), Infinity, `inputWeight=${String(bad)}`);
  }
  assert.equal(estimateCostUsd(model({ outputWeight: NaN as never }), 1000, 1000), Infinity);
});

test("non-finite token counts yield an infinite estimate", () => {
  assert.equal(estimateCostUsd(model(), NaN, 10), Infinity);
  assert.equal(estimateCostUsd(model(), 10, Infinity), Infinity);
});

test("negative token counts clamp to zero rather than crediting cost", () => {
  assert.equal(estimateCostUsd(model(), -1_000_000, 0), 0);
});

test("compareByCost breaks ties deterministically by id", () => {
  const a = model({ id: "aaa" });
  const b = model({ id: "bbb" });
  assert.ok(compareByCost(a, b, 100, 100) < 0);
  assert.ok(compareByCost(b, a, 100, 100) > 0);
});

/* -------------------------------------------------------------------------- */
/* Budget                                                                      */
/* -------------------------------------------------------------------------- */

test("no cap means unlimited and remaining is null, not zero", () => {
  const r = checkBudget({ capUsd: null, spentUsd: 100 }, 5);
  assert.equal(r.withinBudget, true);
  assert.equal(r.remaining, null);
});

test("an absent budget is treated as no cap", () => {
  assert.deepEqual(checkBudget(undefined, 99), { withinBudget: true, remaining: null });
});

test("a turn exactly at the remaining budget is allowed", () => {
  const r = checkBudget({ capUsd: 10, spentUsd: 7 }, 3);
  assert.equal(r.withinBudget, true);
  assert.equal(r.remaining, 3);
});

test("a turn one cent over the cap is refused", () => {
  const r = checkBudget({ capUsd: 10, spentUsd: 7 }, 3.01);
  assert.equal(r.withinBudget, false);
  assert.equal(r.remaining, 3);
});

test("an exhausted budget refuses any cost", () => {
  const r = checkBudget({ capUsd: 10, spentUsd: 10 }, 0.0001);
  assert.equal(r.withinBudget, false);
  assert.equal(r.remaining, 0);
});

test("overspend reports negative remaining rather than clamping to zero", () => {
  const r = checkBudget({ capUsd: 10, spentUsd: 12 }, 1);
  assert.equal(r.withinBudget, false);
  assert.equal(r.remaining, -2);
});

test("an infinite cost estimate never slips past a cap", () => {
  const r = checkBudget({ capUsd: 1000, spentUsd: 0 }, Infinity);
  assert.equal(r.withinBudget, false);
});

test("a corrupt spent value is treated as zero spend, not as a crash", () => {
  const r = checkBudget({ capUsd: 10, spentUsd: NaN }, 1);
  assert.equal(r.withinBudget, true);
  assert.equal(r.remaining, 10);
});

test("checkBudget never throws on hostile input", () => {
  assert.doesNotThrow(() => checkBudget({ capUsd: NaN, spentUsd: NaN }, NaN));
});

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

test("formatUsd renders small and large amounts usefully", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(0.000123), "$0.00012");
  assert.equal(formatUsd(12.5), "$12.50");
  assert.equal(formatUsd(Infinity), "unknown");
});

test("ASSUMED_OUTPUT_TOKENS is a sane pre-flight default", () => {
  assert.ok(ASSUMED_OUTPUT_TOKENS > 0 && ASSUMED_OUTPUT_TOKENS < 100_000);
});
