import { z } from "zod";

/**
 * Local-model fit recommender (S-15, FR-6.4).
 *
 * Pure classification: given a model's size and the user's *reported* memory,
 * say too_large / good_fit / overkill. This function never probes hardware —
 * hardware facts arrive from the local helper or the user (E-6.b), and
 * automatic hardware detection is a dropped requirement.
 */

export const HardwareReport = z.object({
  ramGB: z.number(),
  /** null when no discrete GPU was reported. */
  vramGB: z.number().nullable(),
  source: z.enum(["helper", "user"]),
});

export const LocalModelInfo = z.object({
  id: z.string().min(1),
  paramsB: z.number().nullable(),
  quant: z.string().nullable(),
  sizeGB: z.number(),
  location: z.enum(["hf-cache", "path", "endpoint"]),
});

export const FitVerdict = z.enum(["too_large", "good_fit", "overkill"]);

export const FitResult = z.object({
  model: LocalModelInfo,
  hardware: HardwareReport,
  verdict: FitVerdict,
  headroomGB: z.number(),
  note: z.string(),
});

export type HardwareReport = z.infer<typeof HardwareReport>;
export type LocalModelInfo = z.infer<typeof LocalModelInfo>;
export type FitVerdict = z.infer<typeof FitVerdict>;
export type FitResult = z.infer<typeof FitResult>;

/** Runtime overhead multiplier on top of on-disk size. Tunable. */
export const OVERHEAD_MULTIPLIER = 1.2;

/** Memory beyond this multiple of `need` is more than the model can use. */
export const OVERKILL_MULTIPLIER = 2.5;

/** A non-finite figure means "unknown", which is not the same as zero. */
function known(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/** Usable memory: discrete VRAM when reported, else system RAM. */
export function usableMemoryGB(hardware: HardwareReport): number {
  const mem = hardware.vramGB ?? hardware.ramGB;
  return known(mem) ? mem : 0;
}

/**
 * Memory the model needs once loaded, including runtime overhead.
 *
 * An unknown size returns Infinity, not zero — we cannot confirm an unknown
 * model fits, so it must never classify as `overkill` (NFR-4, fail closed).
 */
export function requiredMemoryGB(model: Pick<LocalModelInfo, "sizeGB">): number {
  if (!Number.isFinite(model.sizeGB)) return Infinity;
  return Math.max(0, model.sizeGB) * OVERHEAD_MULTIPLIER;
}

export function classify(
  model: Pick<LocalModelInfo, "sizeGB">,
  hardware: HardwareReport,
): FitVerdict {
  const mem = usableMemoryGB(hardware);
  const need = requiredMemoryGB(model);
  if (!Number.isFinite(need)) return "too_large";
  if (need > mem) return "too_large";
  if (mem >= need * OVERKILL_MULTIPLIER) return "overkill";
  return "good_fit";
}

export function fit(model: LocalModelInfo, hardware: HardwareReport): FitResult {
  const rawMem = hardware.vramGB ?? hardware.ramGB;
  const sizeKnown = known(model.sizeGB);
  const memKnown = known(rawMem);

  const mem = usableMemoryGB(hardware);
  const need = requiredMemoryGB(model);
  const verdict = classify(model, hardware);
  const memLabel = hardware.vramGB !== null ? "VRAM" : "RAM";

  // Echo normalized figures — the result is Zod-validated and JSON-serialized,
  // and neither survives NaN or Infinity.
  const normalized: LocalModelInfo = { ...model, sizeGB: sizeKnown ? model.sizeGB : 0 };
  const normalizedHw: HardwareReport = {
    ...hardware,
    ramGB: known(hardware.ramGB) ? hardware.ramGB : 0,
    vramGB: hardware.vramGB === null ? null : known(hardware.vramGB) ? hardware.vramGB : 0,
  };
  const headroomGB = sizeKnown && memKnown ? round2(mem - need) : 0;

  const note = !sizeKnown
    ? `Model size is unknown, so a fit can't be confirmed — treating it as too large. Ask the helper to re-report this model.`
    : !memKnown
      ? `Available ${memLabel} is unknown, so a fit can't be confirmed — treating it as too large.`
      : verdict === "too_large"
        ? `Needs about ${round2(need)} GB but only ${round2(mem)} GB of ${memLabel} is available — it won't load, or will swap badly.`
        : verdict === "overkill"
          ? `Needs about ${round2(need)} GB against ${round2(mem)} GB of ${memLabel}. It will run comfortably, with room for a larger or higher-quality model.`
          : `Needs about ${round2(need)} GB against ${round2(mem)} GB of ${memLabel} — a good match, with ${headroomGB} GB to spare.`;

  return FitResult.parse({
    model: normalized,
    hardware: normalizedHw,
    verdict,
    headroomGB,
    note,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
