import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { fit, type FitResult, type HardwareReport, type LocalModelInfo } from "@/lib/fit";

/**
 * Local model discovery (S-17, FR-6.2/6.3/6.4).
 *
 * With local-first there is no proxy hop and no helper: IDEA reads the user's
 * own Hugging Face cache and any paths they name, then classifies fit with the
 * pure `lib/fit.ts` rules.
 *
 * **E-6.b still holds.** Hardware facts are *reported*, never auto-detected —
 * `os.totalmem()` would tell us installed RAM, not what is usable, and VRAM is
 * not knowable from Node at all. The user supplies the numbers; we do the maths.
 */

export const HF_CACHE_ENV = "HF_HOME";

/** Default Hugging Face cache locations, in the order HF itself checks. */
export function defaultCacheDirs(): string[] {
  const dirs: string[] = [];
  if (process.env[HF_CACHE_ENV]) dirs.push(join(process.env[HF_CACHE_ENV]!, "hub"));
  if (process.env.TRANSFORMERS_CACHE) dirs.push(process.env.TRANSFORMERS_CACHE);
  dirs.push(join(homedir(), ".cache", "huggingface", "hub"));
  // Ollama keeps blobs elsewhere; listed so discovery covers the common setups.
  dirs.push(join(homedir(), ".ollama", "models"));
  return dirs.filter((d, i) => dirs.indexOf(d) === i);
}

const BYTES_PER_GB = 1024 ** 3;

/** Total size of a directory tree, in GB. Bounded so a huge tree can't hang. */
async function dirSizeGB(dir: string, budget = { files: 20_000 }): Promise<number> {
  let bytes = 0;
  const stack = [dir];
  while (stack.length && budget.files > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (budget.files-- <= 0) break;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          bytes += (await stat(full)).size;
        } catch {
          // Vanished mid-scan; ignore.
        }
      }
    }
  }
  return bytes / BYTES_PER_GB;
}

/** `models--meta-llama--Llama-3-8B` → `meta-llama/Llama-3-8B`. */
export function hfRepoIdFromDir(name: string): string {
  return name.startsWith("models--") ? name.slice("models--".length).replace(/--/g, "/") : name;
}

/** Pull a parameter count out of a model name, when it states one. */
export function paramsFromName(name: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])/.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null;
}

/** Pull a quantisation label out of a model name, when it states one. */
export function quantFromName(name: string): string | null {
  const m = /\b(Q\d(?:_[A-Z0-9]+)*|fp16|bf16|fp32|int8|int4|GPTQ|AWQ)\b/i.exec(name);
  return m ? m[1] : null;
}

export async function discoverLocalModels(dirs = defaultCacheDirs()): Promise<LocalModelInfo[]> {
  const found: LocalModelInfo[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      const id = hfRepoIdFromDir(entry.name);
      found.push({
        id,
        paramsB: paramsFromName(entry.name),
        quant: quantFromName(entry.name),
        sizeGB: Math.round((await dirSizeGB(full)) * 100) / 100,
        location: "hf-cache",
      });
    }
  }

  return found.sort((a, b) => a.id.localeCompare(b.id));
}

/* -------------------------------------------------------------------------- */
/* Fit                                                                         */
/* -------------------------------------------------------------------------- */

export const HardwareInput = z.object({
  ramGB: z.number().positive(),
  vramGB: z.number().positive().nullable().default(null),
});

/** Classify every discovered model against the user's reported hardware. */
export function classifyAll(
  models: readonly LocalModelInfo[],
  hardware: HardwareReport,
): FitResult[] {
  return models.map((m) => fit(m, hardware));
}

/** The hardware report, marked as user-supplied — never auto-detected (E-6.b). */
export function userHardware(input: z.infer<typeof HardwareInput>): HardwareReport {
  return { ramGB: input.ramGB, vramGB: input.vramGB, source: "user" };
}

/* -------------------------------------------------------------------------- */
/* Endpoint probing                                                            */
/* -------------------------------------------------------------------------- */

export interface EndpointProbe {
  reachable: boolean;
  detail: string;
  /** Model ids the endpoint reports, when it implements /v1/models. */
  models: string[];
}

/**
 * Is a local OpenAI-compatible server actually there?
 *
 * Answers within a short timeout: a machine that is asleep or an endpoint that
 * was never started should say so immediately, not hang the page.
 */
export async function probeEndpoint(baseUrl: string, timeoutMs = 2000): Promise<EndpointProbe> {
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      return { reachable: false, detail: `${url} responded ${res.status}`, models: [] };
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return {
      reachable: true,
      detail: "endpoint is responding",
      models: (body.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean),
    };
  } catch (e) {
    const why = (e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message;
    return {
      reachable: false,
      detail: `could not reach ${url} — ${why}. Is the server running?`,
      models: [],
    };
  }
}
