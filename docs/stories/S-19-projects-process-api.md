# S-19 — Projects API: start / stop / status

> **Scope narrowed.** Process control is now the `start` step of the provisioning
> pipeline in [S-29](S-29-provisioning-engine.md), executed by the companion. This story
> retains only **IDEA's thin API surface** over it: the routes the UI calls, which proxy
> to the companion. Do not implement `spawn` here — a Vercel route must not spawn
> anything (E-8.a). If S-29 lands first, this shrinks to a proxy.

**Phase:** 2 · **Workstream:** 6 Projects & Loom · **Status:** Not started
**Component:** C-22 · **Traces to:** FR-7.2, FR-7.4, E-7.a, NFR-2
**Depends on:** S-18 · **Blocks:** S-21

## Goal

Start and stop a project's local dashboard from IDEA's UI, and report whether it's
running. For Loom: `node observatory/server.mjs` → `http://127.0.0.1:4040`.

## Scope

- `POST /api/projects/[name]/start` — spawn `launch` with `cwd = root`, record the pid,
  wait for the dashboard port to answer before returning
- `POST /api/projects/[name]/stop` — kill the recorded pid
- `GET /api/projects/[name]/status` → `ProjectStatus { name, running, pid, dashboardUrl }`

```ts
ProjectStatus = z.object({
  name: z.string(),
  running: z.boolean(),
  pid: z.number().nullable(),
  dashboardUrl: z.string().url(),
});
```

## Acceptance criteria

- [ ] Start spawns the Observatory and returns only once `:4040` responds (or times out
      with a clear error) — no optimistic "started!" that isn't true
- [ ] Stop kills the process; status then reports `running: false`
- [ ] Status is accurate after an IDEA restart — a pid recorded in memory is lost, so
      **probe the port** rather than trusting stored state
- [ ] Starting an already-running project is idempotent, not a double-spawn
- [ ] **On Vercel these routes degrade gracefully** — detect the serverless environment
      and return a clear "process control is a local capability" response instead of
      attempting a spawn (E-7.a)
- [ ] `launch` and `root` come from the validated registry (S-18) — **never** from
      request input. Only the project `name` comes from the URL, and it must resolve
      against the registry.
- [ ] Command injection is impossible: no shell interpolation of user input; spawn with
      an argv array, not a shell string

## Exceptions honored

- **E-7.a** Project dashboards are local. On the deployed app there is no process to
  control — the pane degrades to a link (S-21).
- **NFR-2** Serverless-safe: the *routes* must not assume a process or filesystem
  exists. Process control is explicitly a local-dev / self-hosted capability.
- **NFR-4** Fail closed: an unknown project name is a 404, never a spawn attempt.

## Notes / open questions

- This is the third appearance of the same boundary (S-10, S-16, S-19): **local
  capability, cloud control plane.** Consider a single shared
  `lib/environment.ts` — `isLocalRuntime()` — so all three degrade consistently and
  the UI can ask once.
- Spawned processes don't survive a serverless invocation anyway. Be honest in the
  docs that this feature is for `npm run dev` and self-hosted use.
