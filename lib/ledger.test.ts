import test from "node:test";
import assert from "node:assert/strict";

import { appendTurn, type CanonicalTurn } from "@/lib/conversation";
import {
  LedgerError,
  allocationFor,
  estimatorDrift,
  isInPeriod,
  parseAllocationConfig,
  remainingAllocation,
  resolveLedgerState,
  shouldBlock,
  spendFromTurns,
  spendInPeriod,
  type Allocation,
  type SpendRecord,
} from "@/lib/ledger";

const NOW = new Date("2026-07-26T12:00:00.000Z");

function rec(ts: string, costUsd: number, estimatedCostUsd = costUsd): SpendRecord {
  return { ts, modelId: "m", inputTokens: 10, outputTokens: 10, costUsd, estimatedCostUsd };
}

function alloc(over: Partial<Allocation> = {}): Allocation {
  return { scope: "global", period: "day", limitUsd: 10, action: "degrade", ...over };
}

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

test("parses a valid allocation config", () => {
  const cfg = parseAllocationConfig({
    allocations: [{ scope: "global", period: "month", limitUsd: 50 }],
  });
  assert.equal(cfg.allocations[0].action, "degrade", "degrade is the safer default");
});

test("a project allocation must name its project", () => {
  assert.throws(
    () => parseAllocationConfig({ allocations: [{ scope: "project", period: "day", limitUsd: 1 }] }),
    /must name its project/,
  );
});

test("a negative limit is rejected", () => {
  assert.throws(
    () => parseAllocationConfig({ allocations: [{ scope: "global", period: "day", limitUsd: -1 }] }),
    LedgerError,
  );
});

test("a project allocation overrides the global one", () => {
  const cfg = parseAllocationConfig({
    allocations: [
      { scope: "global", period: "day", limitUsd: 5 },
      { scope: "project", projectName: "loom", period: "day", limitUsd: 50 },
    ],
  });
  assert.equal(allocationFor(cfg, "loom")?.limitUsd, 50);
  assert.equal(allocationFor(cfg, "other")?.limitUsd, 5);
  assert.equal(allocationFor(parseAllocationConfig({ allocations: [] })), undefined);
});

/* -------------------------------------------------------------------------- */
/* Period boundaries (UTC, tested explicitly)                                  */
/* -------------------------------------------------------------------------- */

test("day boundaries are evaluated in UTC", () => {
  assert.equal(isInPeriod("2026-07-26T00:00:00.000Z", "day", NOW), true);
  assert.equal(isInPeriod("2026-07-26T23:59:59.999Z", "day", NOW), true);
  assert.equal(isInPeriod("2026-07-25T23:59:59.999Z", "day", NOW), false);
  assert.equal(isInPeriod("2026-07-27T00:00:00.000Z", "day", NOW), false);
});

test("month boundaries are evaluated in UTC", () => {
  assert.equal(isInPeriod("2026-07-01T00:00:00.000Z", "month", NOW), true);
  assert.equal(isInPeriod("2026-07-31T23:59:59.999Z", "month", NOW), true);
  assert.equal(isInPeriod("2026-06-30T23:59:59.999Z", "month", NOW), false);
  assert.equal(isInPeriod("2026-08-01T00:00:00.000Z", "month", NOW), false);
});

test("the same month in a different year does not count", () => {
  assert.equal(isInPeriod("2025-07-15T00:00:00.000Z", "month", NOW), false);
});

test("session period counts every record the caller supplies", () => {
  assert.equal(isInPeriod("1999-01-01T00:00:00.000Z", "session", NOW), true);
});

test("an unparseable timestamp is not counted", () => {
  assert.equal(isInPeriod("not-a-date", "day", NOW), false);
});

/* -------------------------------------------------------------------------- */
/* Summing                                                                     */
/* -------------------------------------------------------------------------- */

test("spendInPeriod sums only in-period records", () => {
  const records = [
    rec("2026-07-26T01:00:00.000Z", 1),
    rec("2026-07-26T11:00:00.000Z", 2),
    rec("2026-07-25T11:00:00.000Z", 100), // yesterday
  ];
  assert.equal(spendInPeriod(records, "day", NOW), 3);
  assert.equal(spendInPeriod(records, "month", NOW), 103);
});

test("spendInPeriod is pure — now is a parameter, never the clock", () => {
  const records = [rec("2026-07-26T01:00:00.000Z", 5)];
  assert.equal(spendInPeriod(records, "day", NOW), 5);
  assert.equal(spendInPeriod(records, "day", new Date("2026-08-01T00:00:00.000Z")), 0);
});

