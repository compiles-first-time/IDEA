# S-28 — Compaction & fidelity reporting

**Phase:** 2 · **Workstream:** 7 Conversations · **Status:** Not started
**Component:** C-29 · **Traces to:** FR-9.6, E-9.b, NFR-1, NFR-5
**Depends on:** S-23, S-27 · **Blocks:** S-32

## Goal

**Layer 4** — the only layer where fidelity is genuinely lost, and therefore the only
place the "99%" number actually lives. A 400k-token conversation cannot enter an 8k-context
model. That's arithmetic, not engineering. What we control is whether the loss is
deliberate, measured, and visible — or silent.

## Scope

`lib/compact.ts` — deterministic planning, plus an optional model-assisted summary step.

```ts
planFit(turns, targetModel) → FitPlan {
  strategy: "full" | "truncate" | "summarize",
  keptTurns, droppedTurns, summarizedTurns,
  estTokensBefore, estTokensAfter,
  fidelity: { level: "full" | "partial", pct: number, lost: string[] },
}
```

Rules, in order:
1. Fits → `full`, nothing touched
2. Doesn't fit → always keep the **system prompt, the first user turn, and the most
   recent N turns verbatim**; compact the middle
3. Never split a `tool_call` from its `tool_result` — drop or keep the pair together
4. Never drop a `repo_context` part without recording that it was dropped

Report the result to the user: *"Resumed on Haiku — compacted 340k → 7k, 12 turns
summarized, 2 file contexts dropped."*

## Acceptance criteria

- [ ] `planFit` is **pure and deterministic** — same transcript + same model → same plan,
      every time. The *planning* has no model call even if the summary step does.
- [ ] Tool-call/result pairs are never orphaned by compaction, tested with an interleaved
      fixture
- [ ] A transcript that fits is returned untouched with `fidelity.level: "full"`
- [ ] The fidelity report enumerates **what** was lost, not just a percentage
- [ ] A `repo_context` whose SHA no longer resolves (S-25) is reported as
      **"unavailable"**, distinct from **"dropped for size"** — different causes, different
      user actions
- [ ] Every resume produces a fidelity record, including `full` ones (uniformity makes it
      auditable, NFR-5)
- [ ] Unit tests: fits exactly at the boundary, one token over, tiny context window,
      transcript larger than any available model
- [ ] Pure — no fs, no network in the planner (§C)

## Exceptions honored

- **E-9.b** No claim of behavioral equivalence. This reports what the model *received*,
  never what it will *do* with it.
- **NFR-1** The plan is deterministic even when an optional summarization step is not.
  Keep the two clearly separated: plan first, summarize second.
- **E-4.b** Same spirit as budget degradation — degrade visibly, never silently.

## Notes

- The summarization step, if used, is a model call and therefore costs money and routes
  through S-08 like any other. A cheap model is the right default for summarizing.
- **This is the honest home of the 99% target.** Layers 1–3 are held to 100% by tests in
  S-23, S-24, and S-27. This story is where a real number gets computed, displayed, and
  can be argued with — which is worth more than a guarantee nobody can measure.
