import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { ModelRecord } from "@/lib/registry";

/**
 * Registry record → AI SDK model instance.
 *
 * Table-driven so `/api/chat` contains no per-provider branching (§C, AD-2):
 * adding a provider is an entry here plus a registry record, not a route edit.
 */

export class ProviderError extends Error {}

type Resolver = (model: ModelRecord) => LanguageModel;

/**
 * A local model is just another registry entry (S-10, FR-6.1).
 *
 * IDEA still does not host inference — it talks to an OpenAI-compatible server
 * the user runs (Ollama, llama.cpp, LM Studio, vLLM). What changed with
 * local-first is that reaching `127.0.0.1` is now trivial: no companion, no
 * tunnel, no proxy hop.
 */
function localProvider(model: ModelRecord): LanguageModel {
  if (!model.endpoint) {
    throw new ProviderError(`local model "${model.id}" has no endpoint configured`);
  }
  const provider = createOpenAICompatible({
    name: model.id,
    baseURL: model.endpoint,
    // A local server usually needs no key; some accept any non-empty value.
    ...(process.env.IDEA_LOCAL_API_KEY
      ? { headers: { Authorization: `Bearer ${process.env.IDEA_LOCAL_API_KEY}` } }
      : {}),
  });
  return provider(model.id);
}

const RESOLVERS: Partial<Record<ModelRecord["provider"], Resolver>> = {
  anthropic: (model) => anthropic(model.id),
  local: localProvider,
  // An OpenAI-compatible endpoint covers hosted OpenAI too, when configured.
  openai: localProvider,
};

export function resolveModel(model: ModelRecord): LanguageModel {
  const resolver = RESOLVERS[model.provider];
  if (!resolver) {
    throw new ProviderError(
      `provider "${model.provider}" is not wired up yet — ${model.label} cannot be used`,
    );
  }
  return resolver(model);
}

export function isProviderSupported(provider: ModelRecord["provider"]): boolean {
  return RESOLVERS[provider] !== undefined;
}