test("corrupt cost values are ignored rather than poisoning the total", () => {
  const records = [rec("2026-07-26T01:00:00.000Z", NaN), rec("2026-07-26T02:00:00.000Z", 2)];
  assert.equal(spendInPeriod(records, "day", NOW), 2);
});

test("an empty ledger sums to zero", () => {
  assert.equal(spendInPeriod([], "day", NOW), 0);
});

/* -------------------------------------------------------------------------- */
/* The archive is the ledger (AD-7)                                            */
/* -------------------------------------------------------------------------- */

test("spend is derived from stored turns, with no separate storage", () => {
  let turns: CanonicalTurn[] = [];
  turns = appendTurn(turns, { role: "user", content: [{ type: "text", text: "hi" }] }, NOW);
  turns = appendTurn(
    turns,
    {
      role: "assistant",
      modelId: "m",
      content: [{ type: "text", text: "hello" }],
      spend: rec("2026-07-26T01:00:00.000Z", 0.25),
    },
    NOW,
  );

  const records = spendFromTurns(turns);
  assert.equal(records.length, 1, "only turns that carry spend contribute");
  assert.equal(spendInPeriod(records, "day", NOW), 0.25);
});

test("estimator drift is visible", () => {
  const drift = estimatorDrift([
    rec("2026-07-26T01:00:00.000Z", 1.0, 2.0),
    rec("2026-07-26T02:00:00.000Z", 1.0, 2.0),
  ]);
  assert.equal(drift.actualUsd, 2);
  assert.equal(drift.estimatedUsd, 4);
  assert.equal(drift.ratio, 2, "the estimator is running 2x hot — that should be visible");
});

test("drift ratio is null rather than Infinity when nothing was spent", () => {
  assert.equal(estimatorDrift([]).ratio, null);
});

/* -------------------------------------------------------------------------- */
/* Remaining allowance                                                         */
/* -------------------------------------------------------------------------- */

test("no allocation means unlimited, reported as null not zero", () => {
  assert.equal(remainingAllocation(undefined, [], NOW), null);
});

test("remaining is the limit minus in-period spend", () => {
  const records = [rec("2026-07-26T01:00:00.000Z", 4)];
  assert.equal(remainingAllocation(alloc({ limitUsd: 10 }), records, NOW), 6);
});

test("remaining goes negative on overspend rather than clamping", () => {
  const records = [rec("2026-07-26T01:00:00.000Z", 14)];
  assert.equal(remainingAllocation(alloc({ limitUsd: 10 }), records, NOW), -4);
});

/* -------------------------------------------------------------------------- */
/* At the limit                                                                */
/* -------------------------------------------------------------------------- */

test("an unexhausted allocation carries no note", () => {
  const s = resolveLedgerState(alloc(), [rec("2026-07-26T01:00:00.000Z", 1)], NOW);
  assert.equal(s.remainingUsd, 9);
  assert.equal(s.note, null);
  assert.equal(shouldBlock(s), false);
});

test("degrade at the limit warns but does not block", () => {
  const s = resolveLedgerState(
    alloc({ action: "degrade" }),
    [rec("2026-07-26T01:00:00.000Z", 10)],
    NOW,
  );
  assert.equal(shouldBlock(s), false);
  assert.match(s.note ?? "", /cheapest capable model/);
});

test("block at the limit refuses the turn", () => {
  const s = resolveLedgerState(
    alloc({ action: "block" }),
    [rec("2026-07-26T01:00:00.000Z", 10)],
    NOW,
  );
  assert.equal(shouldBlock(s), true);
  assert.match(s.note ?? "", /exhausted/);
});

/* -------------------------------------------------------------------------- */
/* Unreadable ledger (E-4.f)                                                   */
/* -------------------------------------------------------------------------- */

test("an unreadable ledger degrades — it does not block, and does not assume infinity", () => {
  const s = resolveLedgerState(alloc({ action: "block" }), null, NOW);

  assert.equal(s.degradedRead, true);
  assert.equal(s.remainingUsd, 0, "must not assume unlimited budget");
  assert.equal(shouldBlock(s), false, "a slow GitHub read must not look like an outage");
  assert.match(s.note ?? "", /could not be read/);
});

test("the unreadable-ledger note reassures the user their allocation is intact", () => {
  const s = resolveLedgerState(alloc(), null, NOW);
  assert.match(s.note ?? "", /allocation is unaffected/);
});

test("an unreadable ledger with no allocation is simply unlimited", () => {
  const s = resolveLedgerState(undefined, null, NOW);
  assert.equal(s.remainingUsd, null);
  assert.equal(s.degradedRead, false);
});
