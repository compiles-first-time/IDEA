import { anthropic } from "@ai-sdk/anthropic";
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

const RESOLVERS: Partial<Record<ModelRecord["provider"], Resolver>> = {
  anthropic: (model) => anthropic(model.id),
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
