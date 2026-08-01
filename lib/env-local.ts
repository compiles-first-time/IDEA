import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Careful single-line edits to `.env.local` (S-52).
 *
 * This file holds the operator's session secret, OAuth wiring, and allowlist —
 * so edits preserve every other line byte-for-byte, the same discipline
 * `lib/provider-keys.ts` applies. Rewriting the file wholesale to change one
 * value is how the other values get lost.
 */

export function envLocalPath(root = process.cwd()): string {
  return join(root, ".env.local");
}

/** Insert or replace `KEY=value`, preserving everything else. */
export async function upsertEnvLocal(
  key: string,
  value: string,
  root = process.cwd(),
): Promise<void> {
  const path = envLocalPath(root);
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const line = `${key}=${value}`;

  const lines = existing.split(/\r?\n/);
  const index = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (index >= 0) lines[index] = line;
  else {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(line);
  }

  await writeFile(path, lines.join("\n").replace(/\n*$/, "\n"), "utf8");
  // Live for this process too, so the change works without a restart.
  process.env[key] = value;
}
