import { z } from "zod";

/**
 * The chat's routing controls (BR_01, BR_02).
 *
 * Pure so the rules are testable without a browser. The chat sent no `mode` and
 * no `model`, so every turn ran manual mode against the default — the chain, the
 * budget, and complexity scoring were all bypassed. These functions decide what
 * the client sends and what it does with the answer.
 */

export const ChatMode = z.enum(["auto", "manual"]);
export type ChatMode = z.infer<typeof ChatMode>;

export interface PickableModel {
  id: string;
  label: string;
  tier?: string;
}

/**
 * What the client sends for a turn.
 *
 * In auto mode the model id is **omitted**, not sent-and-ignored: sending one
 * would imply the user's choice mattered when the router is about to override
 * it, and a request that lies about its own inputs is impossible to debug later.
 */
export function turnBody(input: {
  mode: ChatMode;
  modelId: string;
  models: readonly PickableModel[];
}): { mode: ChatMode; model?: string } {
  if (input.mode === "auto") return { mode: "auto" };
  const known = input.models.some((m) => m.id === input.modelId);
  return { mode: "manual", model: known ? input.modelId : undefined };
}

/**
 * Keep a stored selection honest against the models this build can reach.
 *
 * A model that was enabled yesterday can be gone today — the registry is config,
 * and a key can lose access. A stale id would fail every turn with a server
 * error; resetting to a real model and saying so is recoverable (BR_02_BE-02).
 */
export function reconcileSelection(
  stored: string,
  models: readonly PickableModel[],
  fallback?: string,
): { modelId: string; reset: boolean } {
  if (models.length === 0) return { modelId: "", reset: false };
  if (models.some((m) => m.id === stored)) return { modelId: stored, reset: false };

  const next = models.some((m) => m.id === fallback) ? fallback! : models[0].id;
  // `reset: false` when nothing was stored — there is nothing to warn about.
  return { modelId: next, reset: Boolean(stored) };
}

export interface DecisionSummary {
  chosenModelId: string;
  mode?: string;
  reason?: string;
  skipped?: Array<{ modelId: string; trigger: string; detail: string }>;
}

/**
 * One line describing what the router did, for the message header.
 *
 * Skips are included because they are the interesting half: "opus was skipped —
 * estimated cost exceeds the remaining allocation" is the sentence that explains
 * a surprising answer, and it is exactly what was being computed and thrown away.
 */
export function describeDecision(d: DecisionSummary | null | undefined): string {
  if (!d?.chosenModelId) return "";
  const parts = [d.chosenModelId];
  if (d.mode) parts.push(`(${d.mode})`);

  const skipped = d.skipped ?? [];
  if (skipped.length > 0) {
    const first = skipped[0];
    parts.push(
      `· skipped ${skipped.length === 1 ? first.modelId : `${skipped.length} models`}: ${first.detail}`,
    );
  }
  return parts.join(" ");
}
