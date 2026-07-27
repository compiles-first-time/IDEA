import { z } from "zod";

/** Capability tier a prompt requires / a model provides. */
export const Tier = z.enum(["light", "standard", "heavy"]);

/** Ordering used when ranking candidate models (highest tier last). */
export const TIER_ORDER = ["light", "standard", "heavy"] as const;

export function tierRank(tier: z.infer<typeof Tier>): number {
  return TIER_ORDER.indexOf(tier);
}

/** Deterministic signals extracted from a prompt (S-08, FR-4.2). */
export const ComplexitySignals = z.object({
  tokens: z.number().int().nonnegative(),
  codeFences: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  reasoningKeywords: z.number().int().nonnegative(),
  needsTools: z.boolean(),
});

/**
 * Why the router moved off a preferred model (FR-4.8).
 *
 * These are genuinely different events: `budget` walks down the cost curve,
 * `provider_error` walks sideways to another vendor, and `capability` escalates.
 */
export const FallbackTrigger = z.enum([
  "budget",
  "provider_error",
  "capability",
  "unavailable",
]);

export const FallbackEvent = z.object({
  modelId: z.string(),
  trigger: FallbackTrigger,
  detail: z.string().optional(),
});

/**
 * The record of how one turn got routed (FR-4.4). Stored on the assistant turn
 * in the conversation archive, which makes the archive the telemetry log and the
 * spend ledger at the same time (AD-7).
 */
export const RoutingDecision = z.object({
  mode: z.enum(["manual", "auto"]),
  chosenModelId: z.string(),
  requiredTier: Tier,
  score: z.number(),
  signals: ComplexitySignals,
  estCostUsd: z.number().nonnegative(),
  budgetRemaining: z.number().nullable(),
  degraded: z.boolean(),
  /** Entries skipped or failed before landing on `chosenModelId`, in order. */
  fallbacks: z.array(FallbackEvent).default([]),
  reason: z.string(),
});

/**
 * Actual usage, recorded from the provider response (FR-4.10).
 * Estimates are kept alongside so drift is visible — a persistent gap means the
 * S-07 estimator needs tuning.
 */
export const SpendRecord = z.object({
  ts: z.string(),
  modelId: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});

export type Tier = z.infer<typeof Tier>;
export type ComplexitySignals = z.infer<typeof ComplexitySignals>;
export type FallbackTrigger = z.infer<typeof FallbackTrigger>;
export type FallbackEvent = z.infer<typeof FallbackEvent>;
export type RoutingDecision = z.infer<typeof RoutingDecision>;
export type SpendRecord = z.infer<typeof SpendRecord>;
