# S-07 — Cost math & budget cap

**Phase:** 2 · **Workstream:** 2 Router · **Status:** ✅ **Done** (2026-07-26)
**Component:** C-13 · **Traces to:** FR-4.3, FR-4.5, E-4.b, NFR-1, NFR-4
**Depends on:** S-04, S-02 · **Blocks:** S-08

## Goal

Pure, tested cost arithmetic: estimate what a turn will cost in weighted units, and
enforce the per-session budget cap **before any spend** (§6). No model calls, no I/O.

## Scope

`lib/cost.ts`:

- `estimateTokens(text, context?)` — deterministic estimator (chars/4 is fine; document
  the heuristic and its error bars)
- `estimateCostUnits(model, estTokens)` → `model.costWeight * estTokens`
- `checkBudget(spentUnits, capUnits, estCostUnits)` → `{ withinBudget, remaining }`
- Session spend accounting — see open question below

## Acceptance criteria

- [ ] All functions pure: same inputs → same outputs, no clock, no network, no fs
- [ ] Unit tests cover: zero-cost model, missing cap (`null` = unlimited), cap exactly
      hit, cap exceeded, empty prompt, very large context
- [ ] `budgetRemaining` is `null` (not `0`) when no cap is configured — matches
      `RoutingDecision.budgetRemaining: z.number().nullable()`
- [ ] Never throws on unusual input; returns a decision the router can act on
- [ ] No Next.js imports (§C)

## Exceptions honored

- **E-4.b** Auto mode never *silently* exceeds the cap. This lib's job is to report
  `withinBudget: false`; S-08 does the degrade-and-warn.
- **NFR-4 Fail closed.** If cost data for a model is missing or malformed, treat it as
  **expensive**, not free. A missing `costWeight` must not make a model look cheapest.

## Notes

- **Resolved — where session spend lives.** This story originally had to leave it open:
  Phase 1 had no persistence and Vercel is stateless, so the only options were an
  untrusted client total or deferring to Phase 3. Persistence now exists.
  **Spend is derived from the conversation archive** — every stored turn carries its
  `RoutingDecision` and actual usage (AD-7). See
  [S-34](S-34-spend-ledger-and-allocation.md); this story keeps the pure math, S-34 owns
  allocation and the ledger.
- Scope boundary: this story does **pre-flight estimates** only. Recording actual
  provider-reported usage is FR-4.10, in S-34. Keep both — divergence between estimate
  and actual is the signal that this estimator needs tuning.
- **FR-4.5** says cost rates seed from Loom's config. That's **S-22** — this story
  consumes `inputWeight`/`outputWeight` from the registry, wherever they came from.
