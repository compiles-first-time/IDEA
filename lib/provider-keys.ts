import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

/**
 * Provider API keys (NFR-6).
 *
 * Keys live in `.env.local` and nowhere else. Never in `config/*.json` (read by
 * client-facing routes), never in a conversation, tool argument, or event log,
 * and **never returned by an API route** — not even masked-but-recoverable.
 *
 * The UI sends a key once and gets back only a fingerprint. Re-rendering a
 * stored key into a form field is how keys reach browser history, screenshots,
 * and support tickets.
 */

export const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", env: "ANTHROPIC_API_KEY", prefix: "sk-ant-" },
  { id: "openai", label: "OpenAI-compatible", env: "OPENAI_API_KEY", prefix: "sk-" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export const KeyInput = z.object({
  provider: z.enum(["anthropic", "openai"]),
  // Trimmed because pasted keys routinely carry a trailing newline, and a key
  // that fails only because of whitespace is the worst kind of wrong.
  key: z.string().trim().min(8, "that looks too short to be an API key"),
});

export interface KeyStatus {
  provider: ProviderId;
  label: string;
  env: string;
  configured: boolean;
  /** Last four characters only. Enough to tell two keys apart, useless if leaked. */
  hint: string | null;
}

function envPath(root: string): string {
  return join(root, ".env.local");
}

/** What the UI is allowed to know: whether a key exists, and its last four. */
export async function keyStatuses(
  root = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<KeyStatus[]> {
  const path = envPath(root);
  const text = existsSync(path) ? await readFile(path, "utf8") : "";
  const values = parseEnv(text);

  return PROVIDERS.map((p) => {
    // A key exported in the shell counts as configured too — the file is not
    // the only legitimate source.
    const value = values[p.env] ?? env[p.env] ?? "";
    return {
      provider: p.id,
      label: p.label,
      env: p.env,
      configured: value.length > 0,
      hint: value.length >= 4 ? value.slice(-4) : null,
    };
  });
}

/**
 * Write a key into `.env.local`, replacing any existing value for that variable.
 *
 * Other lines are preserved byte-for-byte: this file holds the user's session
 * secret and allowlist, and rewriting it wholesale to change one value would be
 * a good way to lose them.
 */
export async function saveKey(
  input: z.infer<typeof KeyInput>,
  root = process.cwd(),
): Promise<KeyStatus[]> {
  const provider = PROVIDERS.find((p) => p.id === input.provider);
  if (!provider) throw new Error(`unknown provider: ${input.provider}`);

  const path = envPath(root);
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const line = `${provider.env}=${input.key}`;

  const lines = existing.split(/\r?\n/);
  const index = lines.findIndex((l) => l.startsWith(`${provider.env}=`));
  if (index >= 0) lines[index] = line;
  else {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(line);
  }

  await writeFile(path, lines.join("\n").replace(/\n*$/, "\n"), "utf8");
  // Make it live for this process too, so the key works without a restart.
  process.env[provider.env] = input.key;

  return keyStatuses(root);
}

/** Minimal `KEY=value` reader — enough for our own file, no interpolation. */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}
