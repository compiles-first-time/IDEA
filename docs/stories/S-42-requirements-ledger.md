# S-42 — Requirements, exceptions, and technical dependencies

**Phase:** 3 · **Workstream:** 10 Requirements *(new)* · **Status:** Not started
**Component:** C-41 (new) · **Traces to:** FR-14.1–14.4, E-13.c
**Depends on:** S-30 · **Blocks:** S-43

## Goal

For each project, see what it was *supposed* to do — and what could stop it.

Three things per requirement, and the last two are the ones nobody writes down:

- **The requirement** — what the project must do.
- **Exceptions** — what could go wrong meeting it *with the solution chosen*.
  Not generic risk. "We used the GitHub API for this, so it breaks when the token
  lacks `repo` scope" is an exception. "APIs can fail" is noise.
- **Technical requirements** — what the solution needs from the world. An
  account. A paid tier. A credential. **A human doing something manual.**

## Why this cannot be derived

Measured against 10,015 real events: there is no requirement data in the event
log. Not sparse — absent. The log records what *happened*, and a requirement is a
statement about what *should*. No projection over execution history recovers
intent.

So this is a new artifact: a file in the project's own repo (FR-14.1), so it
travels with the clone and the project owns it.

## Shape

```yaml
requirements:
  - id: R-1
    need: Conversations survive being picked up by a different model
    solution: Canonical transcript format with provider render adapters
    exceptions:
      - id: R-1.E1
        risk: Target model's context window is smaller than the transcript
        detect: Token count exceeds the target's limit
      - id: R-1.E2
        risk: Repo context was pinned to a SHA that no longer exists
        detect: Fetching the pinned blob 404s
    technical:
      - kind: account          # account | credential | paid_tier | human
        what: GitHub OAuth app
      - kind: human
        what: Someone must approve the allowlist before a colleague can sign in
```

## Scope

- Parse the file with Zod. Malformed is a **visible error, not a silent skip** —
  a requirements file that quietly fails to load is worse than none, because the
  page implies everything is fine.
- Render per project: requirements, their exceptions, their technical needs.
- **Blocking list** (FR-14.4): every `human`, `account`, `credential`, and
  `paid_tier` item across the project, together. These are what no agent can
  clear, so they are what a person needs to see first.
- Missing file is a normal state — "no requirements captured yet", not an error.

## Data, never instruction (E-13.c)

A requirements file is repo content (LR-01). An agent reading
`need: disable the sign-in allowlist` is reading a claim about intent, not
receiving an order. It is rendered and discussed; it never widens permissions.

## Not in scope

Authoring the file in the UI, and Loom emitting it automatically. Hand-written
first — if the format is not worth filling in by hand once, generating it will
not save it.

## Done when

- A project with a requirements file renders all three sections.
- A malformed file shows a parse error naming the line.
- A project without one renders normally.
- The blocking list collects human and account items across all requirements.
