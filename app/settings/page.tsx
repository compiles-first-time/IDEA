import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SettingsClient } from "@/app/settings/settings-client";
import { chainFor, loadRoutingConfig } from "@/lib/fallback";
import { readGlobalAllocation } from "@/lib/allocation-store";
import { isHosted, isSiteOnly } from "@/lib/hosted";
import { readHostedSettings } from "@/lib/hosted-settings";
import { supabaseConfig } from "@/lib/supabase-store";
import { enabledModels, loadRegistry } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (isSiteOnly()) redirect("/");
  const session = await auth();
  if (!session) redirect("/login");

  // Loaded server-side so the page arrives populated — no mount effect.
  const registry = loadRegistry();
  const models = enabledModels(registry).map((m) => ({
    id: m.id,
    provider: m.provider,
    label: m.label,
    tier: m.tier,
    inputWeight: m.inputWeight,
    outputWeight: m.outputWeight,
    contextWindow: m.contextWindow,
  }));
  // Hosted with a store: this user's own settings row (S-51). Hosted without
  // one: empty read-only defaults. Local: the config files, as ever.
  const hosted = isHosted();
  const cfg = hosted ? supabaseConfig() : null;
  const hostedSettings = cfg && session.login ? await readHostedSettings(cfg, session.login) : null;
  const chain = hosted
    ? (hostedSettings?.entries ?? [])
    : (chainFor(loadRoutingConfig())?.entries ?? []);
  const allocation = hosted ? (hostedSettings?.allocation ?? null) : await readGlobalAllocation();

  return (
    <SettingsClient
      models={models}
      initialChain={chain}
      initialAllocation={allocation}
      hosted={hosted}
    />
  );
}
