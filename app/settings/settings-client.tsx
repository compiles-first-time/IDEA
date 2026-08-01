"use client";

import { useCallback } from "react";

import type { PublicModel } from "@/components/model-picker";
import { RoutingSettings, type Allocation, type ChainEntry } from "@/components/routing-settings";

/**
 * Thin client wrapper: the page loads data on the server, this saves it back.
 */
export function SettingsClient({
  models,
  initialChain,
  initialAllocation,
  hosted = false,
}: {
  models: PublicModel[];
  initialChain: ChainEntry[];
  initialAllocation: Allocation | null;
  hosted?: boolean;
}) {
  const onSave = useCallback(async (chain: ChainEntry[], allocation: Allocation | null) => {
    const res = await fetch("/api/routing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: chain, allocation }),
    });
    if (!res.ok) {
      throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    }
  }, []);

  return (
    <RoutingSettings
      models={models}
      initialChain={initialChain}
      initialAllocation={initialAllocation}
      spend={null}
      onSave={onSave}
      hosted={hosted}
    />
  );
}
