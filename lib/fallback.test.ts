import test from "node:test";
import assert from "node:assert/strict";

import {
  ChainError,
  chainFor,
  orderFromChain,
  parseRoutingConfig,
  resolveChain,
  unreachableEntries,
  type FallbackChain,
} from "@/lib/fallback";
import type { ModelRecord } from "@/lib/registry";
import { selectModel } from "@/lib/router";

function m(id: string, tier: ModelRecord["tier"], inW: number, outW: number): ModelRecord {
  return {
    id,
    provider: "anthropic",
    label: id,
    tier,
    inputWeight: inW,
    outputWeight: outW,
    contextWindow: 200000,
    enabled: true,
  } as ModelRecord;
}

const CHEAP = m("cheap", "light", 1, 5);
const MID = m("mid", "standard", 3, 15);
const TOP = m("top", "heavy", 5, 25);
const ALL = [CHEAP, MID, TOP];

function chain(...ids: string[]): FallbackChain {
  return { scope: "global", entries: ids.map((modelId) => ({ modelId })) };
}

const CTX = {
  requiredTier: "light" as const,
  inputTokens: 1000,
  outputTokens: 1000,
  remainingUsd: null,
};

/* -------------------------------------------------------------------------- */
/* Config                                                                      */
/* -------------------------------------------------------------------------- */

test("parses a valid routing config", () => {
  const cfg = parseRoutingConfig({
    chains: [{ scope: "global", entries: [{ modelId: "a" }, { modelId: "b" }] }],
  });
  assert.equal(cfg.chains[0].entries.length, 2);
});

test("an empty chain is rejected", () => {
  assert.throws(
    () => parseRoutingConfig({ chains: [{ scope: "global", entries: [] }] }),
    ChainError,
  );
});

test("a project-scoped chain must name its project", () => {
  assert.throws(
    () => parseRoutingConfig({ chains: [{ scope: "project", entries: [{ modelId: "a" }] }] }),
    /must name its project/,
  );
});

test("a per-project chain overrides the global one", () => {
  const cfg = parseRoutingConfig({
    chains: [
      { scope: "global", entries: [{ modelId: "g" }] },
      { scope: "project", projectName: "loom", entries: [{ modelId: "p" }] },
    ],
  });
  assert.equal(chainFor(cfg, "loom")?.entries[0].modelId, "p");
  assert.equal(chainFor(cfg, "other")?.entries[0].modelId, "g");
  assert.equal(chainFor(cfg)?.entries[0].modelId, "g");
});

test("no configured chain resolves to undefined", () => {
  assert.equal(chainFor(parseRoutingConfig({ chains: [] })), undefined);
});

/* -------------------------------------------------------------------------- */
/* Resolution — user order is respected                                        */
/* -------------------------------------------------------------------------- */

test("the chain is walked in user order, not cost order", () => {
  const plan = resolveChain(chain("top", "cheap", "mid"), ALL, CTX);
  assert.deepEqual(
    plan.ordered.map((x) => x.id),
    ["top", "cheap", "mid"],
  );
  assert.equal(plan.primary?.id, "top");
});

test("resolution is deterministic", () => {
  const a = resolveChain(chain("mid", "top"), ALL, CTX);
  const b = resolveChain(chain("mid", "top"), ALL, CTX);
  assert.deepEqual(a, b);
});

/* -------------------------------------------------------------------------- */
/* Skips are recorded with a trigger (FR-4.8, FR-4.11)                         */
/* -------------------------------------------------------------------------- */

test("an entry below the capability floor is skipped, never used (E-4.e)", () => {
  const plan = resolveChain(chain("cheap", "top"), ALL, { ...CTX, requiredTier: "heavy" });
  assert.deepEqual(
    plan.ordered.map((x) => x.id),
    ["top"],
  );
  const skip = plan.skipped.find((s) => s.modelId === "cheap");
  assert.equal(skip?.trigger, "capability");
});

test("an unknown or disabled model is skipped with a reason", () => {
  const plan = resolveChain(chain("ghost", "mid"), ALL, CTX);
  assert.equal(plan.primary?.id, "mid");
  assert.equal(plan.skipped.find((s) => s.modelId === "ghost")?.trigger, "unavailable");
});

test("an entry over budget is skipped with a budget trigger", () => {
  const plan = resolveChain(chain("top", "cheap"), ALL, {
    ...CTX,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    remainingUsd: 10, // top costs $30, cheap costs $6
  });
  assert.equal(plan.primary?.id, "cheap");
  assert.equal(plan.skipped.find((s) => s.modelId === "top")?.trigger, "budget");
});

