# S-44 — The requirements analyst agent (in Loom)

**Phase:** 3 · **Workstream:** 10 Requirements · **Status:** Drafted, not installed
**Component:** Loom core agent · **Traces to:** FR-14.1–14.4, E-13.c, E-13.d
**Depends on:** S-42 · **Blocks:** nothing

## Goal

A core Loom agent that interviews the requester until the specification is
complete enough to build from **without guessing** — and refuses to hand over
until it is.

Supersedes the informal S-38 sketch, which described a "requirements-gathering
agent" before the format was known.

## The problem it solves

An agent starting from an underspecified request does not fail loudly. It fills
gaps with plausible assumptions, produces something that runs, and the gap
surfaces later as a case nobody considered. The assumption is invisible
*because* it was reasonable.

## The central design decision

**Completion is mechanical, not the agent's judgment.**

An agent asked "do you understand enough to build?" will say yes. That is a
fluency assessment, not a coverage measurement — and it is exactly the failure
mode this agent exists to prevent, so it cannot be the agent's own gate.

Instead a deterministic validator passes or names what is missing, by ID:

1. Every requirement has ≥ 1 solution.
2. Every solution has ≥ 1 SE, and BEs were explicitly asked about (zero allowed
   only with a recorded reason).
3. All twelve fields non-empty on every row.
4. Every `Next Step` resolves to a real ID or a declared terminal state.
5. Format handoffs type-check: a step's output format matches its next step's
   input format, or the mismatch is explained.
6. Every named asset/credential appears in the technical-dependency list.
7. Every human-in-the-loop step is flagged blocking.
8. Every open question is an explicit `UNKNOWN` with a date and an owner.

Check 8 is what keeps this honest rather than obstructive. Real specifications
have unresolved parts. **A marked unknown is a tracked risk; a blank is a silent
assumption.** The validator counts markers and reports them — it never erases
them and never fills them in.

This lands the "no guessing" guarantee in plain code with tests (NFR-1), not in a
model's self-assessment.

## Interview method

1. **Frame** — push back on any "requirement" that describes steps. Ask "why does
   that matter?" until the answer is an outcome.
2. **Alternatives** — name ≥ 2 ways to meet it (UI walk, direct query, API),
   state trade-offs, record what was rejected and why.
3. **Decompose** the chosen solution into steps with real formats.
4. **Attack each step twice** — *what technical thing fails* (SE) and *what
   business situation makes this wrong* (BE). Separate questions; requesters
   answer only the first unless asked both.
5. **Trace the graph** — walk every Next Step to a terminal state.
6. **Validate**, report gaps by ID, repeat.

## Where it lives

`loom-template/agents/requirements-analyst/SKILL.md` — **drafted, uncommitted.**

Loom is not agent-writable (E-11.a, E-13.d). Installing this is a human action in
that repo, and it is deliberately left for review rather than pushed.

## IDEA's half

IDEA reads the ledger the agent produces (S-42) and links it to test results
(S-43). IDEA does not run the interview — that happens where the work happens.

## Done when

- The skill is reviewed and committed to `loom-template` by a human.
- The validator exists as tested code, not prose in the skill file.
- A real interview produces a ledger that passes, or a gap list naming every ID.
- A requirement written as a sequence of steps is rejected and reframed.
- An `UNKNOWN` survives round-tripping without being silently resolved.
