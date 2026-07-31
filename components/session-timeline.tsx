"use client";

import { useMemo, useState } from "react";

import { explainEventType, explainRule } from "@/lib/explain";
import { groupIntoSessions, type EventKind, type TimelineEvent } from "@/lib/timeline";

/**
 * What actually happened, in order (FR-13.1).
 *
 * Called a **job** rather than a session: a job is one run of work with a
 * beginning and an end, which is what a person is actually looking for. "Session"
 * is the log's word, not theirs.
 *
 * Every column is labelled, the language is plain, and jargon explains itself on
 * hover — the architect wrote several of these rules and still had to ask what a
 * panel meant. An id is a lookup key, not an explanation.
 */

const KIND_STYLE: Record<EventKind, { dot: string; label: string; blurb: string }> = {
  violation: {
    dot: "bg-red-500",
    label: "Guardrail hit",
    blurb: "Something was tried that the rules did not allow, or a required check was skipped.",
  },
  governance: {
    dot: "bg-sky-400",
    label: "Rule applied",
    blurb: "A rule was consulted and made a decision. This is the guardrail working.",
  },
  agent: { dot: "bg-violet-500", label: "Agent", blurb: "An agent was created, retired, or called." },
  claim: {
    dot: "bg-violet-400",
    label: "Belief stated",
    blurb: "An agent said what it thinks and how sure it is.",
  },
  skill: { dot: "bg-emerald-500", label: "Skill used", blurb: "A written procedure was followed." },
  test: { dot: "bg-teal-500", label: "Test", blurb: "A test ran." },
  tool: { dot: "bg-neutral-600", label: "Ran something", blurb: "A file was read, a command was run." },
  session: { dot: "bg-neutral-500", label: "Job", blurb: "The run started or finished." },
  deploy: { dot: "bg-amber-500", label: "Deploy", blurb: "Something was deployed." },
  cost: { dot: "bg-neutral-500", label: "Tokens", blurb: "Token usage was recorded." },
  other: { dot: "bg-neutral-700", label: "Other", blurb: "Something the dashboard has no name for yet." },
};

const ACTOR_LABEL: Record<TimelineEvent["actor"], string> = {
  agent: "agent",
  model: "the model",
  script: "code",
  system: "Loom",
  unknown: "unknown",
};

