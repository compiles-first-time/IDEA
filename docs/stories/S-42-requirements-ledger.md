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

Corrected against a real ledger (`Sample - Requirements and Exceptions.xlsx`,
an RPA credit/debit validation process). The first draft of this story had **two**
tiers; the real format has **three**, and the missing middle one is the important
part.

```
Requirement (BR)        ← solution-neutral: what must be true
  └─ Solution step      ← how THIS build meets it (a choice, with alternatives)
       ├─ SE            ← System Exception: technical failure → retry
       └─ BE            ← Business Exception: data/situation wrong → do NOT retry
```

Measured in that ledger: 4 requirements, 22 solution steps, **22 SEs and 16 BEs**.
Roughly two exceptions per step, near-evenly split between technical and business.

Twelve fields per row — requirement, solution, and exception alike:

| # | Field | Notes |
|---|---|---|
| 1 | ID | `BR-01` → `BR-01_ValidateFile` → `BR-01_ValidateFile_BE-02` — hierarchy readable from the ID |
| 2 | Type | `BR` · `---` (solution) · `SE` · `BE` |
| 3 | Framework Location | where in the process it runs |
| 4 | Usecase | prose, verbose |
| 5 | Assets / Cred / Other | **where account, credential, and human dependencies surface** |
| 6 | Input Source or Condition | for an exception, the trigger condition |
| 7 | Expected Input | |
| 8 | Expected Output | |
| 9 | Input Data Format | concrete type |
| 10 | Output Data Format | concrete type |
| 11 | **Next Step** | next ID or terminal state — **this makes it a graph** |
| 12 | **Why** | a step that cannot justify itself is unnecessary or hiding a requirement |

```yaml
requirements:
  - id: BR-01
    need: >-
      Retrieve and validate the credit file, including format, headers,
      data presence, and file-type identification.
    why: Ensures the correct file is retrieved, structured, and safe to validate.
    solutions:
      - id: BR-01_ValidateFileTypeAndStructure
        usecase: Inspect the file; classify credit vs debit; confirm headers and ≥1 row.
        input_format: String
        output_format: Tuple<DataTable, String>
        next: BR-01_LoadTableToQueue
        why: Determines which downstream validation logic applies.
        exceptions:
          - id: BR-01_ValidateFile_SE-01
            class: SE
            condition: File could not be opened or parsed (corrupt or locked).
            output: System.Exception
            next: MaxFrameworkRetry = 3 => End Process State (alert + screenshot)
          - id: BR-01_ValidateFile_BE-01
            class: BE
            condition: Expected headers were not found.
            output: "HasRequiredHeaders = False"
            next: Log error and escalate with the missing-header list
    technical:
      - kind: credential
        what: FIS_ServiceAccount (Orchestrator asset)
      - kind: human
        what: Business classifies the file manually when BE-03 fires
unknowns:
  - id: U-1
    what: custom_1 → custom_18 mapping may be incomplete
    since: 2025-05-28
    owner: requester
```

## Why SE and BE must stay separate

A retried business exception fails identically N times, burns the retry budget,
and buries the real signal. An un-retried system exception turns a transient blip
into a failed run. They are opposite responses, so a schema that lets them blur
produces the wrong behavior in both directions. `class` is required, with no
default.

## Unknowns are first-class

The real ledger carries *"This mapping may be incorrect. I will need to double
check. (incomplete 5/28/25)"* in a cell. That is correct behavior, not sloppiness.
A marked unknown is a tracked risk; a blank cell is a silent assumption. The
parser preserves unknowns, counts them, and surfaces them — it never treats a
blank as "not applicable".

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
