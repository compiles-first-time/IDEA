import { z } from "zod";

import { FallbackTrigger, Tier, tierRank, type FallbackEvent } from "@/lib/contracts/routing";
import { estimateCostUsd } from "@/lib/cost";
import type { ModelOrder } from "@/lib/router";
import type { ModelRecord } from "@/lib/registry";
import routingJson from "@/config/routing.json";

/**
 * User-ordered fallback chain (S-33, FR-4.6/4.7/4.8).
 *
 * The chain is the *ordering* function; the capability floor and the budget
 * remain *filters*. Resolution is a pure walk: for each entry in order, keep it
 * if it clears the floor and fits the remaining allocation, else skip it and
 * record why.
 */

export const ChainEntry = z.object({
  modelId: z.string().min(1),
  /** Optional per-entry ceiling — skip this entry above the given tier. */
  maxTier: Tier.optional(),
});

export const FallbackChain = z.object({
  scope: z.enum(["global", "project"]),
  projectName: z.string().optional(),
  entries: z.array(ChainEntry).min(1),
});

export const RoutingConfig = z.object({
  chains: z.array(FallbackChain).default([]),
});

export type ChainEntry = z.infer<typeof ChainEntry>;
export type FallbackChain = z.infer<typeof FallbackChain>;
export type RoutingConfig = z.infer<typeof RoutingConfig>;

export interface ChainContext {
  requiredTier: Tier;
  inputTokens: number;
  outputTokens: number;
  /** null = no cap configured. */
  remainingUsd: number | null;
}

export interface ChainPlan {
  /** Ordered, already filtered. Empty when every entry was skipped. */
  ordered: ModelRecord[];
  primary: ModelRecord | null;
  skipped: FallbackEvent[];
}

export class ChainError extends Error {}

export function parseRoutingConfig(raw: unknown): RoutingConfig {
  const result = RoutingConfig.safeParse(raw);
  if (!result.success) {
    throw new ChainError(
      `invalid routing config: ${result.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }
  for (const chain of result.data.chains) {
    if (chain.scope === "project" && !chain.projectName) {
      throw new ChainError("a project-scoped chain must name its project");
    }
  }
  return result.data;
}

let cachedConfig: RoutingConfig | null = null;

/**
 * The bundled routing config. A default chain ships with the product so the
 * feature works before anyone opens the settings UI.
 */
export function loadRoutingConfig(): RoutingConfig {
  cachedConfig ??= parseRoutingConfig(routingJson);
  return cachedConfig;
}

/** Test seam. */
export function __setRoutingConfigForTests(config: RoutingConfig | null): void {
  cachedConfig = config;
}

/** Per-project chain wins over global; undefined when neither is configured. */
export function chainFor(
  config: RoutingConfig,
  projectName?: string,
): FallbackChain | undefined {
  const scoped = projectName
    ? config.chains.find((c) => c.scope === "project" && c.projectName === projectName)
    : undefined;
  return scoped ?? config.chains.find((c) => c.scope === "global");
}

/**
 * Walk the chain in user order, keeping entries that clear the capability floor
 * and fit the remaining allocation.
 *
 * Every skip records a `FallbackTrigger` so the reason reaches the user
 * (FR-4.11). Each entry is considered at most once (E-4.c).
 */
export function resolveChain(
  chain: FallbackChain,
  candidates: readonly ModelRecord[],
  ctx: ChainContext,
): ChainPlan {
  const floor = tierRank(ctx.requiredTier);
  const ordered: ModelRecord[] = [];
  const skipped: FallbackEvent[] = [];
  const seen = new Set<string>();

  for (const entry of chain.entries) {
    if (seen.has(entry.modelId)) continue; // one attempt per entry, per turn
    seen.add(entry.modelId);

    const model = candidates.find((c) => c.id === entry.modelId);
    if (!model) {
      skip(skipped, entry.modelId, "unavailable", "not in the registry, or disabled");
      continue;
    }
    if (tierRank(model.tier) < floor) {
      skip(
        skipped,
        model.id,
        "capability",
        `tier ${model.tier} is below the required ${ctx.requiredTier}`,
      );
      continue;
    }
    if (entry.maxTier && tierRank(model.tier) > tierRank(entry.maxTier)) {
      skip(skipped, model.id, "capability", `above this entry's ${entry.maxTier} ceiling`);
      continue;
    }
    if (ctx.remainingUsd !== null) {
      const cost = estimateCostUsd(model, ctx.inputTokens, ctx.outputTokens);
      if (cost > ctx.remainingUsd) {
        skip(skipped, model.id, "budget", "estimated cost exceeds the remaining allocation");
        continue;
      }
    }
    ordered.push(model);
  }

  return { ordered, primary: ordered[0] ?? null, skipped };
}

function skip(
  into: FallbackEvent[],
  modelId: string,
  trigger: z.infer<typeof FallbackTrigger>,
  detail: string,
) {
  into.push({ modelId, trigger, detail });
}

/**
 * Adapt a chain into the router's injected `ModelOrder` (the S-08 seam).
 *
 * Chain-named models come first in the user's order; anything the chain does
 * not mention keeps its existing relative order behind them. Filtering stays
 * the router's job — this only reorders, so it can never smuggle a sub-tier
 * model past the capability floor (E-4.e).
 */
export function orderFromChain(chain: FallbackChain): ModelOrder {
  const rank = new Map(chain.entries.map((e, i) => [e.modelId, i]));
  return (models) =>
    [...models].sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra === rb ? a.id.localeCompare(b.id) : ra - rb;
    });
}

/** Entries that can never be selected, for the settings UI to flag (S-35). */
export function unreachableEntries(
  chain: FallbackChain,
  candidates: readonly ModelRecord[],
): FallbackEvent[] {
  const dead: FallbackEvent[] = [];
  const seen = new Set<string>();
  for (const entry of chain.entries) {
    if (seen.has(entry.modelId)) {
      dead.push({ modelId: entry.modelId, trigger: "unavailable", detail: "duplicate entry" });
      continue;
    }
    seen.add(entry.modelId);
    const model = candidates.find((c) => c.id === entry.modelId);
    if (!model) {
      dead.push({
        modelId: entry.modelId,
        trigger: "unavailable",
        detail: "not in the registry, or disabled",
      });
    } else if (entry.maxTier && tierRank(model.tier) > tierRank(entry.maxTier)) {
      dead.push({
        modelId: entry.modelId,
        trigger: "capability",
        detail: `tier ${model.tier} always exceeds this entry's ${entry.maxTier} ceiling`,
      });
    }
  }
  return dead;
}
