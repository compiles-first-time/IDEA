import { z } from "zod";

import type { CanonicalPart, CanonicalTurn } from "@/lib/conversation";
import { estimateTokens } from "@/lib/cost";

/**
 * Compaction planning and fidelity reporting (S-28, FR-9.6).
 *
 * Layer 4 of the fidelity model — the only layer where fidelity is genuinely
 * lost. A 400k-token conversation cannot enter an 8k-context model; that's
 * arithmetic. What we control is whether the loss is deliberate, measured, and
 * visible. This module plans; it never summarizes (that would be a model call).
 */

/** Turns at the tail always kept verbatim, budget permitting. */
export const RECENT_TURNS_KEPT = 4;

/** Share of the target window left free for the model's own response. */
export const RESPONSE_HEADROOM = 0.25;

export const FidelityLevel = z.enum(["full", "partial"]);

export const Fidelity = z.object({
  level: FidelityLevel,
  /** Share of the original transcript's tokens that survive, 0–100. */
  pct: z.number().min(0).max(100),
  /** Specific losses, in user-facing language. Empty when level is "full". */
  lost: z.array(z.string()),
});

export const CompactionPlan = z.object({
  strategy: z.enum(["full", "truncate", "summarize"]),
  keptSeqs: z.array(z.number().int()),
  droppedSeqs: z.array(z.number().int()),
  summarizedSeqs: z.array(z.number().int()),
  estTokensBefore: z.number().int().nonnegative(),
  estTokensAfter: z.number().int().nonnegative(),
  fidelity: Fidelity,
});

export type Fidelity = z.infer<typeof Fidelity>;
export type CompactionPlan = z.infer<typeof CompactionPlan>;

export interface FitTarget {
  modelId: string;
  contextWindow: number;
}

export interface PlanOptions {
  /** SHAs that could not be re-fetched — reported as unavailable, not dropped. */
  unavailableShas?: ReadonlySet<string>;
  /** Allow a model-assisted summary of the middle. Planning stays deterministic. */
  allowSummary?: boolean;
  recentTurnsKept?: number;
}

/* -------------------------------------------------------------------------- */
/* Token accounting                                                            */
/* -------------------------------------------------------------------------- */

export function partTokens(part: CanonicalPart): number {
  switch (part.type) {
    case "text":
      return estimateTokens(part.text);
    case "repo_context":
      // The body is re-fetched at replay; bytes is the honest size signal.
      return Math.ceil(part.bytes / 4);
    case "tool_call":
      return estimateTokens(part.tool) + estimateTokens(JSON.stringify(part.args));
    case "tool_result":
      return estimateTokens(JSON.stringify(part.result ?? ""));
    case "provider_artifact":
      return 0; // dropped when rendering for another provider anyway
  }
}

export function turnTokens(turn: CanonicalTurn): number {
  return turn.content.reduce((sum, p) => sum + partTokens(p), 0);
}

export function transcriptTokens(turns: readonly CanonicalTurn[]): number {
  return turns.reduce((sum, t) => sum + turnTokens(t), 0);
}

/* -------------------------------------------------------------------------- */
/* Tool-pair grouping                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Group turns so a `tool_call` and its `tool_result` are never separated —
 * compaction must drop or keep the pair together (S-24 and the model both rely
 * on the pairing holding).
 */
