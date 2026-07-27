# S-37 — The Observatory is the dashboard

**Phase:** 2 · **Workstream:** 9 Observatory · **Status:** ✅ **Done** (2026-07-27)
**Component:** C-38, C-39 · **Traces to:** FR-12.1–12.5, E-12.a–c
**Depends on:** S-18 · **Blocks:** nothing

## Goal

IDEA's dashboard **is** the Loom Observatory. Not a link to one, not a process
per project — the same thing.

## What was wrong

`06-loom-integration.md` framed the Observatory as a separate local server IDEA
would start, stop, and link to on `127.0.0.1:4040`. Everything downstream
inherited that: `ProjectRecord.launch`, `ProjectRecord.dashboardUrl`, a `start`
provisioning step, `startDashboard`/`stopDashboard`, a `running` project state,
and an "Observatory" link button.

That was a misreading of what Loom is. Loom is the **framework projects are built
on** — a repo you clone. The Observatory is **the view**, and IDEA is where views
live. Running a second web server per project to render data IDEA can already
read is strictly worse: another process to supervise, another port to collide, a
separate UI to keep consistent, and no view *across* projects at all.

## What the Observatory actually is

Read from `observatory/lib/aggregator.mjs` in a real checkout: a **projection
over a project's JSONL event log**. 25 event types folded into a state object,
served at `/api/state` and streamed over SSE. It needs the log and a fold — not
a process.

## Outcome

`lib/observatory.ts` (20 tests) + `app/api/observatory/` + `app/observatory/` +
`components/observatory-view.tsx`.

### Data, never code (E-12.a)

IDEA reads event logs. It does **not** import a cloned repo's
`observatory/lib/aggregator.mjs` — that would execute repo content in IDEA's
process, exactly what E-8.c forbids for provisioning. A test greps the module to
prove there is no `import(`, `require(`, `vm.`, or `eval(`.

The cost is a reimplemented projection that can drift from Loom's. The mitigation
is that **the event schema, not the code, is the contract** (FR-12.5): unknown
event types are counted and shown in the UI, so drift becomes visible rather than
silently producing a wrong number.

### Across projects (FR-12.3)

`/observatory` with no project rolls up every registered project — active
sessions, errors, spend, last activity. That view is impossible from inside a
single project's aggregator, and it is the clearest argument that merging was
right.

### Redacted before display (E-12.c)

Loom's hooks capture tool arguments in cleartext by design — that is Rule 22
working. It also means a secret that reached the log must not reach a browser. A
test writes a token into a `destructive_op` command, confirms the raw projection
contains it, and confirms the rendered state does not.

### What the dashboard leads with

Compliance first: destructive operations and production mutations that skipped a
constitution-service check (LR-02). Then sessions, repeat failure signatures
(Rule 10 — a repeat is no longer innocent ignorance), specialists, deploys, and
the activity feed.

### Robustness

A partially-written last line is normal while a session is live, so it is
tolerated. A corrupt line does not lose the rest of the file. A duplicate
`session_start` does not create a second session — logs can be re-read. Reading
is bounded by file count and event count so a large history cannot hang the page.

## Removed

| Gone | Why |
|---|---|
| `ProjectRecord.launch` | Nothing to launch |
| `ProjectRecord.dashboardUrl` | Replaced by an in-app route |
| Provisioning `start` step | Pipeline ends at `verify` |
| `startDashboard` / `stopDashboard` / `isDashboardUp` | No process, no port probe |
| `running` project state | A project is not a process |
| The `DELETE …/provision` stop handler | Nothing to stop |

## Live updates (FR-12.4)

The dashboard streams. `GET /api/observatory/stream?project=` holds an SSE
connection; `lib/observatory-stream.ts` watches `memory/event-log/` and pushes a
fresh projection whenever it changes. There is no refresh button — an agent
writing an event lands on screen on its own.

Four decisions worth recording:

- **Full state per frame, not diffs.** The projection is already bounded by file
  and event caps, so a snapshot is cheap — and a snapshot cannot drift out of
  sync with the client the way an incremental stream can.
- **A poll backs up the watcher.** `fs.watch` misses events on some platforms and
  network drives, and it cannot watch a directory that does not exist yet — a
  project that has never run has no `memory/event-log/`. A 5s poll re-arms the
  watcher and catches what it dropped. It only pushes when the projection
  actually moved (`eventsRead` + newest timestamp), so a quiet project is quiet
  on the wire too.
- **Bursts coalesce.** A 250ms debounce means one save is one update, not one
  frame per appended line. Re-projections never overlap; one triggered mid-flight
  is deferred so frames cannot arrive out of order.
- **The connection state is shown, not hidden.** "Live" / "Connecting…" /
  "Reconnecting…" — `EventSource` retries on its own, and a dashboard that has
  silently stopped updating is worse than one that admits it.

Every exit path releases the watcher and the timers, wired to the request's
abort signal: a closed tab must not leave a file handle and an interval alive for
the life of the process. The watcher is non-persistent so an open dashboard never
keeps `npx idea` from exiting.
