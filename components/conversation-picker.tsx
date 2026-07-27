"use client";

import { useCallback, useState } from "react";

import type { PublicModel } from "@/components/model-picker";

/**
 * Conversation resume (S-32, FR-9.1/9.5/9.6).
 *
 * Where the whole conversation workstream becomes visible: pick a past
 * conversation, see exactly how faithfully it will resume on the model you
 * choose, and continue it — on a different model than it started on.
 *
 * The fidelity banner is the product surface for the accuracy requirement.
 * Everything upstream — canonical format, render adapters, SHA pinning,
 * compaction — exists so this banner can be honest.
 */

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelsUsed: string[];
}

export interface Fidelity {
  level: "full" | "partial";
  pct: number;
  lost: string[];
}

export interface CompactionPlan {
  strategy: "full" | "truncate" | "summarize";
  estTokensBefore: number;
  estTokensAfter: number;
  fidelity: Fidelity;
}

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * What resuming will actually cost you in context.
 *
 * Vague reassurance ("some context may be lost") wastes every guarantee built
 * underneath it, so this says which turns and which files.
 */
export function FidelityBanner({
  plan,
  modelLabel,
}: {
  plan: CompactionPlan;
  modelLabel: string;
}) {
  if (plan.fidelity.level === "full") {
    return (
      <div className="rounded border border-emerald-800 bg-emerald-950 p-3 text-sm text-emerald-200">
        <strong>Full context.</strong> The whole conversation fits in {modelLabel} — nothing is
        left out.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded border border-amber-800 bg-amber-950 p-3 text-sm text-amber-100">
      <p>
        <strong>Some context won&rsquo;t fit {modelLabel}.</strong> Compacted{" "}
        {fmtK(plan.estTokensBefore)} → {fmtK(plan.estTokensAfter)} tokens, keeping{" "}
        {plan.fidelity.pct}%.
      </p>
      <ul className="ml-4 list-disc space-y-0.5 text-amber-200">
        {plan.fidelity.lost.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <p className="text-xs text-amber-300/80">
        The newest turns and your opening message are always kept. This is what the model will
        see — not a guess about how it will behave.
      </p>
    </div>
  );
}

export function ConversationPicker({
  conversations,
  models,
  selectedId,
  plan,
  targetModelId,
  onSelect,
  onTargetModelChange,
  onResume,
  busy,
}: {
  conversations: ConversationMeta[];
  models: PublicModel[];
  selectedId: string | null;
  /** Recomputed whenever the conversation or target model changes. */
  plan: CompactionPlan | null;
  targetModelId: string;
  onSelect: (id: string) => void;
  onTargetModelChange: (id: string) => void;
  onResume: (id: string) => void;
  busy?: boolean;
}) {
  const [filter, setFilter] = useState("");

  const visible = conversations.filter((c) =>
    filter.trim() ? c.title.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  const targetLabel =
    models.find((m) => m.id === targetModelId)?.label ?? targetModelId ?? "this model";

  const resume = useCallback(() => {
    if (selectedId) onResume(selectedId);
  }, [selectedId, onResume]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
      </div>

      {conversations.length === 0 ? (
        <p className="rounded border border-neutral-800 p-6 text-center text-sm text-neutral-400">
          No saved conversations yet. They&rsquo;re stored in this project&rsquo;s repository as you
          chat.
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {visible.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c.id)}
                aria-pressed={selectedId === c.id}
                className={`w-full rounded border p-3 text-left text-sm ${
                  selectedId === c.id
                    ? "border-neutral-400 bg-neutral-800"
                    : "border-neutral-800 hover:border-neutral-700"
                }`}
              >
                <div className="font-medium">{c.title}</div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {when(c.updatedAt)}
                  {c.modelsUsed.length > 0 && <> · {c.modelsUsed.join(", ")}</>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedId && (
        <div className="space-y-3 rounded-lg border border-neutral-800 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Continue on</span>
            <select
              value={targetModelId}
              onChange={(e) => onTargetModelChange(e.target.value)}
              aria-label="Model to resume on"
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Shown before resuming, and recalculated on every model change, so a
              switch that would compact heavily is visible before you commit. */}
          {plan ? (
            <FidelityBanner plan={plan} modelLabel={targetLabel} />
          ) : (
            <p className="text-sm text-neutral-400">Checking what will fit…</p>
          )}

          <button
            onClick={resume}
            disabled={busy || !plan}
            className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
          >
            {busy ? "Resuming…" : "Resume"}
          </button>
        </div>
      )}
    </div>
  );
}
