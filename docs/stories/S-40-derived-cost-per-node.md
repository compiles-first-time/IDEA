# S-40 — Cost per event, derived rather than read

**Phase:** 3 · **Workstream:** 9 Observatory · **Status:** Not started
**Component:** C-13, C-38 · **Traces to:** FR-13.2, E-13.a
**Depends on:** S-39 · **Blocks:** S-41

## Goal

Show what each step cost. The catch, measured: **no event carries a dollar
figure.** Across 10,015 real events, `estimated_usd` and `cost_usd` appear zero
times. `input_tokens` / `output_tokens` appear 88 times, on `session_token_usage`.

So cost is **computed by IDEA**, not read from the log. IDEA already owns both
halves: rate tables in `config/models.json` and the math in `lib/cost.ts`.

This is the better design anyway. Rates change and get corrected; a recomputed
figure improves when the table does, while a logged one is wrong forever.

## Scope

- Join token counts to the sessions they belong to and compute cost per session.
- Attribute to finer nodes **only where tokens exist for that node**. They do
  not today — `session_token_usage` is per session, not per call.
- Where a node has no token count, show cost as **unknown, never zero** (FR-13.2).
  A free operation and an unmeasured one must not look alike; a graph full of
  `$0.00` reads as "this was cheap" when it means "we did not measure."
- Label every figure an estimate (E-13.a). It is not billing and must not be
  mistaken for it.
- Handle a model id absent from the rate table: unknown, not zero, and name the
  missing id so the table can be fixed.

## Not in scope

Per-call attribution before Loom emits per-call tokens. That is the upstream ask
in `11`'s contract table, and guessing a split across a session's calls would
produce numbers that look precise and are not.

## Done when

- Session cost matches `tokens × rate` for a fixture with known values.
- An unmeasured node renders "unknown", verified by a test that would fail if it
  rendered `$0.00`.
- An unknown model id is reported by name rather than silently costing nothing.
- Rate-table changes move the displayed figure with no change to stored data.
