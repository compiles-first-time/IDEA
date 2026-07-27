import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SettingsClient } from "@/app/settings/settings-client";
import { chainFor, loadRoutingConfig } from "@/lib/fallback";
import { readGlobalAllocation } from "@/lib/allocation-store";
import { enabledModels, loadRegistry } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
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
  const chain = chainFor(loadRoutingConfig())?.entries ?? [];
  const allocation = await readGlobalAllocation();

  return <SettingsClient models={models} initialChain={chain} initialAllocation={allocation} />;
}
