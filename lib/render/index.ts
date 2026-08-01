import type { CanonicalPart, CanonicalTurn } from "@/lib/conversation";

import {
  contextHeader,
  unavailableContextNote,
  type Adapter,
  type ProviderFamily,
  type ProviderMessage,
  type ProviderPart,
  type RenderOptions,
  type RenderResult,
} from "@/lib/render/types";

export * from "@/lib/render/types";

/** Render a `repo_context` part to text, pinned by SHA (FR-9.4). */
function contextToText(
  part: Extract<CanonicalPart, { type: "repo_context" }>,
  opts: RenderOptions,
): string {
  const body = opts.contextBySha?.get(part.sha);
  if (body === undefined) {
    return unavailableContextNote(part.owner, part.repo, part.path, part.sha);
  }
  return `${contextHeader(part.owner, part.repo, part.path, part.sha)}\n${body}`;
}

/**
 * Convert one canonical turn's parts into provider parts.
 *
 * `keepArtifactsFrom` names the provider whose artifacts survive; everything
 * else is dropped. Artifacts are never serialized into a prompt as raw JSON.
 */
function toParts(
  turn: CanonicalTurn,
  opts: RenderOptions,
  keepArtifactsFrom: string | null,
): ProviderPart[] {
  const out: ProviderPart[] = [];
  for (const part of turn.content) {
    switch (part.type) {
      case "text":
        out.push({ type: "text", text: part.text });
        break;
      case "repo_context":
        out.push({ type: "text", text: contextToText(part, opts) });
        break;
      case "tool_call":
        out.push({
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.tool,
          args: part.args,
        });
        break;
      case "tool_result":
        out.push({ type: "tool-result", toolCallId: part.callId, result: part.result });
        break;
      case "provider_artifact":
        if (keepArtifactsFrom && part.provider === keepArtifactsFrom) {
          out.push({ type: "reasoning", text: String((part.data as { text?: string })?.text ?? "") });
        }
        // Otherwise dropped — the one permitted loss.
        break;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Anthropic                                                                   */
/* -------------------------------------------------------------------------- */

/** System is out of band; tool results ride in user turns; thinking survives. */
export const anthropicAdapter: Adapter = {
  id: "anthropic",
  supportsTools: true,
  systemAsMessage: false,
  roleMap: { user: "user", assistant: "assistant", tool: "user" },

  render(turns, opts = {}): RenderResult {
    const messages: ProviderMessage[] = turns.map((turn) => ({
      role: this.roleMap[turn.role],
      content: toParts(turn, opts, "anthropic"),
    }));
    return { system: opts.system, messages };
  },
};

/* -------------------------------------------------------------------------- */
/* OpenAI-compatible (also covers local endpoints)                             */
/* -------------------------------------------------------------------------- */

/** System is the first message; tool results are their own role; no reasoning. */
export const openAiAdapter: Adapter = {
  id: "openai-compatible",
  supportsTools: true,
  systemAsMessage: true,
  roleMap: { user: "user", assistant: "assistant", tool: "tool" },

  render(turns, opts = {}): RenderResult {
    const messages: ProviderMessage[] = [];
    if (opts.system) {
      messages.push({ role: "system", content: [{ type: "text", text: opts.system }] });
    }
    for (const turn of turns) {
      messages.push({
        role: this.roleMap[turn.role],
        content: toParts(turn, opts, null),
      });
    }
    return { messages };
  },
};

/* -------------------------------------------------------------------------- */
/* Generic text (models with no structured tool-calling)                       */
/* -------------------------------------------------------------------------- */

function toolCallProse(toolName: string, args: unknown): string {
  return `[tool call: ${toolName} ${JSON.stringify(args)}]`;
}

function toolResultProse(callId: string, result: unknown): string {
  return `[tool result for ${callId}: ${JSON.stringify(result)}]`;
}

/**
 * Everything flattens to text. Documented merge rule: each turn becomes exactly
 * one message whose parts are joined with newlines, and tool structure is
 * preserved *as prose* rather than dropped.
 */
export const genericTextAdapter: Adapter = {
  id: "generic-text",
  supportsTools: false,
  systemAsMessage: true,
  roleMap: { user: "user", assistant: "assistant", tool: "user" },

  render(turns, opts = {}): RenderResult {
    const messages: ProviderMessage[] = [];
    if (opts.system) {
      messages.push({ role: "system", content: [{ type: "text", text: opts.system }] });
    }
    for (const turn of turns) {
      const lines: string[] = [];
      for (const part of turn.content) {
        switch (part.type) {
          case "text":
            lines.push(part.text);
            break;
          case "repo_context":
            lines.push(contextToText(part, opts));
            break;
          case "tool_call":
            lines.push(toolCallProse(part.tool, part.args));
            break;
          case "tool_result":
            lines.push(toolResultProse(part.callId, part.result));
            break;
          case "provider_artifact":
            break; // never leaks into a prompt
        }
      }
      messages.push({
        role: this.roleMap[turn.role],
        content: [{ type: "text", text: lines.join("\n") }],
      });
    }
    return { messages };
  },
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export const ADAPTERS: Readonly<Record<ProviderFamily, Adapter>> = {
  anthropic: anthropicAdapter,
  "openai-compatible": openAiAdapter,
  "generic-text": genericTextAdapter,
};

export function adapterFor(family: ProviderFamily): Adapter {
  const adapter = ADAPTERS[family];
  if (!adapter) throw new Error(`no render adapter for provider family "${family}"`);
  return adapter;
}

export function renderFor(
  family: ProviderFamily,
  turns: readonly CanonicalTurn[],
  opts?: RenderOptions,
): RenderResult {
  return adapterFor(family).render(turns, opts);
}

/** Map a registry provider id onto a render family. */
export function familyForProvider(provider: string): ProviderFamily {
  switch (provider) {
    case "anthropic":
      return "anthropic";
    case "openai":
    case "local":
    case "google":
    case "moonshot":
    case "dashscope":
      return "openai-compatible";
    default:
      return "generic-text";
  }
}
