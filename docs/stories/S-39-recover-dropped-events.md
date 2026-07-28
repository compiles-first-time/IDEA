# S-39 — Stop dropping 244 real events (rule and ADR attribution)

**Phase:** 3 · **Workstream:** 9 Observatory · **Status:** Not started
**Component:** C-38 · **Traces to:** FR-13.4, E-13.e
**Depends on:** S-37 · **Blocks:** S-40, S-41

## Goal

Eleven event types that Loom actually writes are missing from IDEA's
`KNOWN_EVENT_TYPES`, so the projection files them under `unknownEventTypes` and
shows nothing. Measured across the real logs in `sovereign-forge`, `ravenwise`,
`ripple`, `process-cartographer`, and `loom-template`: **244 events, out of
10,015.**

They are the wrong 244. **Every event carrying a `rule` field is in the dropped
set** — 156 rule attributions (`LR-04` × 111, `ADR-0047` × 45) that IDEA already
receives and discards.

## The dropped types

| Type | Count | Carries `rule` |
|---|---|---|
| `claim` | 52 | — |
| `destructive_actions_attempted` | 47 | ✅ |
| `destructive_action_decision` | 45 | ✅ |
| `runtime_discovery_run` | 45 | — |
| `production_mutation_attempted` | 18 | — |
| `browser_credential_automation_attempted` | 14 | ✅ |
| `observatory_auto_started` | 8 | — |
| `auto_bootstrap_attempted` / `_result` | 12 | — |
| `external_service_setup_attempted` | 2 | ✅ |
| `credentials_attempted` | 1 | ✅ |

## Scope

- Add the eleven types to `KNOWN_EVENT_TYPES` and fold each into state.
- `claim` carries `agent`, `confidence`, `sources`, and `what_would_raise_to_95`
  — the only place agent identity appears today. Surface it: a low-confidence
  claim with no sources is exactly what a reviewer wants to see.
- The four permission-attempt types plus `destructive_action_decision` belong in
  the **compliance** panel next to `constitution_check_missing`, grouped by the
  rule that governed them.
- Show the unknown-type count in the UI (E-13.e). The current failure was not
  that unknowns were uncounted — it was that nobody looked at the count.

## Not in scope

Inventing meaning for fields Loom does not send. If an event lacks a rule, it
shows without one.

## Done when

- All 10,015 events across the five real logs project without landing in
  `unknownEventTypes`.
- `LR-04` and `ADR-0047` appear in the UI with the decisions they governed.
- A synthetic unknown type still counts and still displays, so drift stays visible.
- Tests cover each new type, including one with a missing `rule`.
