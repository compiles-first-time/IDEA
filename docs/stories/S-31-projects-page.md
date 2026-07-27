# S-31 — Projects page

**Phase:** 2 · **Workstream:** 8 Provisioning · **Status:** 🔓 Unblocked by [08-local-first](../architecture/08-local-first.md) — no companion hop
**Component:** C-31 · **Traces to:** FR-8.1, FR-8.3, FR-8.5, FR-8.7, E-8.d, E-7.a
**Depends on:** S-29, S-30 · **Blocks:** nothing

## Goal

The page you actually asked for: every Loom project as a selectable item, one click to
set it up, live progress while it happens, and a clear state for each.

Supersedes the narrower [S-21](S-21-project-pane-ui.md) project pane.

## Scope

`app/projects/page.tsx` + `components/project-list.tsx`:

- Grid or list of projects with state badges:
  `unprovisioned · provisioning · ready · running · error`
- **New project** action → S-30
- Select an unprovisioned project → confirmation showing **what will run** → S-29
- Live per-step progress (`clone → install → bootstrap → verify → start`)
- Ready projects: Open chat · Open Observatory · Stop
- Error projects: the real error, and a retry that resumes

## Acceptance criteria

- [ ] Every registered project renders with accurate live state
- [ ] Provisioning shows the current step and streams output — no indeterminate spinner
      sitting on "Setting up…" (FR-8.3)
- [ ] The confirmation step lists the commands before running them (E-8.d)
- [ ] An error shows the failing step and its actual output, with a working retry
- [ ] **Companion not running → the page says so plainly** and explains how to start it,
      rather than showing every project as broken. This is the most common state for a
      new user and it must not look like a bug.
- [ ] Chat still works with the companion down — conversations go through the GitHub API
      (S-27), so a project can be chatted with even when unprovisioned. Reflect that:
      don't gate chat behind provisioning.
- [ ] Observatory opens as a link to `127.0.0.1:4040` (E-7.a)
- [ ] Calls API routes only — no direct process or filesystem access (§C)

## Exceptions honored

- **E-8.d** User-initiated, commands shown first.
- **E-7.a** Observatory is local; link out rather than embed (see S-21 notes on mixed
  content and `X-Frame-Options`).

## Notes

- **The two capability tiers must be legible.** Conversations and chat work from
  anywhere via the GitHub API; provisioning and the Observatory need the companion.
  A user should never wonder why half the page works. Say it in the UI, once, clearly.
- Consider a persistent companion-status indicator in the app shell rather than
  per-project error states — one honest signal beats six confusing ones.
