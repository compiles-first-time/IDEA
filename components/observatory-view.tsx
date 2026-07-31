"use client";

import { useEffect, useState } from "react";

/**
 * The Observatory (S-37, FR-12).
 *
 * This *is* IDEA's dashboard — not a link to a separate server. It renders the
 * projection over a project's event log, and rolls up across projects.
 */

interface SessionSummary {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  toolCalls: number;
  errors: number;
  lastTool: string | null;
}

interface ActivityItem {
  at: string | null;
  kind: string;
  detail: string;
}

export interface ObservatoryState {
  project: string;
  sessions: { active: SessionSummary[]; history: SessionSummary[] };
  cost: { inputTokens: number; outputTokens: number; estimatedUsd: number };
  failures: {
    errors: Array<{ at: string | null; tool: string | null; preview: string | null }>;
    signatures: Record<string, number>;
  };
  compliance: {
    destructiveOps: Array<{ at: string | null; detail: string }>;
    constitutionChecksMissing: number;
    byRule: Record<
      string,
      {
        count: number;
        decisions: Array<{
          at: string | null;
          eventType: string;
          decision: string | null;
          detail: string | null;
        }>;
      }
    >;
    attempts: Array<{
      at: string | null;
      eventType: string;
      rule: string | null;
      decision: string | null;
      detail: string | null;
    }>;
  };
  claims: Array<{
    at: string | null;
    agent: string | null;
    claim: string | null;
    confidence: string | null;
    sources: number;
    whatWouldRaise: string | null;
  }>;
  skills: Record<string, { count: number; agents: string[] }>;
  agentEdges: Array<{ parent: string; child: string; at: string | null }>;
  turns: Array<{ at: string | null; sessionId: string | null; turnIndex: number; inputTokens: number; outputTokens: number; model: string | null; tools: string[] }>;
  executionKinds: Record<string, number>;
  agents: { spawned: string[]; retired: string[] };
  deploys: { history: Array<{ at: string | null; status: string; detail: string }> };
  testing: { lastRun: string | null; passed: number; failed: number };
  tickets: Array<{ id: string; state: string; title: string }>;
  activity: ActivityItem[];
  unknownEventTypes: Record<string, number>;
  meta: { eventsRead: number; filesRead: number; newestEventAt: string | null; hasEventLog: boolean };
}

