"use client";

import { useMemo } from "react";

/**
 * Model picker and routing-decision display (S-06, FR-4.1/4.4/4.11).
 *
 * Manual mode picks a model; auto mode hands the choice to the router and shows
 * what it decided *after* the turn. A degraded decision is flagged visibly —
 * silent degradation is the failure mode E-4.b exists to prevent.
 */

export interface PublicModel {
  id: string;
  provider: string;
  label: string;
  tier: "light" | "standard" | "heavy";
  inputWeight: number;
  outputWeight: number;
  contextWindow: number;
}

export interface FallbackEvent {
  modelId: string;
  trigger: "budget" | "provider_error" | "capability" | "unavailable";
  detail?: string;
}

export interface RoutingDecision {
  mode: "manual" | "auto";
  chosenModelId: string;
  requiredTier: "light" | "standard" | "heavy";
  score: number;
  estCostUsd: number;
  budgetRemaining: number | null;
  degraded: boolean;
  fallbacks: FallbackEvent[];
  reason: string;
}

const TIER_LABEL: Record<PublicModel["tier"], string> = {
  light: "Light",
  standard: "Standard",
  heavy: "Heavy",
};

function usd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`;
}

export function ModelPicker({
  models,
  mode,
  selectedId,
  onModeChange,
  onSelect,
  disabled,
}: {
  models: PublicModel[];
  mode: "manual" | "auto";
  selectedId: string;
  onModeChange: (mode: "manual" | "auto") => void;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  // Grouped by provider so a long list stays readable as more are added.
  const grouped = useMemo(() => {
    const map = new Map<string, PublicModel[]>();
    for (const m of models) {
      const list = map.get(m.provider) ?? [];
      list.push(m);
      map.set(m.provider, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded border border-neutral-700 text-sm">
        {(["manual", "auto"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            disabled={disabled}
            aria-pressed={mode === m}
            className={`px-3 py-1.5 ${
              mode === m ? "bg-neutral-100 text-neutral-900" : "text-neutral-300"
            } disabled:opacity-40`}
          >
            {m === "manual" ? "Manual" : "Auto"}
          </button>
        ))}
      </div>

      {mode === "manual" ? (
        <select
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          disabled={disabled}
          aria-label="Model"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm disabled:opacity-40"
        >
          {grouped.map(([provider, list]) => (
            <optgroup key={provider} label={provider}>
              {list.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {TIER_LABEL[m.tier]} · {usd(m.inputWeight)}/{usd(m.outputWeight)} per 1M
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <span className="text-sm text-neutral-400">
          IDEA picks the cheapest model that can handle each message.
        </span>
      )}
    </div>
  );
}

/** Shown under an assistant turn: which model answered, and why (FR-4.4). */
export function RoutingBadge({
  decision,
  models,
}: {
  decision: RoutingDecision;
  models: PublicModel[];
}) {
  const model = models.find((m) => m.id === decision.chosenModelId);
  const label = model?.label ?? decision.chosenModelId;

  return (
    <div className="mt-2 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-neutral-400">
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-200">{label}</span>
        <span>{decision.mode === "auto" ? "auto-routed" : "you chose this"}</span>
        <span>· est. {usd(decision.estCostUsd)}</span>
        {decision.budgetRemaining !== null && (
          <span>· {usd(decision.budgetRemaining)} left</span>
        )}
      </div>

      {/* Degradation is never silent (E-4.b). */}
      {decision.degraded && (
        <p className="rounded border border-amber-800 bg-amber-950 px-2 py-1 text-amber-200">
          Downgraded: {decision.reason}
        </p>
      )}

      {/* Every skipped model, and which trigger fired (FR-4.11). */}
      {decision.fallbacks.length > 0 && (
        <ul className="text-neutral-500">
          {decision.fallbacks.map((f, i) => (
            <li key={i}>
              skipped {f.modelId} — {f.trigger.replace(/_/g, " ")}
              {f.detail ? `: ${f.detail}` : ""}
            </li>
          ))}
        </ul>
      )}

      {!decision.degraded && (
        <details className="text-neutral-500">
          <summary className="cursor-pointer">Why this model?</summary>
          <p className="mt-1">{decision.reason}</p>
        </details>
      )}
    </div>
  );
}
