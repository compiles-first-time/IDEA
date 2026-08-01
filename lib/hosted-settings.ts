import { z } from "zod";

import { FallbackChain } from "@/lib/fallback";
import { Allocation } from "@/lib/ledger";
import { getRow, upsertRow, type SupabaseConfig } from "@/lib/supabase-store";

/**
 * Per-user routing settings on a hosted deployment (S-51, amends E-15.c).
 *
 * Locally the fallback chain and allocation live in `config/*.json` — one
 * machine, one user, files are right. Hosted, every user gets their own row
 * in the Supabase store, keyed by GitHub login, so one person's chain never
 * becomes everyone's.
 *
 * Stored as one small JSON document. Last write wins — it is one user's own
 * settings page, not a contended log.
 */

const SETTINGS_PATH = "settings/routing.json";

export const HostedSettings = z.object({
  entries: z.array(z.object({ modelId: z.string().min(1) })).default([]),
  allocation: Allocation.omit({ scope: true, projectName: true }).nullable().default(null),
});
export type HostedSettings = z.infer<typeof HostedSettings>;

export async function readHostedSettings(
  cfg: SupabaseConfig,
  login: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HostedSettings | null> {
  const row = await getRow(cfg, login, SETTINGS_PATH, fetchImpl);
  if (!row) return null;
  // A malformed row reads as "no settings" rather than a broken page — the
  // user can simply save again.
  try {
    return HostedSettings.parse(JSON.parse(row.content));
  } catch {
    return null;
  }
}

export async function writeHostedSettings(
  cfg: SupabaseConfig,
  login: string,
  settings: HostedSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await upsertRow(
    cfg,
    login,
    SETTINGS_PATH,
    JSON.stringify(HostedSettings.parse(settings)),
    fetchImpl,
  );
}

/**
 * The user's chain in the shape the router consumes, or undefined when they
 * have not ordered one — undefined keeps auto mode on cost ordering, same as
 * a local install with no `config/routing.json`.
 */
export function chainFromSettings(settings: HostedSettings | null): FallbackChain | undefined {
  if (!settings || settings.entries.length === 0) return undefined;
  return FallbackChain.parse({ scope: "global", entries: settings.entries });
}
