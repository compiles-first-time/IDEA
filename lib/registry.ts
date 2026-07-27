import { z } from "zod";

import { Tier, tierRank } from "@/lib/contracts/routing";
import modelsJson from "@/config/models.json";

/**
 * Declarative model registry (S-04, FR-4.1/4.3, AD-4).
 *
 * Models are data, not code — adding one is an edit to config/models.json.
 * Rates are USD per 1M tokens, kept as separate input/output weights because
 * real pricing is asymmetric (output runs ~5x input, and the ratio differs per
 * model). Flattening to one scalar would destroy information at the exact seam
 * FR-4.5 says to preserve.
 */
export const ModelRecord = z
  .object({
    id: z.string().min(1),
    provider: z.enum(["anthropic", "openai", "local", "google", "other"]),
    label: z.string().min(1),
    tier: Tier,
    /** USD per 1M input tokens. */
    inputWeight: z.number().min(0),
    /** USD per 1M output tokens. */
    outputWeight: z.number().min(0),
    contextWindow: z.number().int().positive(),
    enabled: z.boolean().default(true),
    /** Required for provider === "local"; the user's OpenAI-compatible base URL. */
    endpoint: z.url().optional(),
  })
  .refine((m) => m.provider !== "local" || !!m.endpoint, {
    message: "a local model must declare an endpoint",
    path: ["endpoint"],
  });

export const Registry = z.object({
  defaultId: z.string().min(1),
  models: z.array(ModelRecord).min(1),
});

export type ModelRecord = z.infer<typeof ModelRecord>;
export type Registry = z.infer<typeof Registry>;

export class RegistryError extends Error {}

/**
 * Validate raw registry data. Pure — takes data, returns data, so tests can
 * exercise it without touching the bundled config.
 */
export function parseRegistry(raw: unknown): Registry {
  const result = Registry.safeParse(raw);
  if (!result.success) {
    throw new RegistryError(
      `invalid model registry: ${result.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }
  const registry = result.data;

  const seen = new Set<string>();
  for (const m of registry.models) {
    if (seen.has(m.id)) throw new RegistryError(`duplicate model id "${m.id}"`);
    seen.add(m.id);
  }
  if (!seen.has(registry.defaultId)) {
    throw new RegistryError(`defaultId "${registry.defaultId}" is not in the registry`);
  }
  return registry;
}

let cached: Registry | null = null;

/** The bundled registry. Fails loudly at first load, not silently per-request. */
export function loadRegistry(): Registry {
  cached ??= parseRegistry(modelsJson);
  return cached;
}

/** Test seam — swap in a fixture, or reset to the bundled config. */
export function __setRegistryForTests(registry: Registry | null): void {
  cached = registry;
}

export function allModels(registry = loadRegistry()): ModelRecord[] {
  return registry.models;
}

export function enabledModels(registry = loadRegistry()): ModelRecord[] {
  return registry.models.filter((m) => m.enabled);
}

/** Enabled model by id, or undefined. Disabled models are never returned. */
export function getModel(id: string, registry = loadRegistry()): ModelRecord | undefined {
  return enabledModels(registry).find((m) => m.id === id);
}

/** Enabled models whose capability tier meets or exceeds `tier` (FR-4.2). */
export function modelsAtOrAboveTier(
  tier: z.infer<typeof Tier>,
  registry = loadRegistry(),
): ModelRecord[] {
  const floor = tierRank(tier);
  return enabledModels(registry).filter((m) => tierRank(m.tier) >= floor);
}

/**
 * The default model id, honoring IDEA_CHAT_MODEL (FR-3.3).
 *
 * An env override naming a model that isn't enabled is ignored rather than
 * obeyed — a typo in an env var must not take chat down.
 */
export function defaultModelId(registry = loadRegistry()): string {
  const override = process.env.IDEA_CHAT_MODEL;
  if (override && getModel(override, registry)) return override;
  if (getModel(registry.defaultId, registry)) return registry.defaultId;

  const fallback = enabledModels(registry)[0];
  if (!fallback) throw new RegistryError("no enabled models in the registry");
  return fallback.id;
}
