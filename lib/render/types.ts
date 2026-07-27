import type { CanonicalTurn } from "@/lib/conversation";

/**
 * Provider render adapters (S-24, FR-9.5) — layer 3 of the fidelity model.
 *
 * A canonical transcript is turned into whatever shape the target model expects
 * without losing structure. Rendering is lossy in exactly one permitted
 * direction: another vendor's `provider_artifact` payloads are dropped. Losing a
 * tool result, a text part, or a message is a bug, and the conformance suite
 * distinguishes the two.
 */

export type ProviderFamily = "anthropic" | "openai-compatible" | "generic-text";

export type ProviderPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-result"; toolCallId: string; result: unknown }
  | { type: "reasoning"; text: string };

export type ProviderRole = "system" | "user" | "assistant" | "tool";

export interface ProviderMessage {
  role: ProviderRole;
  content: ProviderPart[];
}

export interface RenderResult {
  /** Set when the adapter carries the system prompt out of band (Anthropic). */
  system?: string;
  messages: ProviderMessage[];
}

export interface RenderOptions {
  system?: string;
  /**
   * Resolved repo-context bodies, keyed by blob SHA. A pinned context whose SHA
   * is absent renders as an explicit unavailability note rather than silently
   * vanishing or — worse — being filled with current content (FR-9.4).
   */
  contextBySha?: ReadonlyMap<string, string>;
}

export interface Adapter {
  readonly id: ProviderFamily;
  /** False for models with no structured tool-calling; tools flatten to prose. */
  readonly supportsTools: boolean;
  /** True when the system prompt is emitted as the first message. */
  readonly systemAsMessage: boolean;
  /**
   * Declared canonical-role → provider-role mapping. The conformance suite
   * verifies the output against *this*, rather than assuming roles pass through
   * unchanged — Anthropic genuinely carries tool results in user turns.
   */
  readonly roleMap: Readonly<Record<CanonicalTurn["role"], ProviderRole>>;
  render(turns: readonly CanonicalTurn[], opts?: RenderOptions): RenderResult;
}

/** Rendering of an unavailable pinned context. Shared so tests can assert it. */
export function unavailableContextNote(owner: string, repo: string, path: string, sha: string) {
  return `[unavailable: ${owner}/${repo}:${path} @ ${sha} could not be retrieved]`;
}

export function contextHeader(owner: string, repo: string, path: string, sha: string) {
  return `--- ${owner}/${repo}:${path} @ ${sha} ---`;
}
