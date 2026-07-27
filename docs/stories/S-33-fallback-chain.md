# S-33 — User-ordered fallback chain

**Phase:** 2 · **Workstream:** 2 Router · **Status:** ✅ **Done** (2026-07-26)
**Component:** C-34 · **Traces to:** FR-4.6, FR-4.7, FR-4.8, FR-4.11, E-4.c, E-4.d, E-4.e, NFR-1
**Depends on:** S-04, S-08 · **Blocks:** S-35

## Goal

Let the user decide the **order** models are tried in, rather than having cost decide it
for them. The router still enforces the capability floor and the budget cap — the chain
replaces cost as the *ordering* function, not as a *constraint*.

## Scope

`config/routing.json` + `lib/fallback.ts`:

```ts
FallbackChain = z.object({
  scope: z.enum(["global", "project"]),
  projectName: z.string().optional(),
  entries: z.array(z.object({
    modelId: z.string(),
    maxTier: Tier.optional(),      // optional per-entry ceiling
  })).min(1),
});

FallbackTrigger = z.enum(["budget","provider_error","capability","unavailable"]);

resolveChain(chain, { requiredTier, estTokens, remaining }) → ChainPlan {
  primary: ModelRecord,
  fallbacks: ModelRecord[],        // ordered, already filtered
  skipped: Array<{ modelId, reason: FallbackTrigger }>,
}
```

Resolution is a **pure walk**: for each entry in order, keep it if it meets the
capability floor and fits the remaining allocation; otherwise skip it and record why.

## Acceptance criteria

- [ ] `resolveChain` is pure and deterministic — same chain + same inputs → same plan
- [ ] The chain is walked **in user order**; cost ranking applies only among entries the
      chain leaves unordered (FR-4.7)
- [ ] An entry below the required tier is **skipped, never used** (E-4.e) — tested
- [ ] Every skip records its `FallbackTrigger`, and the reason reaches the user (FR-4.11)
- [ ] Each entry is attempted **at most once per turn** — no loops, no retry storms (E-4.c)
- [ ] An empty or fully-skipped chain has defined behavior: use the highest available
      capable model and say so loudly. Never silently under-serve, never 500.
- [ ] A chain naming a disabled or unknown model id skips that entry with a clear reason
      rather than failing the turn
- [ ] Per-project chains override the global chain; absent a project chain, global applies
- [ ] Unit tests: budget forces the second entry, capability floor skips the first,
      provider error advances one step, all entries skipped
- [ ] No Next.js imports, no model calls (§C, AD-3)

## Exceptions honored

- **E-4.c** Bounded — one attempt per entry per turn.
- **E-4.d** **No mid-stream fallback.** This lib produces a *plan*; S-09 may only act on
  it **before the first token streams**. After that, a failure is surfaced.
- **E-4.e** Capability floor is never bypassed for cost or preference.
- **E-4.a** Still rules, still no classifier.

## Notes

- **The three triggers are genuinely different events** and it's worth not conflating
  them: `budget` walks *down* the cost curve, `provider_error` walks *sideways* to a
  different vendor, `capability` should arguably walk *up*. One ordered list handles all
  three if the semantics are "next acceptable candidate" — but the user's chain will
  usually be cost-descending, which is wrong for `capability`. Decide whether a
  capability shortfall escalates outside the chain, and write the rule down.
- A sensible default chain ships with the product so the feature works before anyone
  configures anything.
