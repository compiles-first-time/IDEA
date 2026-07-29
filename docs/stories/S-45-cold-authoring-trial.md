# S-45 — Cold-authoring trial (parked prompt)

**Phase:** 3 · **Status:** Parked — to be run in another project, not here
**Traces to:** ADR-0046 §5 (harvest before automating), S-44

## Why parked

This is a validation exercise, not a build. It belongs in a project that is *not*
Loom and *not* IDEA, because the nine existing registers were all authored about
Loom by people already deep in Loom. A format that only works when the author
knows the domain is not validated.

## The prompt to run

> Author a Requirements & Exceptions register for one real requirement in this
> project, following `/testcase` (ADR-0046 format, ADR-0022 columns).
>
> **Constraint: you do not know this domain.** Do not infer the requirement from
> the code and do not fill a field because a plausible value exists. Every time
> you would guess, stop and either ask, or write an explicit `UNKNOWN` with a date
> and an owner.
>
> Produce:
> 1. `observability/eval-suite/requirements/BR_NN.md` — the register.
> 2. A separate list of **every question you had to ask**, and every `UNKNOWN` you
>    left.
>
> The second output is the real deliverable. It measures whether the format forces
> the right questions of someone who cannot fall back on domain knowledge.

## How to grade it

The architect marks each row where the author **guessed instead of asking**. That
count is the finding — a format that lets a stranger produce a confident, wrong
register is a format that will let an agent do the same, at scale and faster.

Candidates: `ripple`, `process-cartographer` — whichever is least familiar.

## What it feeds

Whatever the trial surfaces goes into the requirements-analyst agent (S-44)
before it is installed. Harvest first, automate second.
