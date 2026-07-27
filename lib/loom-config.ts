import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Reading Loom's cost rates (S-22, FR-4.5/7.3).
 *
 * Loom's Observatory keeps per-model pricing in `observatory/config.yaml`. The
 * shape is the useful part: **separate input and output rates in USD per 1M
 * tokens**, which is what convinced the registry to carry two weights instead of
 * one blended number.
 *
 * ⚠️ Two corrections to the original architecture package, both verified against
 * a real checkout:
 *   1. The file is at `observatory/config.yaml`, **not** `config.yaml` — the
 *      path in `05-data-contracts.md` §8 and `06-loom-integration.md` is wrong.
 *   2. The bundled rates price models that are **retired or deprecated**
 *      (`claude-haiku-3.5` retired 2026-02-19, `claude-opus-4` retiring
 *      2026-06-15). The shape transfers; the values need review.
 */

const Rate = z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() });

export const LoomCostRates = z.record(z.string(), z.record(z.string(), Rate));

export const LoomConfig = z.object({
  cost_rates: LoomCostRates.optional(),
  server: z.object({ port: z.number().int().positive().optional() }).partial().optional(),
});

export type LoomCostRates = z.infer<typeof LoomCostRates>;
export type LoomConfig = z.infer<typeof LoomConfig>;

/** A rate as IDEA's registry expresses it. */
export interface SeedRate {
  provider: string;
  loomModelId: string;
  inputWeight: number;
  outputWeight: number;
}

export class LoomConfigError extends Error {}

export function parseLoomConfig(raw: string): LoomConfig {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    throw new LoomConfigError(`config.yaml is not valid YAML — ${(e as Error).message}`);
  }
  const result = LoomConfig.safeParse(doc ?? {});
  if (!result.success) {
    throw new LoomConfigError(
      `config.yaml is not shaped as expected: ${result.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/** Flatten the nested provider → model → {input,output} map. */
export function seedRates(config: LoomConfig): SeedRate[] {
  const out: SeedRate[] = [];
  for (const [provider, models] of Object.entries(config.cost_rates ?? {})) {
    for (const [loomModelId, rate] of Object.entries(models)) {
      out.push({
        provider,
        loomModelId,
        inputWeight: rate.input,
        outputWeight: rate.output,
      });
    }
  }
  return out.sort((a, b) => a.loomModelId.localeCompare(b.loomModelId));
}

export async function readLoomConfig(path: string): Promise<LoomConfig> {
  return parseLoomConfig(await readFile(path, "utf8"));
}

/* -------------------------------------------------------------------------- */
/* Model-id translation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Loom's model ids are not IDEA's registry ids, and several name models that
 * no longer exist. This table is the documented translation the story asked
 * for — write it down, because it drifts otherwise.
 *
 * `null` means "no current counterpart"; those rates are reported rather than
 * silently applied to the wrong model.
 */
export const LOOM_MODEL_MAP: Readonly<Record<string, string | null>> = {
  // Anthropic — Loom's entries predate the current lineup.
  "claude-opus-4": "claude-opus-5",
  "claude-sonnet-4": "claude-sonnet-5",
  "claude-haiku-3.5": "claude-haiku-4-5", // claude-haiku-3.5 retired 2026-02-19
  // Other providers — no IDEA registry entries yet.
  "gpt-4o": null,
  "gpt-4o-mini": null,
  "gemini-2.5-pro": null,
  "gemini-2.5-flash": null,
};

export interface SeedPlan {
  /** Rates that map onto a registry model. */
  applicable: Array<SeedRate & { ideaModelId: string }>;
  /** Loom rates with no current counterpart — reported, not silently dropped. */
  unmapped: SeedRate[];
  /** Registry models Loom has no rate for — they keep their existing weights. */
  unpriced: string[];
}

/**
 * Work out what seeding would actually change.
 *
 * Deliberately a *plan*, not an apply: the rates in a real Loom checkout are
 * stale enough that overwriting the registry unattended would make pricing
 * worse, not better.
 */
export function planSeed(config: LoomConfig, registryModelIds: readonly string[]): SeedPlan {
  const rates = seedRates(config);
  const applicable: SeedPlan["applicable"] = [];
  const unmapped: SeedRate[] = [];
  const priced = new Set<string>();

  for (const rate of rates) {
    const target = LOOM_MODEL_MAP[rate.loomModelId];
    if (target && registryModelIds.includes(target)) {
      applicable.push({ ...rate, ideaModelId: target });
      priced.add(target);
    } else {
      unmapped.push(rate);
    }
  }

  return {
    applicable,
    unmapped,
    unpriced: registryModelIds.filter((id) => !priced.has(id)),
  };
}