function time(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

function day(iso: string | null): string {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function tokens(input: number | null, output: number | null): string {
  // Null means nobody measured. "0" would say it was free.
  if (input === null && output === null) return "not measured";
  return `${(input ?? 0).toLocaleString()} in · ${(output ?? 0).toLocaleString()} out`;
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "attention", label: "Problems only" },
  { key: "governance", label: "Rules & guardrails" },
  { key: "agent", label: "Agents & skills" },
  { key: "tool", label: "Commands & files" },
];

export function SessionTimeline({ timeline }: { timeline: TimelineEvent[] }) {
  const jobs = useMemo(() => groupIntoSessions(timeline), [timeline]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  if (timeline.length === 0) {
    return (
      <section className="rounded-lg border border-neutral-800 p-4">
        <h2 className="mb-1 text-base font-medium">What happened</h2>
        <p className="text-sm text-neutral-400">
          Nothing recorded yet. This fills in as agents work in this project.
        </p>
      </section>
    );
  }

  function keep(e: TimelineEvent): boolean {
    if (query.trim()) {
      const q = query.toLowerCase();
      const hay = [e.what, e.where, e.why, e.rule, e.actorName, e.type].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    switch (filter) {
      case "attention":
        return e.failed || e.kind === "violation";
      case "governance":
        return e.kind === "violation" || e.kind === "governance";
      case "agent":
        return e.kind === "agent" || e.kind === "skill" || e.kind === "claim";
      case "tool":
        return e.kind === "tool";
      default:
        return true;
    }
  }

  return (
    <section className="rounded-lg border border-neutral-800 p-4">
      <div className="mb-3">
        <h2 className="text-base font-medium">What happened</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Each <span className="text-neutral-200">job</span> is one run of work. Open one to see
          every step: who did it, what they did, why, and what it cost. Newest first.
        </p>
      </div>

      {/* Filter + search. Ten thousand events need a way in. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              filter === f.key
                ? "rounded border border-neutral-600 bg-neutral-800 px-2.5 py-1 text-sm text-neutral-100"
                : "rounded border border-neutral-800 px-2.5 py-1 text-sm text-neutral-400 hover:text-neutral-200"
            }
          >
            {f.label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search steps, rules, files…"
          className="ml-auto min-w-[14rem] flex-1 rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-sm outline-none focus:border-neutral-600"
        />
      </div>

      {/* Legend, with what each colour actually means on hover. */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        {(["violation", "governance", "agent", "skill", "test", "tool"] as EventKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5" title={KIND_STYLE[k].blurb}>
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${KIND_STYLE[k].dot}`} />
            {KIND_STYLE[k].label}
          </span>
        ))}
      </div>

      <ul className="space-y-3">
        {jobs.slice(0, 12).map((job, jobIndex) => {
          const expanded = open[job.sessionId] ?? jobIndex === 0;
          const rows = job.events.filter(keep);

          return (
            <li key={job.sessionId} className="rounded border border-neutral-800">
              <button
                onClick={() => setOpen((o) => ({ ...o, [job.sessionId]: !expanded }))}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-neutral-900"
              >
                <span className="w-3 shrink-0 text-neutral-600">{expanded ? "▾" : "▸"}</span>
                <span className="text-sm font-medium text-neutral-200">
                  Job {jobs.length - jobIndex}
                </span>
                <span className="text-sm text-neutral-500">
                  {day(job.startedAt)} at {time(job.startedAt)}
                </span>
                <span
                  className="font-mono text-xs text-neutral-600"
                  title="The log's own id for this run"
                >
                  {job.sessionId.slice(0, 8)}
                </span>

                <span className="ml-auto flex shrink-0 flex-wrap items-center gap-2 text-xs">
                  {job.violations > 0 && (
                    <span className="rounded bg-red-950 px-2 py-0.5 text-red-300">
                      {job.violations} guardrail {job.violations === 1 ? "hit" : "hits"}
                    </span>
                  )}
                  {job.failures > 0 && (
                    <span className="rounded bg-amber-950 px-2 py-0.5 text-amber-300">
                      {job.failures} failed
                    </span>
                  )}
                  <span className="text-neutral-500">{job.events.length} steps</span>
                  <span className="text-neutral-500">{tokens(job.inputTokens, job.outputTokens)}</span>
                </span>
              </button>

              {expanded && (
                <div className="border-t border-neutral-800">
                  {rows.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-neutral-500">
                      Nothing in this job matches the current filter.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      {/* Column headers: the reader should not have to infer
                          which field is which. */}
                      <thead>
                        <tr className="border-b border-neutral-800 text-xs uppercase tracking-wide text-neutral-600">
                          <th className="w-24 px-3 py-1.5 text-left font-medium">When</th>
                          <th className="w-28 px-2 py-1.5 text-left font-medium">Who</th>
                          <th className="px-2 py-1.5 text-left font-medium">What happened</th>
                          <th className="w-28 px-2 py-1.5 text-left font-medium">Rule</th>
                          <th className="w-36 px-3 py-1.5 text-right font-medium">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 200).map((e, i) => {
                          const explained = explainEventType(e.type);
                          const rule = e.rule ? explainRule(e.rule) : null;
                          return (
                            <tr
                              key={i}
                              className={`border-b border-neutral-900 last:border-0 ${
                                e.kind === "violation"
                                  ? "bg-red-950/30"
                                  : e.failed
                                    ? "bg-amber-950/20"
                                    : ""
                              }`}
                            >
                              <td className="px-3 py-2 align-top text-neutral-500">{time(e.at)}</td>
                              <td className="px-2 py-2 align-top text-neutral-400">
                                {e.actorName ?? ACTOR_LABEL[e.actor]}
                              </td>
                              <td className="px-2 py-2 align-top">
                                <span className="flex items-start gap-2">
                                  <span
                                    className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${KIND_STYLE[e.kind].dot}`}
                                    title={KIND_STYLE[e.kind].blurb}
                                  />
                                  <span className="min-w-0">
                                    <span
                                      className={e.failed ? "text-amber-200" : "text-neutral-100"}
                                      title={explained.meaning}
                                    >
                                      {e.what}
                                    </span>
                                    {e.where && (
                                      <span className="ml-1.5 break-all font-mono text-xs text-neutral-500">
                                        {e.where.length > 90 ? `${e.where.slice(0, 90)}…` : e.where}
                                      </span>
                                    )}
                                    {e.why && (
                                      <span className="mt-0.5 block text-xs text-neutral-500">
                                        <span className="text-neutral-600">why: </span>
                                        {e.why.length > 160 ? `${e.why.slice(0, 160)}…` : e.why}
                                      </span>
                                    )}
                                    {explained.meaning && (
                                      <span className="mt-0.5 block text-xs text-neutral-600">
                                        {explained.meaning}
                                      </span>
                                    )}
                                  </span>
                                </span>
                              </td>
                              <td className="px-2 py-2 align-top">
                                {rule && (
                                  <span
                                    className="rounded bg-sky-950 px-1.5 py-0.5 font-mono text-xs text-sky-300"
                                    title={rule.meaning}
                                  >
                                    {rule.label}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right align-top text-xs text-neutral-500">
                                {e.inputTokens !== null || e.outputTokens !== null
                                  ? tokens(e.inputTokens, e.outputTokens)
                                  : ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  {rows.length > 200 && (
                    <p className="px-3 py-1.5 text-xs text-neutral-600">
                      showing the first 200 of {rows.length} matching steps
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
