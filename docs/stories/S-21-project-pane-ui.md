# S-21 — Project pane UI

> **Superseded by [S-31](S-31-projects-page.md).** The projects page covers everything
> here plus provisioning states and creation. Keep this file for the mixed-content and
> `X-Frame-Options` findings in the notes — they still apply to S-31's Observatory link —
> but build S-31, not this.
>
> **Status: Won't do (folded into S-31).**

**Phase:** 2 · **Workstream:** 6 Projects & Loom · **Status:** Not started
**Component:** C-23 · **Traces to:** FR-7.1, FR-7.2, FR-7.4, E-7.a
**Depends on:** S-19 · **Blocks:** nothing

## Goal

The visible payoff of the projects workstream: a pane in IDEA listing projects, showing
whether each is running, with start/stop controls and a way into the dashboard. Loom
appears here as project #1.

## Scope

- `components/project-pane.tsx`
- List projects from the registry with live `ProjectStatus`
- Start / Stop buttons wired to S-19
- Open the dashboard: link to `http://127.0.0.1:4040` (default), or embed via the S-20
  proxy if that ever lands
- **Degraded state on Vercel:** no start/stop controls; instead, instructions to run
  the Observatory locally plus a link (E-7.a)

## Acceptance criteria

- [ ] Projects list renders from `config/projects.json` via the API — the UI does not
      read the registry file directly (§C)
- [ ] Running / stopped status is accurate and refreshes after start/stop
- [ ] Start shows pending state and doesn't let the user double-click into two spawns
- [ ] A start failure shows the actual reason, not a generic error
- [ ] On the deployed app, the pane shows the link-only degraded state with a clear
      explanation — not broken buttons that 500
- [ ] Does not disturb the Phase-1 chat workspace layout

## Exceptions honored

- **E-7.a** The pane links to a locally-running instance; Vercel doesn't host it.
- **§C** UI calls API routes only — no direct process or filesystem access.

## Notes

- An iframe to `127.0.0.1:4040` from a page served over HTTPS on Vercel will be blocked
  as mixed content, and the Observatory likely sends `X-Frame-Options` anyway. **Plan
  for link-out as the real experience**; treat embedding as a local-dev nicety at most.
  This is the practical reason S-20 is optional.
