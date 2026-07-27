import { z } from "zod";

import type { AgentDefinition } from "@/lib/manifest";
import {
  gate,
  type Decision,
  type KernelTrace,
  type ScopeContext,
  type ToolCall,
  type TraceSource,
} from "@/lib/permissions";
import { redactUnknown } from "@/lib/redact";

/**
 * Provider-agnostic agent loop (S-13, FR-5.2/5.3/5.4).
 *
 * Runs a parsed skill against any model through a uniform step interface, with
 * Loom's kernel governing every tool call:
 *
 *   - **Rule 20** — reversible steps run; irreversible ones stop for confirmation.
 *   - **Rule 22** — every step emits a trace record with sources, alternatives,
 *     and confidence.
 *   - **Rule 15** — untrusted sources raise the verification bar on high stakes.
 *   - **LR-01** — tool results are *external content*: recorded as untrusted, and
 *     never treated as instruction.
 *
 * The loop owns no provider knowledge. `StepFn` is the seam — the caller supplies
 * one backed by the AI SDK, and the same skill runs on Anthropic, an
 * OpenAI-compatible endpoint, or a fake in tests.
 */

/* -------------------------------------------------------------------------- */
/* The provider seam                                                           */
/* -------------------------------------------------------------------------- */

export interface StepRequest {
  system: string;
  /** Conversation so far, in the loop's own neutral shape. */
  messages: ReadonlyArray<AgentMessage>;
  /** Tool names the skill declares. Availability is the caller's business. */
  tools: readonly string[];
}

export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: readonly ToolCall[] }
  | { role: "tool"; callId: string; ok: boolean; result: unknown };

export interface StepResult {
  /** Assistant text for this step, if any. */
  text?: string;
  /** Tool calls the model wants to make. Empty means it is finished. */
  toolCalls?: readonly (ToolCall & { id: string })[];
}

/** One model turn. Provider-specific; injected. */
export type StepFn = (req: StepRequest) => Promise<StepResult>;

/** Executes an approved tool call. Never called for a refused or paused one. */
export type ExecuteFn = (
  call: ToolCall & { id: string },
) => Promise<{ ok: boolean; result: unknown }>;

/* -------------------------------------------------------------------------- */
/* Run shape                                                                   */
/* -------------------------------------------------------------------------- */

export const StopReason = z.enum([
  "completed",
  "max_steps",
  "awaiting_confirmation",
  "refused",
  "error",
]);
export type StopReason = z.infer<typeof StopReason>;

export interface PendingConfirmation {
  call: ToolCall & { id: string };
  reason: string;
  trace: KernelTrace;
}

export interface AgentRunResult {
  stopReason: StopReason;
  /** Assistant text produced across the run, in order. */
  output: string[];
  messages: AgentMessage[];
  /** Rule 22 records — one per tool call considered, approved or not. */
  traces: KernelTrace[];
  steps: number;
  /** Set when `stopReason` is `awaiting_confirmation` (FR-11.5). */
  pending: PendingConfirmation | null;
  /** Human-readable explanation of why the run ended. */
  note: string;
}

export interface RunOptions {
  definition: AgentDefinition;
  input: string;
  step: StepFn;
  execute: ExecuteFn;
  scope: ScopeContext;
  /** False when running unattended — irreversible steps then pause (FR-11.5). */
  humanPresent: boolean;
  /** Paths a given call will touch, when the caller can determine them. */
  pathsFor?: (call: ToolCall) => readonly string[];
  now?: () => Date;
  /** Values that must never appear in a trace or result (LR-03). */
  extraSecrets?: readonly string[];
}

export class AgentError extends Error {}

/* -------------------------------------------------------------------------- */
/* The loop                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Run a skill to completion, a step cap, or a confirmation stop.
 *
 * Bounded by construction: `maxSteps` is enforced, each iteration either
 * consumes a step or returns, and a tool that throws becomes an error
 * observation the model can recover from rather than crashing the run.
 */
