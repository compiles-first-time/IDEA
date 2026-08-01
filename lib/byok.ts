/**
 * Bring-your-own-key (BYOK) — the hosted-mode key channel (FR-15.2, E-15.b).
 *
 * In hosted mode a provider key belongs to the person chatting, not to the
 * deployment. Keys live in the user's browser (localStorage), ride each
 * `/api/chat` request as `x-idea-key-*` headers, are used for that one
 * provider call, and are never stored, logged, or echoed by the server.
 *
 * Headers rather than the request body, deliberately: the body is what gets
 * validated, routed on, and (in local mode) persisted. A key that never
 * enters the body cannot end up in a transcript (NFR-6 as re-scoped by E-15.b).
 *
 * This module is pure and shared by server and client — it defines the
 * provider table and the header convention, nothing else.
 */

export const BYOK_PROVIDERS = [
  { id: "anthropic", label: "Anthropic — Claude", placeholder: "sk-ant-…" },
  { id: "openai", label: "OpenAI — GPT", placeholder: "sk-…" },
  { id: "google", label: "Google — Gemini", placeholder: "AIza…" },
  { id: "moonshot", label: "Moonshot — Kimi", placeholder: "sk-…" },
  { id: "dashscope", label: "Alibaba — Qwen", placeholder: "sk-…" },
] as const;

export type ByokProviderId = (typeof BYOK_PROVIDERS)[number]["id"];

/** Per-request provider keys. Every field optional — absence means "use env". */
export type ProviderKeys = Partial<Record<ByokProviderId, string>>;

export function byokHeaderName(provider: ByokProviderId): string {
  return `x-idea-key-${provider}`;
}

/**
 * Read BYOK headers off a request. Unknown providers are ignored; values are
 * trimmed and length-capped so a malformed header cannot smuggle a payload
 * into provider-client construction.
 */
export function keysFromHeaders(headers: Headers): ProviderKeys {
  const keys: ProviderKeys = {};
  for (const p of BYOK_PROVIDERS) {
    const raw = headers.get(byokHeaderName(p.id));
    if (!raw) continue;
    const value = raw.trim();
    if (value.length === 0 || value.length > 512) continue;
    keys[p.id] = value;
  }
  return keys;
}