test("a per-entry maxTier ceiling is honored", () => {
  const c: FallbackChain = {
    scope: "global",
    entries: [{ modelId: "top", maxTier: "standard" }, { modelId: "mid" }],
  };
  const plan = resolveChain(c, ALL, CTX);
  assert.equal(plan.primary?.id, "mid");
  assert.equal(plan.skipped.find((s) => s.modelId === "top")?.trigger, "capability");
});

test("every skip carries a human-readable detail", () => {
  const plan = resolveChain(chain("ghost", "cheap"), ALL, { ...CTX, requiredTier: "heavy" });
  for (const s of plan.skipped) {
    assert.ok(s.detail && s.detail.length > 5, `skip for ${s.modelId} needs a detail`);
  }
});

/* -------------------------------------------------------------------------- */
/* Bounded (E-4.c)                                                             */
/* -------------------------------------------------------------------------- */

test("a duplicated entry is attempted at most once", () => {
  const plan = resolveChain(chain("mid", "mid", "mid"), ALL, CTX);
  assert.equal(plan.ordered.filter((x) => x.id === "mid").length, 1);
});

test("a fully-skipped chain yields no primary rather than looping", () => {
  const plan = resolveChain(chain("ghost", "phantom"), ALL, CTX);
  assert.equal(plan.primary, null);
  assert.equal(plan.ordered.length, 0);
  assert.equal(plan.skipped.length, 2);
});

/* -------------------------------------------------------------------------- */
/* The router seam                                                             */
/* -------------------------------------------------------------------------- */

test("orderFromChain makes the chain the router's ordering function (FR-4.7)", () => {
  const d = selectModel({
    mode: "auto",
    candidates: ALL,
    score: 5,
    signals: { tokens: 100, codeFences: 0, fileCount: 0, reasoningKeywords: 0, needsTools: false },
    requiredTier: "light",
    inputTokens: 100,
    order: orderFromChain(chain("top", "mid", "cheap")),
  });
  // Cost order would have picked "cheap"; the user's chain wins.
  assert.equal(d.chosenModelId, "top");
});

test("chain order cannot smuggle a sub-tier model past the floor (E-4.e)", () => {
  const d = selectModel({
    mode: "auto",
    candidates: ALL,
    score: 90,
    signals: { tokens: 100, codeFences: 0, fileCount: 0, reasoningKeywords: 0, needsTools: false },
    requiredTier: "heavy",
    inputTokens: 100,
    order: orderFromChain(chain("cheap", "mid", "top")),
  });
  assert.equal(d.chosenModelId, "top");
});

test("models absent from the chain sort behind those named in it", () => {
  const ordered = orderFromChain(chain("top"))(ALL, { inputTokens: 100, outputTokens: 100 });
  assert.equal(ordered[0].id, "top");
  assert.deepEqual(ordered.slice(1).map((x) => x.id), ["cheap", "mid"]);
});

/* -------------------------------------------------------------------------- */
/* Settings-UI support (S-35)                                                  */
/* -------------------------------------------------------------------------- */

test("unreachableEntries flags unknown models, duplicates, and dead ceilings", () => {
  const c: FallbackChain = {
    scope: "global",
    entries: [
      { modelId: "mid" },
      { modelId: "mid" },
      { modelId: "ghost" },
      { modelId: "top", maxTier: "light" },
    ],
  };
  const dead = unreachableEntries(c, ALL);
  assert.equal(dead.length, 3);
  assert.ok(dead.some((d) => d.detail?.includes("duplicate")));
  assert.ok(dead.some((d) => d.modelId === "ghost"));
  assert.ok(dead.some((d) => d.modelId === "top" && d.trigger === "capability"));
});

test("a healthy chain reports nothing unreachable", () => {
  assert.deepEqual(unreachableEntries(chain("cheap", "mid", "top"), ALL), []);
});

/* -------------------------------------------------------------------------- */
/* The bundled default chain                                                   */
/* -------------------------------------------------------------------------- */

test("a default chain ships with the product and every entry is reachable", async () => {
  const { defaultRoutingConfig } = await import("@/lib/fallback");
  const { enabledModels } = await import("@/lib/registry");

  const config = defaultRoutingConfig();
  const chain = chainFor(config);
  assert.ok(chain, "a global chain should ship by default so routing works out of the box");
  assert.deepEqual(unreachableEntries(chain, enabledModels()), []);
});

test("the default chain is ordered cheapest-first across tiers", async () => {
  const { defaultRoutingConfig } = await import("@/lib/fallback");
  const { getModel } = await import("@/lib/registry");
  const { tierRank } = await import("@/lib/contracts/routing");

  const entries = chainFor(defaultRoutingConfig())!.entries;
  const ranks = entries.map((e) => tierRank(getModel(e.modelId)!.tier));
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, "expected ascending capability");
});