export async function runAgent(opts: RunOptions): Promise<AgentRunResult> {
  const { definition, step, execute, scope } = opts;
  const now = opts.now ?? (() => new Date());
  const secrets = opts.extraSecrets ?? [];

  const messages: AgentMessage[] = [{ role: "user", text: opts.input }];
  const traces: KernelTrace[] = [];
  const output: string[] = [];

  for (let stepNo = 1; stepNo <= definition.maxSteps; stepNo++) {
    let result: StepResult;
    try {
      result = await step({
        system: definition.system,
        messages,
        tools: definition.tools,
      });
    } catch (e) {
      return done("error", output, messages, traces, stepNo, null, `Model step failed: ${msg(e)}`);
    }

    if (result.text) {
      output.push(result.text);
    }

    const calls = result.toolCalls ?? [];
    if (calls.length === 0) {
      messages.push({ role: "assistant", text: result.text ?? "" });
      return done("completed", output, messages, traces, stepNo, null, "Finished.");
    }

    messages.push({ role: "assistant", text: result.text ?? "", toolCalls: calls });

    for (const call of calls) {
      // LR-01: everything the model saw from a tool is external content, and
      // external content is untrusted. Rule 15 raises the bar accordingly.
      const sources = sourcesFrom(messages);

      const verdict = gate({
        call,
        paths: opts.pathsFor?.(call),
        scope,
        humanPresent: opts.humanPresent,
        sources,
        now: now(),
      });
      traces.push(verdict.trace);

      if (verdict.decision === "refuse") {
        // Refusal is an observation, not a crash — the model can choose
        // another approach, which is Rule 1 authorship rather than a dead end.
        messages.push({ role: "tool", callId: call.id, ok: false, result: verdict.reason });
        continue;
      }

      if (verdict.decision === "confirm") {
        return done(
          "awaiting_confirmation",
          output,
          messages,
          traces,
          stepNo,
          { call, reason: verdict.reason, trace: verdict.trace },
          verdict.reason,
        );
      }

      let execution: { ok: boolean; result: unknown };
      try {
        execution = await execute(call);
      } catch (e) {
        execution = { ok: false, result: `tool threw: ${msg(e)}` };
      }

      // LR-03: a tool result can carry a secret. Redact before it enters the
      // transcript, the trace, or the next prompt.
      const clean = redactUnknown(execution.result, secrets);
      messages.push({ role: "tool", callId: call.id, ok: execution.ok, result: clean.value });
    }
  }

  return done(
    "max_steps",
    output,
    messages,
    traces,
    definition.maxSteps,
    null,
    `Stopped after ${definition.maxSteps} steps without finishing. Raise maxSteps or narrow the task.`,
  );
}

/**
 * Resume a run whose irreversible step was approved by a human.
 *
 * The approval is recorded as the *human's* decision, not the agent's — which
 * is what Rule 20's confirmation requirement means, and what keeps authorship
 * (Rule 1) with the person who holds it.
 */
export async function resumeApproved(
  opts: RunOptions & { pending: PendingConfirmation },
): Promise<AgentRunResult> {
  let execution: { ok: boolean; result: unknown };
  try {
    execution = await opts.execute(opts.pending.call);
  } catch (e) {
    execution = { ok: false, result: `tool threw: ${msg(e)}` };
  }
  const clean = redactUnknown(execution.result, opts.extraSecrets ?? []);

  // Re-enter with the approved result already in hand.
  const seeded: StepFn = (() => {
    let first = true;
    return async (req) => {
      if (first) {
        first = false;
        return opts.step({ ...req, messages: [...req.messages] });
      }
      return opts.step(req);
    };
  })();

  const result = await runAgent({
    ...opts,
    step: seeded,
    // The human is, by definition, present — they just approved.
    humanPresent: true,
    input: `${opts.input}\n\n[approved tool ${opts.pending.call.tool} returned: ${JSON.stringify(clean.value).slice(0, 2000)}]`,
  });
  return { ...result, traces: [opts.pending.trace, ...result.traces] };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Prior tool results are external content — untrusted per LR-01. */
function sourcesFrom(messages: readonly AgentMessage[]): TraceSource[] {
  const sources: TraceSource[] = [{ kind: "user", ref: "skill input", trust: "trusted" }];
  for (const m of messages) {
    if (m.role === "tool") {
      sources.push({ kind: "tool_result", ref: m.callId, trust: "untrusted" });
    }
  }
  return sources;
}

function done(
  stopReason: StopReason,
  output: string[],
  messages: AgentMessage[],
  traces: KernelTrace[],
  steps: number,
  pending: PendingConfirmation | null,
  note: string,
): AgentRunResult {
  return { stopReason, output, messages, traces, steps, pending, note };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Did any step get refused or held? Useful for surfacing a run's shape. */
export function decisionsIn(result: AgentRunResult): Record<Decision, number> {
  const counts: Record<Decision, number> = { allow: 0, confirm: 0, refuse: 0 };
  for (const t of result.traces) counts[t.decision] += 1;
  return counts;
}
