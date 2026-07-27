# S-34 — Spend ledger & financial allocation

**Phase:** 2 · **Workstream:** 2 Router · **Status:** ✅ **Done** (2026-07-26)
**Component:** C-35 · **Traces to:** FR-4.9, FR-4.10, FR-4.3, E-4.b, E-4.f, NFR-1, NFR-4
**Depends on:** S-07, S-27 · **Blocks:** S-33 (runtime), S-35

## Goal

Know what has actually been spent, against what was actually allocated. This closes the
open question S-07 had to leave hanging — Phase 1 had no persistence, so there was
nowhere to keep a running total. There is now.

## Scope

`lib/ledger.ts` — allocation config plus derivation from the conversation archive.

```ts
Allocation = z.object({
  scope: z.enum(["global","project"]),
  projectName: z.string().optional(),
  period: z.enum(["session","day","month"]),
  limitUsd: z.number().min(0),
  action: z.enum(["degrade","block"]).default("degrade"),  // at limit
});

SpendRecord = z.object({          // written per assistant turn
  ts: z.string(),
  modelId: z.string(),
  inputTokens: z.number().int(),  // ACTUAL, from the provider response
  outputTokens: z.number().int(), // ACTUAL
  costUsd: z.number(),
  estimatedCostUsd: z.number(),   // what we predicted — keep both, drift is a signal
});

spendInPeriod(records, period, now) → number
remainingAllocation(allocation, records, now) → number | null
```

**No new storage.** Every stored assistant turn already carries its `RoutingDecision`
(AD-7); the `SpendRecord` rides alongside it in the conversation archive (S-27). Spend is
*derived*, not separately maintained — so it can't drift out of sync with reality.

## Acceptance criteria

- [ ] `spendInPeriod` and `remainingAllocation` are **pure** — `now` is a parameter, never
      read from the clock inside (this is what makes them testable)
- [ ] Actual token usage is recorded from the provider response, **not** the estimate (FR-4.10)
- [ ] Estimate and actual are both stored; a large systematic gap is visible, since it
      means S-07's estimator needs tuning
- [ ] Period boundaries are correct and tested: `day` and `month` need an explicit
      timezone decision — pick UTC, write it down, test the boundary
- [ ] `remainingAllocation` returns `null` for "no allocation configured" — never `0`,
      which would read as "exhausted" (matches `RoutingDecision.budgetRemaining`)
- [ ] At the limit, `action: "degrade"` picks the cheapest capable chain entry and warns;
      `action: "block"` refuses the turn with a clear message (E-4.b)
- [ ] **Ledger unreadable → degrade to the cheapest chain entry and warn.** Do not block
      chat, and do not assume unlimited budget (E-4.f) — tested with a simulated failure
- [ ] Reading the ledger doesn't require loading every conversation in full — decide how
      (a rolled-up index file, or metadata-only reads) and note the cost
- [ ] Pure; no Next.js imports (§C)

## Exceptions honored

- **E-4.b** Auto mode never silently exceeds the allocation — it degrades and warns.
- **E-4.f** Unreadable ledger degrades rather than blocking or assuming infinity.
- **NFR-4** Fail closed *in spirit*: on doubt, spend less. Not "refuse everything," which
  would make a slow GitHub response look like an outage.

## Notes / open questions

- **Open: how expensive is deriving spend from the archive?** A month of conversations
  across several projects could be a lot of API reads on every turn. Options: a rolled-up
  `.idea/ledger/<period>.json` updated on write (fast, can drift), or derive-on-read with
  a cache (accurate, slower). **Recommend a roll-up written alongside each turn, with a
  rebuild-from-archive command** — the archive stays the source of truth, so drift is
  always repairable.
- Allocation is in **USD**, not abstract weight units, because that's what a user actually
  budgets in. `inputWeight`/`outputWeight` from S-04 are already USD per 1M tokens
  (seeded from Loom in S-22), so the math is direct.
