# S-08 — Complexity scorer & model selector

**Phase:** 2 · **Workstream:** 2 Router · **Status:** Not started
**Component:** C-12 · **Traces to:** FR-4.2, FR-4.3, FR-4.4, E-4.a, AD-3, NFR-1, NFR-5
**Depends on:** S-04, S-07 · **Blocks:** S-09

## Goal

The heart of the product: given a prompt + context, deterministically decide which model
should answer. Rule-based, inspectable, explainable. **No ML classifier** (E-4.a).

## Scope

`lib/router.ts`:

```ts
scoreComplexity(prompt, context?) → { score, signals, requiredTier }
selectModel({ requiredTier, score, estTokens, budget }) → RoutingDecision
```

Signals (per `04-process-flows.md` PF-4 and the `ComplexitySignals` contract):

| Signal | Source |
|---|---|
| `tokens` | length of prompt + context |
| `codeFences` | count of ``` blocks |
| `fileCount` | number of repo files in context |
| `reasoningKeywords` | "why", "design", "trade-off", "prove", "refactor", … |
| `needsTools` | skill/agent invocation requested |

Weighted sum → `score` → threshold into `light | standard | heavy`.
Then: candidates where `model.tier >= requiredTier` → order them → pick the first that
fits the allocation, else **degrade and set `degraded: true`** with a warning `reason`.

> **Ordering changed.** The original spec ranked candidates purely by
> `costWeight * estTokens`. The user's **fallback chain** is now the ordering function
> (FR-4.7) — cost ranking applies only where the chain is silent. Capability floor and
> allocation remain filters either way. Build `selectModel` so the ordering function is
> **injected**, not hard-coded, and S-33 slots in without a rewrite.

## Acceptance criteria

- [ ] `scoreComplexity` is pure and total — never throws, handles empty/huge input
- [ ] Every weight and threshold is a **named exported constant**, not a magic number
      inline. They will be tuned; make tuning a one-line diff.
- [ ] `selectModel` returns a full `RoutingDecision` including a human-readable `reason`
      that names the signals that drove the tier
- [ ] Degrade path sets `degraded: true` and explains why in `reason` (E-4.b)
- [ ] No enabled model at or above the required tier → defined, tested behavior
      (use the highest available tier and say so — do **not** silently under-serve)
- [ ] Unit tests: a trivial one-liner routes `light`; a multi-file refactor with code
      fences routes `heavy`; identical input routes identically every time; budget
      pressure forces the degrade path
- [ ] Zero model calls in this file (AD-3) — grep it to be sure

## Exceptions honored

- **E-4.a** No trained classifier. Heuristics and rules only.
- **E-4.b** Budget cap degrades and warns; never silently overspends.
- **NFR-1** Pure and unit-tested.
- **NFR-5** The emitted `RoutingDecision` is the observability record — it must contain
  enough to reconstruct the decision after the fact (score, signals, tier, reason).

## Notes / open questions

- Tuning the weights is expected and iterative. Ship defensible defaults, write the
  tests, then tune against real prompts once S-09 is live.
- Open: does `needsTools` come from the request (user invoked a skill) or from
  inspecting the prompt? Recommend **from the request** — it's a fact, not a guess,
  and guessing it with a heuristic invites false positives that inflate cost.