export interface CrossProjectSummary {
  projects: Array<{
    name: string;
    activeSessions: number;
    totalSessions: number;
    errors: number;
    estimatedUsd: number;
    lastActivityAt: string | null;
    hasEventLog: boolean;
  }>;
  totals: { activeSessions: number; errors: number; estimatedUsd: number };
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Money, or an honest admission that we have none.
 *
 * `measured` says whether any cost signal existed at all. Without it a project
 * whose log contains no token data rendered as **"$0.00"**, which reads as "this
 * was free" when it means "we never measured". That is the single defect this
 * dashboard keeps reproducing, and it is worse than showing nothing: a confident
 * zero stops you looking.
 */
function usd(n: number, measured = true): string {
  if (!measured) return "not measured";
  return n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-neutral-100";
  return (
    <div className="rounded-lg border border-neutral-800 p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-medium ${color}`}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Across projects                                                             */
/* -------------------------------------------------------------------------- */

export function CrossProjectView({ summary }: { summary: CrossProjectSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Active sessions" value={String(summary.totals.activeSessions)} />
        <Stat
          label="Errors"
          value={String(summary.totals.errors)}
          tone={summary.totals.errors > 0 ? "warn" : undefined}
        />
        <Stat label="Spent" value={usd(summary.totals.estimatedUsd)} />
      </div>

      <Panel title="Projects">
        {summary.projects.length === 0 ? (
          <p className="text-sm text-neutral-400">No projects registered yet.</p>
        ) : (
          <ul className="space-y-2">
            {summary.projects.map((p) => (
              <li key={p.name}>
                <a
                  href={`/observatory?project=${encodeURIComponent(p.name)}`}
                  className="flex items-center justify-between rounded border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-700"
                >
                  <span>
                    {p.name}
                    {!p.hasEventLog && (
                      <span className="ml-2 text-xs text-neutral-500">no activity yet</span>
                    )}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {p.totalSessions} sessions · {p.errors} errors · {usd(p.estimatedUsd)} ·{" "}
                    {when(p.lastActivityAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One project                                                                 */
/* -------------------------------------------------------------------------- */

type Connection = "connecting" | "live" | "reconnecting";

/**
 * Subscribe to the live projection.
 *
 * `EventSource` reconnects on its own, so this only has to track *whether* it is
 * connected in order to say so honestly — a dashboard that has silently stopped
 * updating is worse than one that admits it.
 */
function useLiveState(initial: ObservatoryState) {
  const [state, setState] = useState(initial);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  useEffect(() => {
    const source = new EventSource(
      `/api/observatory/stream?project=${encodeURIComponent(initial.project)}`,
    );

    source.addEventListener("state", (e) => {
      setState(JSON.parse((e as MessageEvent).data));
      setConnection("live");
      setLastUpdate(Date.now());
    });
    source.addEventListener("ping", () => setConnection("live"));
    source.addEventListener("open", () => setConnection("live"));
    source.addEventListener("error", () => {
      // EventSource retries by itself; say so rather than showing a dead page.
      setConnection("reconnecting");
    });

    return () => source.close();
  }, [initial.project]);

  return { state, connection, lastUpdate };
}

/**
 * Which rule governed which decision — and the reverse (FR-13.4).
 *
 * This data was always being emitted; IDEA discarded it because the events
 * carrying it were not in the known-type list. Every `LR-*` / `ADR-*` here is a
 * real governance decision, recovered rather than invented.
 */
function RuleTrace({ compliance }: { compliance: ObservatoryState["compliance"] }) {
  const rules = Object.entries(compliance.byRule).sort((a, b) => b[1].count - a[1].count);
  const ungoverned = compliance.attempts.filter((a) => !a.rule);

  if (rules.length === 0 && ungoverned.length === 0) return null;

  return (
    <Panel title="Governance — rules applied">
      {rules.length > 0 && (
        <ul className="space-y-2">
          {rules.map(([rule, entry]) => (
            <li key={rule} className="rounded border border-neutral-800 p-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-sm text-sky-300">{rule}</span>
                <span className="text-xs text-neutral-500">
                  {entry.count} decision{entry.count === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {entry.decisions.slice(-4).map((d, i) => (
                  <li key={i} className="flex justify-between gap-3 text-xs text-neutral-400">
                    <span className="truncate">
                      {d.eventType.replace(/_/g, " ")}
                      {d.decision && <span className="text-neutral-200"> → {d.decision}</span>}
                      {d.detail && <span className="ml-1 font-mono text-neutral-500">{d.detail}</span>}
                    </span>
                    <span className="shrink-0 text-neutral-600">{when(d.at)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {ungoverned.length > 0 && (
        // An action that cited no rule is the more alarming case, not the less.
        <p className="mt-2 rounded border border-amber-800 bg-amber-950 px-2 py-1 text-xs text-amber-200">
          {ungoverned.length} permission attempt{ungoverned.length === 1 ? "" : "s"} cited no rule.
        </p>
      )}
    </Panel>
  );
}

/**
 * Claims — the only place agent identity appears in the log today.
 *
 * A low-confidence claim with no sources is precisely what a reviewer wants
 * surfaced, so sources are shown even (especially) when the count is zero.
 */
function ClaimsPanel({ claims }: { claims: ObservatoryState["claims"] }) {
  if (claims.length === 0) return null;

  return (
    <Panel title="Claims">
      <ul className="space-y-2">
        {claims.slice(-8).reverse().map((c, i) => (
          <li key={i} className="rounded border border-neutral-800 p-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-neutral-200">
                {c.agent && <span className="font-mono text-xs text-violet-300">{c.agent} </span>}
                {c.claim ?? "—"}
              </span>
              <span className="shrink-0 text-xs text-neutral-500">{when(c.at)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs">
              {c.confidence && (
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  confidence: {c.confidence}
                </span>
              )}
              <span
                className={
                  c.sources === 0
                    ? "rounded bg-amber-950 px-1.5 py-0.5 text-amber-300"
                    : "rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400"
                }
              >
                {c.sources} source{c.sources === 1 ? "" : "s"}
              </span>
            </div>
            {c.whatWouldRaise && (
              <p className="mt-1 text-xs text-neutral-500">
                would raise to 95%: {c.whatWouldRaise}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * The provenance maps: agent → skill, agent → agent, and code vs inference.
 *
 * Each renders only when its data exists. Before `loom-template`'s 2026-07-28
 * instrumentation these fields were measured at **zero occurrences**, so an
 * empty panel here means "not instrumented yet", not "nothing happened" — and
 * an empty box saying nothing is the honest rendering of that.
 */
function ProvenanceMaps({ state }: { state: ObservatoryState }) {
  const skills = Object.entries(state.skills).sort((a, b) => b[1].count - a[1].count);
  const kinds = Object.entries(state.executionKinds).sort((a, b) => b[1] - a[1]);
  const totalKinds = kinds.reduce((n, [, c]) => n + c, 0);

  if (skills.length === 0 && state.agentEdges.length === 0 && totalKinds === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {skills.length > 0 && (
        <Panel title="Skills used">
          <ul className="space-y-1">
            {skills.map(([skill, entry]) => (
              <li key={skill} className="flex justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-emerald-300">/{skill}</span>
                <span className="text-xs text-neutral-500">
                  {entry.count}× · {entry.agents.join(", ") || "unattributed"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {state.agentEdges.length > 0 && (
        <Panel title="Agent → agent">
          <ul className="space-y-1">
            {state.agentEdges.slice(-10).reverse().map((e, i) => (
              <li key={i} className="flex justify-between gap-3 text-sm">
                <span className="font-mono text-xs">
                  <span className="text-neutral-400">{e.parent}</span>
                  <span className="mx-1 text-neutral-600">→</span>
                  <span className="text-violet-300">{e.child}</span>
                </span>
                <span className="text-xs text-neutral-600">{when(e.at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {totalKinds > 0 && (
        <Panel title="Code vs inference">
          <ul className="space-y-1">
            {kinds.map(([kind, count]) => (
              <li key={kind} className="flex justify-between gap-3 text-sm">
                <span
                  className={
                    kind === "deterministic"
                      ? "text-sky-300"
                      : kind === "model"
                        ? "text-amber-300"
                        : "text-neutral-500"
                  }
                >
                  {kind === "deterministic"
                    ? "traditional code"
                    : kind === "model"
                      ? "inference"
                      : "unknown"}
                </span>
                <span className="text-xs text-neutral-500">
                  {count} ({Math.round((count / totalKinds) * 100)}%)
                </span>
              </li>
            ))}
          </ul>
          {/* "unknown" is a real answer, not a rounding error — older events
              predate the field, and MCP tools cannot be classified from here. */}
          <p className="mt-2 text-xs text-neutral-600">
            Unknown means the step predates the instrumentation or runs on an
            external MCP server — not that it was free.
          </p>
        </Panel>
      )}
    </div>
  );
}

export function ObservatoryView({ initial }: { initial: ObservatoryState }) {
  const { state, connection, lastUpdate } = useLiveState(initial);
  const unknown = Object.entries(state.unknownEventTypes);

  if (!state.meta.hasEventLog) {
    return (
      <div className="space-y-4">
        <Header project={state.project} connection={connection} lastUpdate={lastUpdate} />
        <p className="rounded border border-neutral-800 p-6 text-center text-sm text-neutral-400">
          Nothing recorded yet. This project writes to{" "}
          <code className="text-neutral-300">memory/event-log/</code> as agents work — run a
          session and it will appear here, live.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header project={state.project} connection={connection} lastUpdate={lastUpdate} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active sessions" value={String(state.sessions.active.length)} />
        <Stat
          label="Errors"
          value={String(state.failures.errors.length)}
          tone={state.failures.errors.length > 0 ? "warn" : undefined}
        />
        {/* Tokens are logged; dollars are not (measured: estimated_usd appears
            zero times in ~10,015 real events). Cost is derived, so if no tokens
            were recorded there is nothing to derive from — say so. */}
        <Stat
          label="Spent"
          value={usd(
            state.cost.estimatedUsd,
            state.cost.inputTokens > 0 || state.cost.outputTokens > 0,
          )}
        />
        <Stat
          label="Tests"
          value={`${state.testing.passed} / ${state.testing.passed + state.testing.failed}`}
          tone={state.testing.failed > 0 ? "bad" : undefined}
        />
      </div>

      {/* Compliance first — Rule 20 and LR-04 breaches are what you want to see. */}
      {(state.compliance.destructiveOps.length > 0 ||
        state.compliance.constitutionChecksMissing > 0) && (
        <Panel title="Compliance">
          {state.compliance.constitutionChecksMissing > 0 && (
            <p className="mb-2 rounded border border-amber-800 bg-amber-950 px-2 py-1 text-sm text-amber-200">
              {state.compliance.constitutionChecksMissing} production mutation
              {state.compliance.constitutionChecksMissing === 1 ? "" : "s"} without a
              constitution-service check (LR-02).
            </p>
          )}
          <ul className="space-y-1 text-sm text-neutral-300">
            {state.compliance.destructiveOps.slice(0, 10).map((op, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate font-mono text-xs">{op.detail}</span>
                <span className="shrink-0 text-xs text-neutral-500">{when(op.at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Traceability: which rule governed which decision (FR-13.4). */}
      <RuleTrace compliance={state.compliance} />

      <ProvenanceMaps state={state} />

      <ClaimsPanel claims={state.claims} />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Sessions">
          {state.sessions.active.length === 0 && state.sessions.history.length === 0 ? (
            <p className="text-sm text-neutral-400">No sessions recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {[...state.sessions.active, ...state.sessions.history].slice(0, 12).map((s) => (
                <li key={s.sessionId} className="flex justify-between gap-3">
                  <span className="truncate">
                    {!s.endedAt && <span className="mr-1 text-emerald-400">●</span>}
                    {s.sessionId.slice(0, 8)}
                    {s.lastTool && <span className="ml-2 text-neutral-500">{s.lastTool}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {s.toolCalls} calls
                    {s.errors > 0 && <span className="text-amber-400"> · {s.errors} err</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Repeat failures">
          {Object.keys(state.failures.signatures).length === 0 ? (
            <p className="text-sm text-neutral-400">No repeated errors.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {Object.entries(state.failures.signatures)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 8)
                .map(([sig, count]) => (
                  <li key={sig} className="flex justify-between gap-3">
                    <span className="truncate font-mono text-xs">{sig}</span>
                    <span className="shrink-0 text-xs text-amber-400">×{count}</span>
                  </li>
                ))}
            </ul>
          )}
          {/* Rule 10: a repeat is no longer innocent ignorance. */}
          <p className="mt-2 text-xs text-neutral-500">
            A signature seen more than once is worth a lesson — ignorance is a one-time
            defence.
          </p>
        </Panel>

        {state.agents.spawned.length > 0 && (
          <Panel title="Specialists">
            <div className="flex flex-wrap gap-1">
              {state.agents.spawned.map((a) => (
                <span key={a} className="rounded bg-neutral-800 px-2 py-0.5 text-xs">
                  {a}
                </span>
              ))}
            </div>
          </Panel>
        )}

        {state.deploys.history.length > 0 && (
          <Panel title="Deploys">
            <ul className="space-y-1 text-sm">
              {state.deploys.history.slice(-6).reverse().map((d, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="truncate">{d.detail}</span>
                  <span
                    className={`shrink-0 text-xs ${
                      d.status === "non_progressing" ? "text-amber-400" : "text-neutral-500"
                    }`}
                  >
                    {d.status}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <Panel title="Activity">
        {state.activity.length === 0 ? (
          <p className="text-sm text-neutral-400">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {state.activity.slice(0, 25).map((a, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-36 shrink-0 text-xs text-neutral-500">{when(a.at)}</span>
                <span className="w-24 shrink-0 text-xs text-neutral-400">{a.kind}</span>
                <span className="truncate">{a.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* FR-12.5 — schema drift is surfaced, never silently dropped. */}
      {unknown.length > 0 && (
        <Panel title="Unrecognised events">
          <p className="mb-2 text-xs text-neutral-500">
            This project logs event types IDEA doesn&rsquo;t know how to project yet. Shown so
            drift is visible rather than silently producing a wrong number.
          </p>
          <ul className="space-y-1 text-sm">
            {unknown.map(([type, count]) => (
              <li key={type} className="flex justify-between gap-3">
                <span className="font-mono text-xs">{type}</span>
                <span className="text-xs text-neutral-500">×{count}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="text-xs text-neutral-600">
        {state.meta.eventsRead.toLocaleString()} events from {state.meta.filesRead} log file
        {state.meta.filesRead === 1 ? "" : "s"} · newest {when(state.meta.newestEventAt)}
      </p>
    </div>
  );
}

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

const CONNECTION_STYLE: Record<Connection, string> = {
  connecting: "text-neutral-500",
  live: "text-emerald-400",
  reconnecting: "text-amber-400",
};

function Header({
  project,
  connection,
  lastUpdate,
}: {
  project: string;
  connection: Connection;
  lastUpdate: number | null;
}) {
  return (
    <header className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{project}</h1>
        <p className="text-sm text-neutral-400">
          Observatory — projected live from this project&rsquo;s event log.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className={`flex items-center gap-1.5 text-xs ${CONNECTION_STYLE[connection]}`}>
          <span aria-hidden>{connection === "live" ? "●" : "○"}</span>
          {CONNECTION_LABEL[connection]}
          {connection === "live" && lastUpdate && (
            <span className="text-neutral-600">
              · updated {new Date(lastUpdate).toLocaleTimeString()}
            </span>
          )}
        </span>
        <a href="/observatory" className="rounded border border-neutral-700 px-3 py-1.5 text-sm">
          All projects
        </a>
      </div>
    </header>
  );
}
