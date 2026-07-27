# S-15 — Fit recommender

**Phase:** 2 · **Workstream:** 5 Local models · **Status:** Not started
**Component:** C-20 · **Traces to:** FR-6.4, E-6.b, NFR-1
**Depends on:** S-02 · **Blocks:** S-17

## Goal

Given a model's size and the user's reported memory, say **too large / good fit /
overkill**. Fully deterministic, pure, tested — the easiest story in the backlog and a
good early win.

## Scope

`lib/fit.ts` — the rule is already specified in `05-data-contracts.md` §7:

```
mem  = vramGB ?? ramGB
need = sizeGB * 1.2                    // runtime overhead
verdict = need > mem          ? "too_large"
        : mem >= need * 2.5   ? "overkill"
        : "good_fit"
```

Returns `FitResult { model, hardware, verdict, headroomGB, note }` where `note` is a
plain-language explanation.

## Acceptance criteria

- [ ] Implements the specified rule exactly; the `1.2` and `2.5` constants are **named
      exports** so they're tunable in one place
- [ ] `vramGB: null` correctly falls back to `ramGB`
- [ ] Boundary cases tested: `need === mem` exactly, `mem === need * 2.5` exactly,
      zero/negative sizes, absurdly large models
- [ ] `headroomGB` is `mem - need` and can be negative for `too_large`
- [ ] `note` explains the verdict in a sentence a human would find useful
- [ ] Pure — no fs, no network, no hardware access of any kind (E-6.b)

## Exceptions honored

- **E-6.b** **No automatic hardware detection.** This function *receives* a
  `HardwareReport` whose `source` is `"helper"` or `"user"`. It never probes anything.
  The locked decision in `00-opening-prompt.md` says hardware detection is dropped —
  do not add it back here.
- **NFR-1** Pure and unit-tested.

## Notes

- The thresholds are honest guesses. Ship them, then tune once there's real data from
  the helper. Because they're named constants with tests, tuning is a two-line change.
- Doesn't need the helper (S-16) to exist — you can test it with hand-written
  `HardwareReport` values today. Good candidate for filling a short session.
