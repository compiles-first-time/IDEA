# IDEA — The Observatory Is the Dashboard

> **Status:** Adopted 2026-07-27. Supersedes the Observatory-as-separate-process
> model in `02`, `06`, `07`, and `08`.
> Precedence, newest first: `10` → `09` → `08` → `07` → `00`–`06`.

**IDEA's dashboard *is* the Loom Observatory.** They are one thing, not two.

```
Wrong (what was built):        Right:
IDEA  ──link──▶  Observatory   IDEA dashboard = the Observatory
                 :4040          reading each project's event log
                 (per project)
```

## The corrected model

| Thing | What it is |
|---|---|
| **Loom** | The framework projects are built on. A repo you clone to start a project. Not a running service. |
| **A project** | Its own repo, seeded from Loom, spun up from IDEA. Writes an event log as it works. |
| **IDEA** | The dashboard over all of them — and that dashboard *is* the Observatory. |

## What was wrong

`06-loom-integration.md` framed Loom's Observatory as a **separate local process**
IDEA would start, stop, and link to on `127.0.0.1:4040`. Everything downstream
inherited that: `ProjectRecord.launch`, `ProjectRecord.dashboardUrl`, the `start`
step in provisioning, `startDashboard`/`stopDashboard`, and an "Observatory"
link button on the projects page.

That was a misreading. The Observatory is not a service each project runs
alongside IDEA — it is **the view**, and IDEA is where views live. Running a
second web server per project to render data IDEA already has access to is
strictly worse: another process to supervise, another port to collide, a
separate UI to keep consistent, and no view *across* projects at all.

## What the Observatory actually is

Read from the real implementation (`observatory/lib/aggregator.mjs`), it is a
**projection over a project's JSONL event log**:

- **Input:** `memory/event-log/YYYY-MM-DD.jsonl` — append-only records the
  project's hooks write as agents work.
- **Process:** 25 event types folded into state.
- **Output:** a 14-section state object — sessions, agents, tasks, cost,
  failures, deploys, compliance, update bus, testing, requirements, kanban,
  activity, reputation, deliberations — served at `/api/state` and streamed over
  SSE.

None of that needs its own process. It needs the log and a projection.

## FR-12 Merged Observatory *(new)*

- **FR-12.1** IDEA's dashboard renders the Observatory projection for a selected
  project.
- **FR-12.2** The projection is built by **reading the project's event log**, not
  by running the project's Observatory server.
- **FR-12.3** The dashboard shows **across projects** as well as within one — a
  view no per-project server could offer.
- **FR-12.4** Live updates without a page reload, since agents write to the log
  while the user watches.
- **FR-12.5** The event-log schema is the **contract** between Loom and IDEA.
  Unknown event types are counted and surfaced, never dropped silently — that is
  how schema drift becomes visible instead of becoming a bug.

### Exceptions

- **E-12.a** IDEA **never imports or executes a project's Observatory code.**
  It reads event logs, which are data. Importing `observatory/lib/aggregator.mjs`
  from a cloned repo would be running repo content in IDEA's process — the same
  thing E-8.c forbids for provisioning, and for the same reason.
- **E-12.b** The projection is **read-only** over the event log. IDEA never
  rewrites a project's history; Rule 22 records are append-only by nature.
- **E-12.c** Redaction applies before display (LR-03). Event logs capture tool
  arguments in cleartext by design, so a secret that reached the log must not
  reach a browser.

## Consequences

| Removed | Replaced by |
|---|---|
| `ProjectRecord.launch` | — nothing to launch |
| `ProjectRecord.dashboardUrl` | IDEA's own `/observatory?project=<name>` |
| Provisioning `start` step | — provisioning ends at `verify` |
| `startDashboard` / `stopDashboard` | — |
| `isDashboardUp` port probe | Project state is `unprovisioned` or `ready` |
| "Observatory" link button | "Open" — an in-app route |
| Project states `running` | Dropped; a project is not a process |

`configPath` stays: `observatory/config.yaml` remains where cost rates live
(S-22), and reading a YAML file was never the problem.

## Why reimplement the projection rather than reuse Loom's

Three reasons, in order of weight:

1. **E-12.a** — importing a cloned repo's JavaScript executes repo content.
2. **Uniformity** — IDEA must render *every* project the same way, including one
   whose Loom version is old, whose `observatory/` was deleted, or which was
   never fully bootstrapped.
3. **Cross-project views** — FR-12.3 is impossible from inside a single project's
   aggregator.

The cost is duplicated projection logic that can drift from Loom's. The
mitigation is that **the event schema, not the code, is the contract** (FR-12.5):
unknown event types are surfaced rather than ignored, so drift shows up in the
UI instead of silently producing a wrong number.

## Component impact

| # | Component | Change |
|---|---|---|
| C-38 | Event-log reader & projection | New — `lib/observatory.ts` |
| C-39 | Observatory dashboard | New — `app/observatory/` |
| C-21 | Project registry | `launch` / `dashboardUrl` removed |
| C-30 | Provisioning | `start` step removed |
| C-31 | Projects page | Link-out replaced with an in-app route |
