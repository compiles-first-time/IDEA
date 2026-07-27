# S-35 — Routing & budget settings UI

**Phase:** 2 · **Workstream:** 2 Router · **Status:** Not started
**Component:** C-36 · **Traces to:** FR-4.6, FR-4.9, FR-4.11, E-4.b
**Depends on:** S-33, S-34 · **Blocks:** nothing

## Goal

Where the user actually **decides the order** and **sets the money**. Without this, the
chain and the allocation are JSON files nobody edits.

## Scope

`components/routing-settings.tsx`:

- **Fallback chain editor** — drag-to-reorder list of models, add/remove entries, global
  or per-project scope
- **Allocation editor** — limit in USD, period (session/day/month), at-limit behavior
  (degrade / block)
- **Live spend** — spent vs allocated for the current period, per project
- **Dry-run preview** — for a given complexity tier, show which model the current chain
  would pick right now and why

## Acceptance criteria

- [ ] Reordering the chain persists and immediately affects the next turn's routing
- [ ] Entries that can never be reached are flagged in the editor — e.g. an entry below
      every plausible capability floor, or one shadowed by an earlier identical model
- [ ] Spend display distinguishes **actual** from **estimated** (S-34 stores both)
- [ ] Approaching the allocation limit warns *before* it's hit, not at the moment of refusal
- [ ] At-limit behavior is explicit and the consequence is spelled out in the UI —
      "degrade" and "block" feel very different in practice and the user should know which
      they've chosen
- [ ] The dry-run preview reflects the real `resolveChain` (S-33), not a UI-side
      reimplementation of the rules — call the API
- [ ] Per-project settings clearly show when they're overriding global
- [ ] Calls API routes only (§C)

## Exceptions honored

- **E-4.b / FR-4.11** Degradation and fallback are visible, never silent. This UI is
  where "visible" is made good on.

## Notes

- **The dry-run preview is the highest-value part.** A fallback chain is hard to reason
  about in the abstract; showing "a heavy prompt right now would go to Sonnet, because
  Opus is over the daily allocation" turns a config file into something a person can
  actually tune. It also exercises the router's `reason` string, which will expose
  whether S-08's explanations are any good.
- Ship a sensible default chain and no allocation limit, so the feature is discoverable
  rather than mandatory.