export function groupTurns(turns: readonly CanonicalTurn[]): CanonicalTurn[][] {
  const groups: CanonicalTurn[][] = [];
  let open: CanonicalTurn[] = [];
  const pending = new Set<string>();

  for (const turn of turns) {
    open.push(turn);
    for (const part of turn.content) {
      if (part.type === "tool_call") pending.add(part.id);
      if (part.type === "tool_result") pending.delete(part.callId);
    }
    if (pending.size === 0) {
      groups.push(open);
      open = [];
    }
  }
  // A dangling call at the tail still forms a group rather than vanishing.
  if (open.length) groups.push(open);
  return groups;
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Plan how a transcript fits a target model. Pure and deterministic: same
 * transcript + same target → same plan, every time. The optional summarization
 * step that a caller may run afterwards is a model call; this planning is not.
 */
export function planFit(
  turns: readonly CanonicalTurn[],
  target: FitTarget,
  opts: PlanOptions = {},
): CompactionPlan {
  const before = transcriptTokens(turns);
  const budget = Math.max(0, Math.floor(target.contextWindow * (1 - RESPONSE_HEADROOM)));
  const unavailable = collectUnavailable(turns, opts.unavailableShas);

  if (turns.length === 0) {
    return finish("full", [], [], [], 0, 0, unavailable);
  }

  if (before <= budget) {
    return finish(
      "full",
      turns.map((t) => t.seq),
      [],
      [],
      before,
      before,
      unavailable,
    );
  }

  const groups = groupTurns(turns);
  const recentCount = opts.recentTurnsKept ?? RECENT_TURNS_KEPT;

  // Anchors: the first group (opening intent) and the most recent groups.
  const firstIdx = 0;
  const recentFrom = Math.max(1, groups.length - Math.max(1, recentCount));
  const anchorIdx = new Set<number>([firstIdx]);
  for (let i = recentFrom; i < groups.length; i++) anchorIdx.add(i);

  const keep = new Set<number>();
  let used = 0;

  // Anchors first, newest anchor prioritized — recency matters most on resume.
  const anchorOrder = [...anchorIdx].sort((a, b) => b - a);
  for (const i of anchorOrder) {
    const cost = groups[i].reduce((s, t) => s + turnTokens(t), 0);
    if (used + cost <= budget) {
      keep.add(i);
      used += cost;
    }
  }

  // Then fill backwards from the middle with whatever else still fits.
  for (let i = groups.length - 1; i >= 0; i--) {
    if (keep.has(i)) continue;
    const cost = groups[i].reduce((s, t) => s + turnTokens(t), 0);
    if (used + cost <= budget) {
      keep.add(i);
      used += cost;
    }
  }

  const keptSeqs: number[] = [];
  const compactedSeqs: number[] = [];
  for (let i = 0; i < groups.length; i++) {
    const seqs = groups[i].map((t) => t.seq);
    (keep.has(i) ? keptSeqs : compactedSeqs).push(...seqs);
  }
  keptSeqs.sort((a, b) => a - b);
  compactedSeqs.sort((a, b) => a - b);

  const strategy = opts.allowSummary && compactedSeqs.length > 0 ? "summarize" : "truncate";
  const droppedSeqs = strategy === "truncate" ? compactedSeqs : [];
  const summarizedSeqs = strategy === "summarize" ? compactedSeqs : [];

  const lost = [...unavailable];
  if (compactedSeqs.length > 0) {
    lost.push(
      strategy === "summarize"
        ? `${compactedSeqs.length} turns summarized`
        : `${compactedSeqs.length} turns dropped for size`,
    );
  }
  const droppedContexts = countDroppedContexts(turns, new Set(compactedSeqs));
  if (droppedContexts > 0) {
    lost.push(
      `${droppedContexts} file context${droppedContexts === 1 ? "" : "s"} dropped for size`,
    );
  }

  return finish(strategy, keptSeqs, droppedSeqs, summarizedSeqs, before, used, lost);
}

function collectUnavailable(
  turns: readonly CanonicalTurn[],
  unavailableShas?: ReadonlySet<string>,
): string[] {
  if (!unavailableShas?.size) return [];
  const out: string[] = [];
  for (const turn of turns) {
    for (const part of turn.content) {
      if (part.type === "repo_context" && unavailableShas.has(part.sha)) {
        // Distinct from "dropped for size" — different cause, different fix.
        out.push(`${part.owner}/${part.repo}:${part.path} unavailable (pinned blob is gone)`);
      }
    }
  }
  return out;
}

function countDroppedContexts(
  turns: readonly CanonicalTurn[],
  droppedSeqs: ReadonlySet<number>,
): number {
  let n = 0;
  for (const turn of turns) {
    if (!droppedSeqs.has(turn.seq)) continue;
    n += turn.content.filter((p) => p.type === "repo_context").length;
  }
  return n;
}

function finish(
  strategy: CompactionPlan["strategy"],
  keptSeqs: number[],
  droppedSeqs: number[],
  summarizedSeqs: number[],
  before: number,
  after: number,
  lost: string[],
): CompactionPlan {
  const pct = before === 0 ? 100 : Math.round((Math.min(after, before) / before) * 1000) / 10;
  return CompactionPlan.parse({
    strategy,
    keptSeqs,
    droppedSeqs,
    summarizedSeqs,
    estTokensBefore: before,
    estTokensAfter: after,
    fidelity: {
      level: lost.length === 0 ? "full" : "partial",
      pct: lost.length === 0 ? 100 : pct,
      lost,
    },
  });
}

/** Apply a plan — keep only the turns it kept. Summarizing is the caller's job. */
export function applyPlan(
  turns: readonly CanonicalTurn[],
  plan: CompactionPlan,
): CanonicalTurn[] {
  const keep = new Set(plan.keptSeqs);
  return turns.filter((t) => keep.has(t.seq));
}

/** One-line report for the resume banner (S-32). */
export function describeFidelity(plan: CompactionPlan, modelLabel: string): string {
  if (plan.fidelity.level === "full") return `Resumed on ${modelLabel} — full context.`;
  const shrink = `${fmtK(plan.estTokensBefore)} → ${fmtK(plan.estTokensAfter)}`;
  return `Resumed on ${modelLabel} — compacted ${shrink} (${plan.fidelity.pct}% retained): ${plan.fidelity.lost.join(", ")}.`;
}

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
