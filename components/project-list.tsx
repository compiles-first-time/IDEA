"use client";

import { useCallback, useState } from "react";

/**
 * Projects page (S-31, FR-8.1/8.3/8.5/8.7).
 *
 * Every project as a selectable item, one action to set it up, live per-step
 * progress while it happens, and a clear state for each.
 *
 * Calls API routes only — no filesystem or process access from the browser (§C).
 */

type ProjectState = "unprovisioned" | "provisioning" | "ready" | "error";

interface ProjectStatus {
  name: string;
  state: ProjectState;
  /** In-app route where IDEA renders this project's Observatory (FR-12.1). */
  observatoryPath: string;
}

interface Project {
  name: string;
  title: string;
  gitUrl: string;
  owner: string;
  repo: string;
  seededFrom: string | null;
  status: ProjectStatus;
}

interface StepOutcome {
  step: "clone" | "install" | "bootstrap" | "verify";
  ok: boolean;
  skipped: boolean;
  detail: string;
  durationMs: number;
}

const STEP_LABELS: Record<StepOutcome["step"], string> = {
  clone: "Cloning the repository",
  install: "Installing dependencies",
  bootstrap: "Running Loom bootstrap",
  verify: "Verifying the checkout",
};

const STATE_LABELS: Record<ProjectState, string> = {
  unprovisioned: "Not set up",
  provisioning: "Setting up…",
  ready: "Ready",
  error: "Error",
};

const STATE_STYLES: Record<ProjectState, string> = {
  unprovisioned: "bg-neutral-800 text-neutral-300",
  provisioning: "bg-blue-900 text-blue-200",
  ready: "bg-emerald-900 text-emerald-200",
  error: "bg-red-900 text-red-200",
};

/**
 * The commands provisioning will run, shown before it runs them (E-8.d).
 *
 * Nothing starts a server: IDEA's dashboard is the Observatory.
 */
const PLANNED_COMMANDS = [
  "git clone <repository> projects/<name>",
  "npm install",
  "node scripts/bootstrap.mjs   (if the project has one)",
];

export function ProjectList({ initialProjects }: { initialProjects: Project[] }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepOutcome[]>([]);
  const [confirming, setConfirming] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      setProjects((await res.json()).projects);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Read the NDJSON progress stream so each step appears as it completes. */
  const runProvision = useCallback(
    async (project: Project) => {
      setConfirming(null);
      setBusy(project.name);
      setSteps([]);
      setError(null);

      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(project.name)}/provision`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok || !res.body) {
          throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "step") setSteps((prev) => [...prev, event.step]);
            else if (event.type === "error") setError(event.message);
            else if (event.type === "done" && !event.result.ok) {
              setError(
                `Setup failed at "${event.result.failedAt}". ${
                  event.result.log.find((s: StepOutcome) => !s.ok)?.detail ?? ""
                }`,
              );
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh],
  );

  const createProject = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, isPrivate: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      if (body.notice) setNotice(body.notice);
      setNewName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [newName, refresh]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 text-neutral-100">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-neutral-400">
          Each project is a fresh clone of <code>loom-template</code> that becomes its own
          repository — holding its source, its Loom state, and its conversations.
        </p>
      </header>

      {/* New project ---------------------------------------------------- */}
      <section className="rounded-lg border border-neutral-800 p-4">
        <h2 className="mb-2 text-sm font-medium">New project</h2>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="project-name"
            aria-label="New project name"
            className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <button
            onClick={() => void createProject()}
            disabled={creating || !newName.trim()}
            className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Created private by default — the repository will hold your conversation transcripts.
        </p>
      </section>

      {notice && (
        <p className="rounded border border-amber-800 bg-amber-950 p-3 text-sm text-amber-200">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded border border-red-800 bg-red-950 p-3 text-sm text-red-200">{error}</p>
      )}

      {/* List ------------------------------------------------------------ */}
      {projects.length === 0 ? (
        <p className="rounded border border-neutral-800 p-6 text-center text-sm text-neutral-400">
          No projects yet. Create one above to get started.
        </p>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => {
            const isBusy = busy === p.name;
            const state: ProjectState = isBusy ? "provisioning" : p.status.state;

            return (
              <li key={p.name} className="rounded-lg border border-neutral-800 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">{p.title}</h3>
                      <span className={`rounded px-2 py-0.5 text-xs ${STATE_STYLES[state]}`}>
                        {STATE_LABELS[state]}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-neutral-500">
                      {p.owner}/{p.repo}
                      {p.seededFrom && ` · seeded from ${p.seededFrom}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {state === "unprovisioned" && (
                      <button
                        onClick={() => setConfirming(p)}
                        disabled={busy !== null}
                        className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-40"
                      >
                        Set up
                      </button>
                    )}
                    {/* An in-app route, not a link to another server. */}
                    {state === "ready" && (
                      <a
                        href={p.status.observatoryPath}
                        className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900"
                      >
                        Open
                      </a>
                    )}
                  </div>
                </div>

                {/* Live per-step progress, not an indeterminate spinner. */}
                {isBusy && (
                  <ol className="mt-3 space-y-1 border-t border-neutral-800 pt-3 text-sm">
                    {steps.map((s, i) => (
                      <li key={i} className="flex items-baseline gap-2">
                        <span aria-hidden>{s.skipped ? "–" : s.ok ? "✓" : "✕"}</span>
                        <span className={s.ok ? "text-neutral-300" : "text-red-300"}>
                          {STEP_LABELS[s.step]}
                          {s.skipped && <span className="text-neutral-500"> — {s.detail}</span>}
                        </span>
                      </li>
                    ))}
                    {steps.length < 4 && <li className="text-neutral-500">Working…</li>}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Confirmation: show what will run before running it (E-8.d) ------ */}
      {confirming && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg space-y-4 rounded-lg border border-neutral-700 bg-neutral-900 p-5">
            <h2 className="text-lg font-medium">Set up {confirming.title}?</h2>
            <p className="text-sm text-neutral-400">
              This will run the following on your machine:
            </p>
            <ul className="space-y-1 rounded bg-neutral-950 p-3 font-mono text-xs text-neutral-300">
              {PLANNED_COMMANDS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="text-xs text-neutral-500">
              Installing a repository runs its own setup scripts, the same as{" "}
              <code>git clone &amp;&amp; npm install</code> would.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="rounded border border-neutral-700 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => void runProvision(confirming)}
                className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900"
              >
                Run it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
