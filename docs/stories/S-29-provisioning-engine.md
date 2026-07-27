# S-29 — Companion: provisioning engine

**Phase:** 2 · **Workstream:** 8 Provisioning · **Status:** Not started
**Component:** C-30 (companion) · **Traces to:** FR-8.3, FR-8.4, FR-8.5, FR-8.6, FR-8.7, E-8.a, E-8.c, E-8.d, AD-1
**Depends on:** S-16, S-18 · **Blocks:** S-30, S-31

## Goal

One click sets up a working project. The companion clones the repo, installs
dependencies, runs Loom bootstrap where needed, and starts the Observatory — streaming
progress the whole way.

This is the capability that made the companion mandatory (AD-1, amended).

## Scope

Companion endpoints, extending the S-16 contract:

| Endpoint | Purpose |
|---|---|
| `POST /provision` | Run the pipeline for a project; stream progress |
| `GET /provision/:name/status` | Current step, progress, error |
| `POST /provision/:name/cancel` | Abort mid-run, leave a recoverable state |

Pipeline steps, each independently reported: `clone → install → bootstrap → verify → start`.

```ts
ProvisionStep   = z.enum(["clone","install","bootstrap","verify","start"]);
ProvisionStatus = z.object({
  project: z.string(),
  state: z.enum(["unprovisioned","provisioning","ready","running","error"]),
  step: ProvisionStep.nullable(),
  log: z.array(z.object({ step: ProvisionStep, ok: z.boolean(), detail: z.string() })),
  error: z.string().nullable(),
});
```

## Acceptance criteria

- [ ] Full pipeline succeeds against a real Loom-derived repo end to end
- [ ] **Idempotent** (FR-8.6): re-running on a provisioned project detects the existing
      checkout and skips to `verify`/`start` rather than re-cloning
- [ ] Progress streams per step; the UI can show which step is running right now (FR-8.3)
- [ ] A failed step reports **the actual command output**, not "provisioning failed"
- [ ] Partial failure leaves a recoverable state — re-running resumes rather than
      requiring a manual wipe
- [ ] Cancel actually stops the child process and doesn't orphan it
- [ ] Steps come from the **validated registry**, never from repo content (E-8.c) —
      the companion does not read a script list out of the cloned repo and execute it
- [ ] Spawns use an **argv array, never a shell string** — no interpolation of any
      registry or user value into a shell
- [ ] Clone targets are restricted to the registered `gitUrl`; a `name` from the request
      resolves against the registry or 404s
- [ ] Companion still binds `127.0.0.1` only and requires `IDEA_HELPER_TOKEN` (S-16)

## Exceptions honored

- **E-8.a** All of this runs in the companion. No Vercel route clones, installs, or spawns.
- **E-8.c** Registry-driven steps only.
- **E-8.d** User-initiated, and the command list is shown before it runs.
- **E-5.a** *Unaffected.* A model never selects these commands. Provisioning and
  tool-calling are separate paths — do not let a tool reach the provisioning API.

## Notes

- **Named risk (see `07-amendments.md` §3):** `npm install` runs `postinstall`, and Loom's
  bootstrap runs repo scripts. Provisioning a repo eventually runs that repo's code as the
  user. That is inherent to `git clone && npm install` and can only be bounded, not
  removed. Bounds: registry-listed repos, explicit initiation, visible commands,
  never elevated.
- Requires `git` and `node` on the user's PATH. Check in `verify` and fail with a useful
  message rather than a confusing `ENOENT`.
