import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { ProviderKeys } from "@/lib/byok";
import type { ModelRecord } from "@/lib/registry";

/**
 * Registry record → AI SDK model instance.
 *
 * Table-driven so `/api/chat` contains no per-provider branching (§C, AD-2):
 * adding a provider is an entry here plus a registry record, not a route edit.
 *
 * Keys resolve per request first, environment second (FR-15.2): a hosted user's
 * own key wins; a local install keeps working from `.env.local` untouched.
 */

export class ProviderError extends Error {}

type Resolver = (model: ModelRecord, keys?: ProviderKeys) => LanguageModel;

/**
 * Which env vars can stand in for a per-request key, per provider. Google gets
 * two because their own docs use both names.
 */
const ENV_FALLBACK: Partial<Record<ModelRecord["provider"], string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY"],
  dashscope: ["DASHSCOPE_API_KEY"],
  local: ["IDEA_LOCAL_API_KEY"],
};

function apiKeyFor(model: ModelRecord, keys?: ProviderKeys): string | undefined {
  const fromRequest = keys?.[model.provider as keyof ProviderKeys];
  if (fromRequest) return fromRequest;
  for (const env of ENV_FALLBACK[model.provider] ?? []) {
    const value = process.env[env];
    if (value) return value;
  }
  return undefined;
}

/**
 * Is there any way to reach this model's provider? Pure pre-flight so the chat
 * route can answer "add your key in Settings" *before* streaming, instead of
 * surfacing a provider SDK error mid-stream. A `local` server counts as
 * reachable without a key — most accept anonymous requests.
 */
export function hasKeyFor(model: ModelRecord, keys?: ProviderKeys): boolean {
  if (model.provider === "local") return true;
  return apiKeyFor(model, keys) !== undefined;
}

/**
 * Every non-Anthropic provider speaks the OpenAI-compatible dialect (S-10,
 * FR-6.1): local servers (Ollama, llama.cpp, LM Studio, vLLM) by design, and
 * OpenAI, Gemini, Kimi, and Qwen because each vendor publishes a compatible
 * endpoint. One adapter, endpoints as registry data.
 */
function compatProvider(model: ModelRecord, keys?: ProviderKeys): LanguageModel {
  if (!model.endpoint) {
    throw new ProviderError(`model "${model.id}" has no endpoint configured`);
  }
  const apiKey = apiKeyFor(model, keys);
  const provider = createOpenAICompatible({
    name: model.id,
    baseURL: model.endpoint,
    ...(apiKey ? { apiKey } : {}),
  });
  return provider(model.id);
}

const RESOLVERS: Partial<Record<ModelRecord["provider"], Resolver>> = {
  anthropic: (model, keys) =>
    keys?.anthropic
      ? createAnthropic({ apiKey: keys.anthropic })(model.id)
      : anthropic(model.id),
  local: compatProvider,
  openai: compatProvider,
  google: compatProvider,
  moonshot: compatProvider,
  dashscope: compatProvider,
};

export function resolveModel(model: ModelRecord, keys?: ProviderKeys): LanguageModel {
  const resolver = RESOLVERS[model.provider];
  if (!resolver) {
    throw new ProviderError(
      `provider "${model.provider}" is not wired up yet — ${model.label} cannot be used`,
    );
  }
  return resolver(model, keys);
}

export function isProviderSupported(provider: ModelRecord["provider"]): boolean {
  return RESOLVERS[provider] !== undefined;
}
