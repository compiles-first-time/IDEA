import {
  ComplexitySignals,
  RoutingDecision,
  Tier,
  tierRank,
  type FallbackEvent,
} from "@/lib/contracts/routing";
import { ASSUMED_OUTPUT_TOKENS, checkBudget, compareByCost, estimateCostUsd, estimateTokens, formatUsd, type BudgetState } from "@/lib/cost";
import type { ModelRecord } from "@/lib/registry";

/**
 * Deterministic model router (S-08, FR-4.2/4.3/4.4, AD-3).
 *
 * Rule-based and inspectable — no ML classifier (E-4.a), no model call. Every
 * weight and threshold below is a named export so tuning is a one-line diff.
 */

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

/** Signal weights. Tuned by hand; expect to revise against real prompts. */
export const WEIGHTS = {
  /** Per 1000 estimated tokens. Long inputs mean more to hold in mind. */
  tokensPer1k: 6,
  codeFence: 8,
  file: 5,
  reasoningKeyword: 7,
  needsTools: 20,
} as const;

/** score < STANDARD → light; < HEAVY → standard; else heavy. */
export const TIER_THRESHOLDS = { standard: 20, heavy: 55 } as const;

/** Words that signal genuine reasoning rather than lookup or restatement. */
export const REASONING_KEYWORDS = [
  "why",
  "design",
  "architect",
  "trade-off",
  "tradeoff",
  "prove",
  "refactor",
  "debug",
  "diagnose",
  "compare",
  "evaluate",
  "optimize",
  "migrate",
  "root cause",
  "explain",
] as const;

export interface ScoreInput {
  prompt: string;
  context?: string;
  fileCount?: number;
  /** A fact from the request (a skill was invoked), never guessed from text. */
  needsTools?: boolean;
}

export interface ScoreResult {
  score: number;
  signals: ComplexitySignals;
  requiredTier: Tier;
}

