import { generateText, tool, type ModelMessage, type ToolSet } from "ai";

import type { AgentMessage, StepFn } from "@/lib/agent";
import { resolveModel } from "@/lib/providers";
import type { ModelRecord } from "@/lib/registry";
import { getTool } from "@/lib/tools";

/**
 * The AI SDK backing for the agent loop's `StepFn` (S-14).
 *
 * This is the **only** file that knows about a provider SDK. `lib/agent.ts`
 * stays vendor-free, which is what makes the same skill runnable against
 * anything the registry can resolve (FR-5.3, AD-2).
 *
 * Tools are declared **without an `execute`**, so the SDK returns tool calls
 * rather than running them. Execution belongs to the loop, behind the Rule 20
 * gate — a tool the SDK ran itself would bypass governance entirely.
 */

function toolsFor(names: readonly string[]): ToolSet {
  const set: ToolSet = {};
  for (const name of names) {
    const def = getTool(name);
    if (!def) continue; // unknown names are rejected earlier, by the route
    set[name] = tool({
      description: def.description,
      inputSchema: def.parameters,
      // No execute: the SDK surfaces the call; the loop decides and runs it.
    });
  }
  return set;
}

/** Convert the loop's neutral messages into AI SDK model messages. */
export function toModelMessages(messages: readonly AgentMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
      continue;
    }

    if (m.role === "assistant") {
      const parts: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
      > = [];
      if (m.text) parts.push({ type: "text", text: m.text });
      for (const c of m.toolCalls ?? []) {
        parts.push({
          type: "tool-call",
          toolCallId: (c as { id?: string }).id ?? "",
          toolName: c.tool,
          input: c.args ?? {},
        });
      }
      // An assistant turn with nothing in it would be rejected by the API.
      if (parts.length > 0) {
        out.push({ role: "assistant", content: parts as never });
      }
      continue;
    }

    // Tool results must pair with the call that produced them, or the model
    // loses the thread — the same invariant S-24's conformance suite enforces.
    out.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: m.callId,
          toolName: toolNameFor(messages, m.callId),
          output: { type: "text", value: stringify(m.result) },
        },
      ],
    } as ModelMessage);
  }

  return out;
}

/** Recover the tool name for a result by looking back at its call. */
function toolNameFor(messages: readonly AgentMessage[], callId: string): string {
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.toolCalls ?? []) {
      if ((c as { id?: string }).id === callId) return c.tool;
    }
  }
  return "unknown";
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Build a `StepFn` for a registry model.
 *
 * Named for the loop's needs, not the vendor's: swapping in another provider is
 * a different `resolveModel` entry, not a change here.
 */
export function anthropicStep(model: ModelRecord): StepFn {
  return async (req) => {
    const result = await generateText({
      model: resolveModel(model),
      system: req.system,
      messages: toModelMessages(req.messages),
      tools: toolsFor(req.tools),
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((tc) => {
        const args = (tc.input ?? {}) as Record<string, unknown>;
        return {
          id: tc.toolCallId,
          tool: tc.toolName,
          args,
          // The gate classifies shell calls from the command line, so surface
          // it where `classify()` looks for it.
          ...(typeof args.command === "string" ? { command: args.command } : {}),
        };
      }),
    };
  };
}
