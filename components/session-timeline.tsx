"use client";

import { useMemo, useState } from "react";

import { groupIntoSessions, type EventKind, type TimelineEvent } from "@/lib/timeline";

/**
 * What actually happened, in order (FR-13.1).
 *
 * The dashboard's panels answer "how many" — 18 sessions, 67 decisions — which
 * tells you a system is busy, not what it did. This answers the questions that
 * were actually asked: who acted, what they did, where, when, why, and what it
 * cost.
 *
 * Colour carries one meaning only: **how much attention this row deserves**. Red
 * is an attempt the guardrails ruled against; amber is a failure; everything
 * else is muted so the two stand out. A palette where everything is coloured is
 * a palette where nothing is.
 */

const KIND_STYLE: Record<EventKind, { dot: string; label: string }> = {
  violation: { dot: "bg-red-500", label: "guardrail" },
  governance: { dot: "bg-sky-400", label: "governed" },
  session: { dot: "bg-neutral-500", label: "session" },
  tool: { dot: "bg-neutral-600", label: "tool" },
  claim: { dot: "bg-violet-400", label: "claim" },
  agent: { dot: "bg-violet-500", label: "agent" },
  skill: { dot: "bg-emerald-500", label: "skill" },
  test: { dot: "bg-teal-500", label: "test" },
  deploy: { dot: "bg-amber-500", label: "deploy" },
  cost: { dot: "bg-neutral-500", label: "tokens" },
  other: { dot: "bg-neutral-700", label: "other" },
};

const ACTOR_LABEL: Record<TimelineEvent["actor"], string> = {
  agent: "agent",
  model: "model",
  script: "code",
  system: "system",
  unknown: "—",
};

function time(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

function tokens(input: number | null, output: number | null): string {
  // Null means nobody measured. Rendering "0" would say it was free.
  if (input === null && output === null) return "not measured";
  return `${(input ?? 0).toLocaleString()} in · ${(output ?? 0).toLocaleString()} out`;
}

export function SessionTimeline({ timeline }: { timeline: TimelineEvent[] }) {
  const sessions = useMemo(() => groupIntoSessions(timeline), [timeline]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [onlyAttention, setOnlyAttention] = useState(false);

  if (timeline.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 p-4">
        <h2 className="mb-1 text-sm font-medium">What happened</h2>
        <p className="text-sm text-neutral-400">
          Nothing recorded yet. This fills in as agents work.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-800 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">What happened</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Who did what, when, and which rule governed it. Newest session first.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={onlyAttention}
            onChange={(e) => setOnlyAttention(e.target.checked)}
            className="accent-red-500"
          />
          only failures &amp; guardrails
        </label>
      </div>

      {/* One legend, once. A colour you have to hunt for the meaning of is noise. */}
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-500">
        {(["violation", "governance", "agent", "skill", "test", "tool"] as EventKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${KIND_STYLE[k].dot}`} />
            {KIND_STYLE[k].label}
          </span>
        ))}
      </div>

      <ul className="space-y-2">
        {sessions.slice(0, 12).map((s) => {
          const expanded = open[s.sessionId] ?? sessions.indexOf(s) === 0;
          const rows = onlyAttention
            ? s.events.filter((e) => e.failed || e.kind === "violation")
            : s.events;

          return (
            <li key={s.sessionId} className="rounded border border-neutral-800">
              <button
                onClick={() => setOpen((o) => ({ ...o, [s.sessionId]: !expanded }))}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-neutral-900"
              >
                <span className="w-3 shrink-0 text-neutral-600">{expanded ? "▾" : "▸"}</span>
                <span className="font-mono text-neutral-300">{s.sessionId.slice(0, 12)}</span>
                <span className="text-neutral-600">{time(s.startedAt)}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {s.violations > 0 && (
                    <span className="rounded bg-red-950 px-1.5 py-0.5 text-red-300">
                      {s.violations} guardrail
                    </span>
                  )}
                  {s.failures > 0 && (
                    <span className="rounded bg-amber-950 px-1.5 py-0.5 text-amber-300">
                      {s.failures} failed
                    </span>
                  )}
                  <span className="text-neutral-600">{s.events.length} events</span>
                  <span className="text-neutral-600">{tokens(s.inputTokens, s.outputTokens)}</span>
                </span>
              </button>

              {expanded && (
                <div className="border-t border-neutral-800">
                  {rows.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-neutral-600">
                      Nothing in this session failed or hit a guardrail.
                    </p>
                  ) : (
                    <ol>
                      {rows.slice(0, 200).map((e, i) => (
                        <li
                          key={i}
                          className={`flex gap-2 border-b border-neutral-900 px-3 py-1.5 text-xs last:border-0 ${
                            e.kind === "violation"
                              ? "bg-red-950/30"
                              : e.failed
                                ? "bg-amber-950/20"
                                : ""
                          }`}
                        >
                          <span
                            className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${KIND_STYLE[e.kind].dot}`}
                            title={KIND_STYLE[e.kind].label}
                          />
                          <span className="w-16 shrink-0 text-neutral-600">{time(e.at)}</span>
                          <span className="w-14 shrink-0 text-neutral-500">
                            {e.actorName ?? ACTOR_LABEL[e.actor]}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={e.failed ? "text-amber-200" : "text-neutral-200"}>
                              {e.what}
                            </span>
                            {e.where && (
                              <span className="ml-1 font-mono text-[10px] text-neutral-500">
                                {e.where.length > 70 ? `${e.where.slice(0, 70)}…` : e.where}
                              </span>
                            )}
                            {/* WHY lives on its own line — it is the column that
                                was missing, and burying it beside WHAT is how it
                                stayed missing. */}
                            {e.why && (
                              <span className="mt-0.5 block text-[10px] text-neutral-500">
                                why: {e.why.length > 120 ? `${e.why.slice(0, 120)}…` : e.why}
                              </span>
                            )}
                          </span>
                          {e.rule && (
                            <span className="shrink-0 self-start rounded bg-sky-950 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">
                              {e.rule}
                            </span>
                          )}
                          {(e.inputTokens !== null || e.outputTokens !== null) && (
                            <span className="shrink-0 self-start text-[10px] text-neutral-600">
                              {tokens(e.inputTokens, e.outputTokens)}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  {rows.length > 200 && (
                    <p className="px-3 py-1 text-[10px] text-neutral-600">
                      showing the first 200 of {rows.length}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
