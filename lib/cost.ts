import type { ModelRecord } from "@/lib/registry";

/**
 * Cost math and budget checks (S-07, FR-4.3). Pure, deterministic, no I/O.
 *
 * Pre-flight *estimates* only. Actual provider-reported usage is recorded by
 * S-34 — keeping both makes estimator drift visible instead of invisible.
 */

/** Rough characters-per-token. Crude but stable; see the accuracy note below. */
export const CHARS_PER_TOKEN = 4;

/** Assumed response length when estimating a turn's cost before it runs. */
export const ASSUMED_OUTPUT_TOKENS = 800;

/**
 * Estimate tokens for a piece of text.
 *
 * Accuracy: roughly ±25% on English prose, worse on code and non-English text.
 * Good enough to rank models and gate a budget; **not** good enough to bill on.
 * Anything user-visible as spend must come from provider-reported usage (S-34).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateInputTokens(prompt: string, context?: string): number {
  return estimateTokens(prompt) + estimateTokens(context ?? "");
}

/**
 * Cost in USD for a turn. Weights are USD per 1M tokens.
 *
 * Fail closed (NFR-4): a model with unusable rate data is treated as
 * *infinitely expensive*, never free. A missing weight must not make a model
 * look like the cheapest option and win the routing decision.
 */
export function estimateCostUsd(
  model: Pick<ModelRecord, "inputWeight" | "outputWeight">,
  inputTokens: number,
  outputTokens: number,
): number {
  const { inputWeight, outputWeight } = model;
  if (!isUsableRate(inputWeight) || !isUsableRate(outputWeight)) return Infinity;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return Infinity;

  const inTok = Math.max(0, inputTokens);
  const outTok = Math.max(0, outputTokens);
  return (inTok * inputWeight + outTok * outputWeight) / 1_000_000;
}

function isUsableRate(weight: unknown): weight is number {
  return typeof weight === "number" && Number.isFinite(weight) && weight >= 0;
}

export interface BudgetState {
  /** null means no cap configured — not "zero remaining". */
  capUsd: number | null;
  spentUsd: number;
}

export interface BudgetCheck {
  withinBudget: boolean;
  /** null when no cap is configured, matching RoutingDecision.budgetRemaining. */
  remaining: number | null;
}

/**
 * Would this turn fit the budget? Never throws — the router needs a decision,
 * not an exception.
 */
export function checkBudget(budget: BudgetState | undefined, estCostUsd: number): BudgetCheck {
  if (!budget || budget.capUsd === null || !Number.isFinite(budget.capUsd)) {
    return { withinBudget: true, remaining: null };
  }
  const spent = Number.isFinite(budget.spentUsd) ? Math.max(0, budget.spentUsd) : 0;
  const remaining = round6(budget.capUsd - spent);

  // An unusable cost estimate must not slip past the cap.
  if (!Number.isFinite(estCostUsd)) return { withinBudget: false, remaining };

  return { withinBudget: estCostUsd <= remaining, remaining };
}

/** Trim float noise so equal-cost models compare and display predictably. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Ascending cost for this turn — the default ordering when no chain applies. */
export function compareByCost(
  a: ModelRecord,
  b: ModelRecord,
  inputTokens: number,
  outputTokens: number,
): number {
  const ca = estimateCostUsd(a, inputTokens, outputTokens);
  const cb = estimateCostUsd(b, inputTokens, outputTokens);
  if (ca !== cb) return ca - cb;
  return a.id.localeCompare(b.id); // stable tiebreak keeps routing deterministic
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "unknown";
  if (n === 0) return "$0.00";
  return n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`;
}
