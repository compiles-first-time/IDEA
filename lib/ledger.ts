import { z } from "zod";

import type { SpendRecord } from "@/lib/contracts/routing";
import type { CanonicalTurn } from "@/lib/conversation";

/**
 * Spend ledger and financial allocation (S-34, FR-4.9/4.10).
 *
 * **No new storage.** Every stored assistant turn already carries its
 * RoutingDecision and actual usage (AD-7), so cumulative spend is *derived*
 * from the conversation archive and cannot drift out of sync with reality.
 *
 * Pure: `now` is always a parameter, never read from the clock — that is what
 * makes period boundaries testable.
 */

export const Period = z.enum(["session", "day", "month"]);

export const Allocation = z.object({
  scope: z.enum(["global", "project"]),
  projectName: z.string().optional(),
  period: Period,
  limitUsd: z.number().min(0),
  /** What happens at the limit. `degrade` is the safer default. */
  action: z.enum(["degrade", "block"]).default("degrade"),
});

export const AllocationConfig = z.object({
  allocations: z.array(Allocation).default([]),
});

export type Period = z.infer<typeof Period>;
export type Allocation = z.infer<typeof Allocation>;
export type AllocationConfig = z.infer<typeof AllocationConfig>;
export type { SpendRecord };

export class LedgerError extends Error {}

export function parseAllocationConfig(raw: unknown): AllocationConfig {
  const result = AllocationConfig.safeParse(raw);
  if (!result.success) {
    throw new LedgerError(
      `invalid allocation config: ${result.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }
  for (const a of result.data.allocations) {
    if (a.scope === "project" && !a.projectName) {
      throw new LedgerError("a project-scoped allocation must name its project");
    }
  }
  return result.data;
}

export function allocationFor(
  config: AllocationConfig,
  projectName?: string,
): Allocation | undefined {
  const scoped = projectName
    ? config.allocations.find((a) => a.scope === "project" && a.projectName === projectName)
    : undefined;
  return scoped ?? config.allocations.find((a) => a.scope === "global");
}

/* -------------------------------------------------------------------------- */
/* Deriving spend from the archive                                             */
/* -------------------------------------------------------------------------- */

/** Pull the spend records out of stored turns. The archive is the ledger. */
export function spendFromTurns(turns: readonly CanonicalTurn[]): SpendRecord[] {
  const out: SpendRecord[] = [];
  for (const turn of turns) {
    if (turn.spend) out.push(turn.spend);
  }
  return out;
}

/**
 * Period boundaries are evaluated in **UTC**, deliberately: a local-timezone
 * boundary would shift under DST and disagree between the server and the user.
 */
export function isInPeriod(recordTs: string, period: Period, now: Date): boolean {
  if (period === "session") return true; // the caller scopes the records

  const t = new Date(recordTs);
  if (Number.isNaN(t.getTime())) return false; // an unparseable stamp is not counted

  if (period === "day") {
    return (
      t.getUTCFullYear() === now.getUTCFullYear() &&
      t.getUTCMonth() === now.getUTCMonth() &&
      t.getUTCDate() === now.getUTCDate()
    );
  }
  return t.getUTCFullYear() === now.getUTCFullYear() && t.getUTCMonth() === now.getUTCMonth();
}

export function spendInPeriod(
  records: readonly SpendRecord[],
  period: Period,
  now: Date,
): number {
  let total = 0;
  for (const r of records) {
    if (!isInPeriod(r.ts, period, now)) continue;
    if (Number.isFinite(r.costUsd)) total += Math.max(0, r.costUsd);
  }
  return round6(total);
}

/** Estimate-vs-actual drift. A persistent gap means S-07's estimator needs work. */
export function estimatorDrift(
  records: readonly SpendRecord[],
): { actualUsd: number; estimatedUsd: number; ratio: number | null } {
  let actual = 0;
  let estimated = 0;
  for (const r of records) {
    if (Number.isFinite(r.costUsd)) actual += r.costUsd;
    if (Number.isFinite(r.estimatedCostUsd)) estimated += r.estimatedCostUsd;
  }
  return {
    actualUsd: round6(actual),
    estimatedUsd: round6(estimated),
    ratio: actual === 0 ? null : round6(estimated / actual),
  };
}

/**
 * Remaining allowance. `null` means "no allocation configured" — never `0`,
 * which would read as exhausted.
 */
export function remainingAllocation(
  allocation: Allocation | undefined,
  records: readonly SpendRecord[],
  now: Date,
): number | null {
  if (!allocation) return null;
  const spent = spendInPeriod(records, allocation.period, now);
  return round6(allocation.limitUsd - spent);
}

/* -------------------------------------------------------------------------- */
/* At the limit                                                                */
/* -------------------------------------------------------------------------- */

export interface LedgerState {
  /** null = unlimited. */
  remainingUsd: number | null;
  action: Allocation["action"];
  /** True when the ledger could not be read and we are guessing conservatively. */
  degradedRead: boolean;
  note: string | null;
}

/**
 * Resolve the budget state the router should use.
 *
 * If the ledger cannot be read, **degrade to a conservative posture and warn**
 * (E-4.f): do not block chat, and do not assume unlimited budget. Blocking
 * outright would make a slow GitHub response look like an outage.
 */
export function resolveLedgerState(
  allocation: Allocation | undefined,
  records: readonly SpendRecord[] | null,
  now: Date,
): LedgerState {
  if (!allocation) {
    return { remainingUsd: null, action: "degrade", degradedRead: false, note: null };
  }
  if (records === null) {
    return {
      remainingUsd: 0,
      action: "degrade",
      degradedRead: true,
      note:
        "Spend history could not be read, so the cheapest capable model was used. " +
        "Your allocation is unaffected — this is a precaution, not a limit.",
    };
  }
  const remainingUsd = remainingAllocation(allocation, records, now);
  const exhausted = remainingUsd !== null && remainingUsd <= 0;
  return {
    remainingUsd,
    action: allocation.action,
    degradedRead: false,
    note: exhausted
      ? allocation.action === "block"
        ? `The ${allocation.period} allocation of $${allocation.limitUsd.toFixed(2)} is exhausted.`
        : `The ${allocation.period} allocation of $${allocation.limitUsd.toFixed(2)} is exhausted; using the cheapest capable model.`
      : null,
  };
}

/** True when the turn should be refused outright rather than degraded. */
export function shouldBlock(state: LedgerState): boolean {
  return (
    state.action === "block" &&
    !state.degradedRead &&
    state.remainingUsd !== null &&
    state.remainingUsd <= 0
  );
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