function countCodeFences(text: string): number {
  // Pairs of ``` delimiters; an unclosed fence still counts as one block.
  const ticks = (text.match(/```/g) ?? []).length;
  return Math.ceil(ticks / 2);
}

function countReasoningKeywords(text: string): number {
  const haystack = text.toLowerCase();
  let n = 0;
  for (const kw of REASONING_KEYWORDS) {
    if (haystack.includes(kw)) n += 1; // presence, not frequency — avoids keyword stuffing
  }
  return n;
}

/**
 * Score a turn's complexity. Pure and total — never throws, handles empty and
 * very large input.
 */
export function scoreComplexity(input: ScoreInput): ScoreResult {
  const prompt = input.prompt ?? "";
  const context = input.context ?? "";
  const combined = `${prompt}\n${context}`;

  const signals: ComplexitySignals = {
    tokens: estimateTokens(prompt) + estimateTokens(context),
    codeFences: countCodeFences(combined),
    fileCount: Math.max(0, Math.trunc(input.fileCount ?? 0)),
    reasoningKeywords: countReasoningKeywords(prompt),
    needsTools: input.needsTools === true,
  };

  const score =
    (signals.tokens / 1000) * WEIGHTS.tokensPer1k +
    signals.codeFences * WEIGHTS.codeFence +
    signals.fileCount * WEIGHTS.file +
    signals.reasoningKeywords * WEIGHTS.reasoningKeyword +
    (signals.needsTools ? WEIGHTS.needsTools : 0);

  const rounded = Math.round(score * 100) / 100;
  return { score: rounded, signals, requiredTier: tierForScore(rounded) };
}

export function tierForScore(score: number): Tier {
  if (!Number.isFinite(score)) return "heavy"; // fail toward capability, not silence
  if (score >= TIER_THRESHOLDS.heavy) return "heavy";
  if (score >= TIER_THRESHOLDS.standard) return "standard";
  return "light";
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ordering function over candidate models. Injected rather than hard-coded so
 * the user's fallback chain (S-33) can replace cost as the ordering function
 * (FR-4.7) without rewriting selection.
 */
export type ModelOrder = (
  models: readonly ModelRecord[],
  ctx: { inputTokens: number; outputTokens: number },
) => ModelRecord[];

export const orderByCost: ModelOrder = (models, ctx) =>
  [...models].sort((a, b) => compareByCost(a, b, ctx.inputTokens, ctx.outputTokens));

export interface SelectInput {
  mode: "manual" | "auto";
  /** All enabled models to choose among. */
  candidates: readonly ModelRecord[];
  score: number;
  signals: ComplexitySignals;
  requiredTier: Tier;
  inputTokens: number;
  outputTokens?: number;
  order?: ModelOrder;
  budget?: BudgetState;
  /** manual mode: the model the user picked. */
  requestedModelId?: string;
}

export class RouterError extends Error {}

/**
 * Choose a model and explain why (FR-4.4). Pure; returns a full RoutingDecision.
 */
export function selectModel(input: SelectInput): RoutingDecision {
  const outputTokens = input.outputTokens ?? ASSUMED_OUTPUT_TOKENS;
  const ctx = { inputTokens: input.inputTokens, outputTokens };
  const order = input.order ?? orderByCost;
  const fallbacks: FallbackEvent[] = [];

  if (input.candidates.length === 0) {
    throw new RouterError("no enabled models available to route to");
  }

  /* Manual: honor the user's pick when it is real. ------------------------- */
  if (input.mode === "manual" && input.requestedModelId) {
    const picked = input.candidates.find((m) => m.id === input.requestedModelId);
    if (picked) {
      const cost = estimateCostUsd(picked, ctx.inputTokens, outputTokens);
      const budget = checkBudget(input.budget, cost);
      return finish({
        mode: "manual",
        model: picked,
        input,
        ctx,
        cost,
        budget,
        degraded: false,
        fallbacks,
        reason: `Manual selection: ${picked.label}.`,
      });
    }
    fallbacks.push({
      modelId: input.requestedModelId,
      trigger: "unavailable",
      detail: "requested model is unknown or disabled",
    });
  }

  /* Capability floor. ------------------------------------------------------ */
  const floor = tierRank(input.requiredTier);
  let capable = input.candidates.filter((m) => tierRank(m.tier) >= floor);
  let underServed = false;

  if (capable.length === 0) {
    // Nothing meets the floor. Use the most capable available and say so loudly
    // rather than silently under-serving the request.
    underServed = true;
    const best = Math.max(...input.candidates.map((m) => tierRank(m.tier)));
    capable = input.candidates.filter((m) => tierRank(m.tier) === best);
    for (const m of input.candidates) {
      if (tierRank(m.tier) < best) {
        fallbacks.push({ modelId: m.id, trigger: "capability" });
      }
    }
  }

  /* Order, then take the first that fits the budget. ----------------------- */
  const ordered = order(capable, ctx);
  const priced = ordered.map((m) => ({
    model: m,
    cost: estimateCostUsd(m, ctx.inputTokens, outputTokens),
  }));

  for (const { model, cost } of priced) {
    const budget = checkBudget(input.budget, cost);
    if (budget.withinBudget) {
      const reason = underServed
        ? `No model meets the required ${input.requiredTier} tier; used the most capable available (${model.label}). Output quality may suffer.`
        : explainAuto(model, input, cost);
      return finish({
        mode: input.mode,
        model,
        input,
        ctx,
        cost,
        budget,
        degraded: underServed,
        fallbacks,
        reason,
      });
    }
    fallbacks.push({
      modelId: model.id,
      trigger: "budget",
      detail: `estimated ${formatUsd(cost)} exceeds remaining budget`,
    });
  }

  /* Nothing fits: degrade to the cheapest capable option and warn (E-4.b). - */
  const cheapest = [...priced].sort((a, b) => a.cost - b.cost)[0];
  const budget = checkBudget(input.budget, cheapest.cost);
  return finish({
    mode: input.mode,
    model: cheapest.model,
    input,
    ctx,
    cost: cheapest.cost,
    budget,
    degraded: true,
    fallbacks,
    reason:
      `Budget exceeded: no candidate fits the remaining ${formatUsd(budget.remaining ?? 0)}. ` +
      `Degraded to the cheapest capable model (${cheapest.model.label}, est. ${formatUsd(cheapest.cost)}).`,
  });
}

function explainAuto(model: ModelRecord, input: SelectInput, cost: number): string {
  const s = input.signals;
  const drivers: string[] = [];
  if (s.needsTools) drivers.push("tool use requested");
  if (s.fileCount > 0) drivers.push(`${s.fileCount} file${s.fileCount === 1 ? "" : "s"} in context`);
  if (s.codeFences > 0) drivers.push(`${s.codeFences} code block${s.codeFences === 1 ? "" : "s"}`);
  if (s.reasoningKeywords > 0) drivers.push(`${s.reasoningKeywords} reasoning cue${s.reasoningKeywords === 1 ? "" : "s"}`);
  if (s.tokens >= 1000) drivers.push(`~${Math.round(s.tokens / 1000)}k tokens`);

  const because = drivers.length ? ` (${drivers.join(", ")})` : " (short, simple prompt)";
  return `Scored ${input.score}${because} → ${input.requiredTier} tier. Chose ${model.label}, est. ${formatUsd(cost)}.`;
}

function finish(args: {
  mode: "manual" | "auto";
  model: ModelRecord;
  input: SelectInput;
  ctx: { inputTokens: number; outputTokens: number };
  cost: number;
  budget: { withinBudget: boolean; remaining: number | null };
  degraded: boolean;
  fallbacks: FallbackEvent[];
  reason: string;
}): RoutingDecision {
  return RoutingDecision.parse({
    mode: args.mode,
    chosenModelId: args.model.id,
    requiredTier: args.input.requiredTier,
    score: args.input.score,
    signals: args.input.signals,
    estCostUsd: Number.isFinite(args.cost) ? args.cost : 0,
    budgetRemaining: args.budget.remaining,
    degraded: args.degraded,
    fallbacks: args.fallbacks,
    reason: args.reason,
  });
}

/** Convenience: score then select, the shape /api/chat uses in auto mode. */
export function route(
  scoreInput: ScoreInput,
  selectInput: Omit<SelectInput, "score" | "signals" | "requiredTier" | "inputTokens">,
): RoutingDecision {
  const scored = scoreComplexity(scoreInput);
  return selectModel({
    ...selectInput,
    score: scored.score,
    signals: scored.signals,
    requiredTier: scored.requiredTier,
    inputTokens: scored.signals.tokens,
  });
}
