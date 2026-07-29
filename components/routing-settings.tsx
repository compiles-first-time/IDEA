"use client";

import { useCallback, useMemo, useState } from "react";

import type { PublicModel } from "@/components/model-picker";
import { ProviderKeysPanel } from "@/components/provider-keys-panel";

/**
 * Routing & budget settings (S-35, FR-4.6/4.9/4.11).
 *
 * Where the fallback order and the money actually get decided. Without this the
 * chain and the allocation are JSON files nobody edits.
 */

export interface ChainEntry {
  modelId: string;
}

export interface Allocation {
  period: "session" | "day" | "month";
  limitUsd: number;
  action: "degrade" | "block";
}

export interface Spend {
  actualUsd: number;
  estimatedUsd: number;
  remainingUsd: number | null;
}

const PERIODS: Allocation["period"][] = ["session", "day", "month"];

function usd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`;
}

export function RoutingSettings({
  models,
  initialChain,
  initialAllocation,
  spend,
  onSave,
}: {
  models: PublicModel[];
  initialChain: ChainEntry[];
  initialAllocation: Allocation | null;
  spend: Spend | null;
  onSave: (chain: ChainEntry[], allocation: Allocation | null) => Promise<void>;
}) {
  const [chain, setChain] = useState<ChainEntry[]>(initialChain);
  const [allocation, setAllocation] = useState<Allocation | null>(initialAllocation);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  /** Entries that can never be selected, flagged rather than silently ignored. */
  const problems = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ modelId: string; why: string }> = [];
    for (const e of chain) {
      if (seen.has(e.modelId)) out.push({ modelId: e.modelId, why: "duplicate — only the first is used" });
      else if (!byId.has(e.modelId)) out.push({ modelId: e.modelId, why: "not in the registry, or disabled" });
      seen.add(e.modelId);
    }
    return out;
  }, [chain, byId]);

  const move = useCallback((from: number, to: number) => {
    setChain((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(chain, allocation);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [chain, allocation, onSave]);

  const unused = models.filter((m) => !chain.some((e) => e.modelId === m.id));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 text-neutral-100">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Routing &amp; budget</h1>
        <p className="text-sm text-neutral-400">
          You decide the order models are tried in. IDEA still refuses a model that can&rsquo;t
          handle the message, or that you can&rsquo;t afford.
        </p>
      </header>

      <ProviderKeysPanel />

      {/* Fallback chain -------------------------------------------------- */}
      <section className="space-y-3 rounded-lg border border-neutral-800 p-4">
        <div>
          <h2 className="text-sm font-medium">Try models in this order</h2>
          <p className="mt-1 text-xs text-neutral-500">
            First one that fits the message and the budget wins.
          </p>
        </div>

        <ol className="space-y-2">
          {chain.map((entry, i) => {
            const model = byId.get(entry.modelId);
            return (
              <li
                key={`${entry.modelId}-${i}`}
                className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2"
              >
                <span className="w-5 text-sm text-neutral-500">{i + 1}</span>
                <span className="flex-1 text-sm">
                  {model?.label ?? entry.modelId}
                  {model && (
                    <span className="ml-2 text-xs text-neutral-500">
                      {model.tier} · {usd(model.inputWeight)}/{usd(model.outputWeight)} per 1M
                    </span>
                  )}
                </span>
                <button
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${entry.modelId} up`}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, i + 1)}
                  disabled={i === chain.length - 1}
                  aria-label={`Move ${entry.modelId} down`}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  onClick={() => {
                    setChain((prev) => prev.filter((_, j) => j !== i));
                    setSaved(false);
                  }}
                  aria-label={`Remove ${entry.modelId}`}
                  className="rounded border border-neutral-700 px-2 py-1 text-xs"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>

        {problems.length > 0 && (
          <ul className="rounded border border-amber-800 bg-amber-950 p-2 text-xs text-amber-200">
            {problems.map((p, i) => (
              <li key={i}>
                {p.modelId}: {p.why}
              </li>
            ))}
          </ul>
        )}

        {unused.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-neutral-500">Add:</span>
            {unused.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setChain((prev) => [...prev, { modelId: m.id }]);
                  setSaved(false);
                }}
                className="rounded border border-neutral-700 px-2 py-1 text-xs"
              >
                + {m.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Budget ----------------------------------------------------------- */}
      <section className="space-y-3 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Spending limit</h2>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={allocation !== null}
              onChange={(e) => {
                setAllocation(
                  e.target.checked ? { period: "day", limitUsd: 5, action: "degrade" } : null,
                );
                setSaved(false);
              }}
            />
            Set a limit
          </label>
        </div>

        {allocation === null ? (
          <p className="text-xs text-neutral-500">No limit — IDEA will use whatever a message needs.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Spend at most</span>
              <span className="text-neutral-400">$</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={allocation.limitUsd}
                onChange={(e) => {
                  setAllocation({ ...allocation, limitUsd: Number(e.target.value) });
                  setSaved(false);
                }}
                aria-label="Spending limit in dollars"
                className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
              />
              <span>per</span>
              <select
                value={allocation.period}
                onChange={(e) => {
                  setAllocation({ ...allocation, period: e.target.value as Allocation["period"] });
                  setSaved(false);
                }}
                aria-label="Budget period"
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
              >
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="space-y-1 text-sm">
              <legend className="text-xs text-neutral-500">When the limit is reached</legend>
              {(
                [
                  ["degrade", "Keep going on the cheapest model that can handle it, and warn me."],
                  ["block", "Stop. Don't send any more messages until the period resets."],
                ] as const
              ).map(([value, description]) => (
                <label key={value} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="at-limit"
                    checked={allocation.action === value}
                    onChange={() => {
                      setAllocation({ ...allocation, action: value });
                      setSaved(false);
                    }}
                    className="mt-1"
                  />
                  <span className="text-neutral-300">{description}</span>
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {spend && (
          <div className="space-y-1 border-t border-neutral-800 pt-3 text-xs text-neutral-400">
            <p>
              Spent so far: <strong className="text-neutral-200">{usd(spend.actualUsd)}</strong>
              {spend.remainingUsd !== null && <> · {usd(spend.remainingUsd)} remaining</>}
            </p>
            {/* Estimate vs actual: a persistent gap means the estimator needs work. */}
            <p>
              Estimated beforehand: {usd(spend.estimatedUsd)}
              {spend.actualUsd > 0 && (
                <> ({Math.round((spend.estimatedUsd / spend.actualUsd) * 100)}% of actual)</>
              )}
            </p>
            {allocation && spend.remainingUsd !== null && spend.remainingUsd < allocation.limitUsd * 0.2 && (
              <p className="text-amber-300">
                You&rsquo;re close to your limit — warning early rather than at the moment it stops.
              </p>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved.</span>}
      </div>
    </div>
  );
}
