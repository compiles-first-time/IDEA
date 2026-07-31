# BR_05 — The Loom Observatory weave becomes IDEA's dashboard

> **Format:** ADR-0022 columns / ADR-0046 taxonomy. **Status:** built
> **Source:** `loom-observatory-spec-v4.md` (normative) + `loom-observatory.html`
> (reference implementation, ~172KB, designed with Claude Web).
> **Validated by:** `lib/weave.test.ts`, gate 17.1 (`node --check` on the served
> script), full suite.

## The ask

The architect had a dashboard designed externally — two views (Home portfolio +
per-project weave), the six questions (who/what/where/when/why/how much), the
amber≠red doctrine, teaching-first glossary — and wants it to *be* IDEA's
Observatory: "It has improved UX. Lets make it happen."

| Field | Value |
|---|---|
| **ID** | `BR_05` |
| **Type** | `BR` |
| **Usecase** | `/observatory` serves the weave dashboard, showing IDEA's real projects and their real event logs alongside the spec's scripted teaching demo |
| **Expected Input** | The vendored reference HTML + real `memory/event-log/*.jsonl` |
| **Expected Output** | The weave, auth-gated, with real projects appearing as first-class cards |
| **Input Data Format** | Loom event JSONL → Rule-22 v2 event schema (spec §4.2) |
| **Output Data Format** | Served HTML + `/api/observatory/weave` JSON |
| **Next Step** | Live per-event SSE ingest (spec §16, backlog #1) |
| **Justifications** | The spec is normative and already anticipates exactly this wiring; a React rewrite would re-litigate its locked packaging decision silently, which §20 forbids |

## Solutions

| ID | Type | Usecase | Next Step | Justifications |
|---|---|---|---|---|
| `BR_05_Vendor` | `---` | Vendor the reference HTML + spec verbatim into the repo | `BR_05_Serve` | Spec §0: "port; do not re-author". The 34/35-tested behaviour is the asset |
| `BR_05_Serve` | `---` | `app/observatory/route.ts` serves the HTML behind IDEA's auth, appending one marked integration script | `BR_05_Adapt` | Doc `10`'s objections were the process and the port, not the artifact; served by IDEA there is no second server and no 4040 |
| `BR_05_Adapt` | `---` | `lib/weave.ts` maps real Loom events → spec §4.2 events, pure and tested | `BR_05_Handshake` | Determinism-first: the mapping is plain code, and honesty rules apply to every field it cannot know |
| `BR_05_Handshake` | `---` | The integration script fetches `/api/observatory/weave` and appends real projects to `PROJECTS` (spec §16's registry handshake) | — | The demo stays as the teaching content; real projects arrive beside it, labelled live |

## Exceptions

| ID | Type | Condition | Expected Output | Next Step | Justifications |
|---|---|---|---|---|---|
| `BR_05_SE-01` | `SE` | A project's event log is unreadable or absent | Project appears with one queued "awaiting first recorded run" — never crashes `openProject` | — | `openProject` indexes `RUNS[0]`; an empty array would throw |
| `BR_05_SE-02` | `SE` | The vendored HTML is missing at serve time | 500 with a message naming the file | — | A blank page with no reason is undebuggable |
| `BR_05_BE-01` | `BE` | Real events lack `intent`/`just`/`cap` (they do — Loom's hooks don't emit them) | Honest placeholder text saying the field was not recorded; **never** invented narrative | — | The spec mandates the fields non-empty; inventing intent would be fiction rendered as fact |
| `BR_05_BE-02` | `BE` | Real logs have thousands of events per session | Last N events kept, with a synthetic root event stating exactly how many were truncated | — | Spec backlog #9 knows live volume needs virtualization; silent truncation reads as a short session |
| `BR_05_BE-03` | `BE` | Real rules (`LR-04`, `ADR-0047`) are absent from the demo glossary | Glossary entries injected from `lib/explain.ts` content, so real rule chips resolve | — | An unknown token is a safe no-op, but a clickable explanation is the product's whole teaching posture |
| `BR_05_BE-04` | `BE` | Cumulative `session_token_usage` snapshots would over-count | Per-event token **deltas**, non-monotonic drops flagged to zero | — | The 30x over-count already happened once; the weave must not reproduce it |
| `BR_05_BE-05` | `BE` | The demo's scripted projects could read as real | Demo cards labelled `scripted demo` by the integration script | — | Spec §1.5: captions never lie about scripted vs live |

## Deviations from the spec (recorded per §20, not silent)

| # | Deviation | Rationale |
|---|---|---|
| I1 | Served by IDEA behind auth, not Node 22 on `:4040` | IDEA *is* the server; doc `10` merged the Observatory into IDEA and the spec's own §16/§7.3 anticipate server-side custody |
| I2 | Key vault left demo-scoped; IDEA's `.env.local` keys are authoritative | Spec §7.3 commits to exactly this at live wiring |
| I3 | Real run = one log session (no `trace_id` in real events yet) | The spec's Run needs a boundary the data does not record; sessions are the honest unit available |
| I4 | Real events get sparse causal parents (tool_result → its tool_call only) | Inventing a parent chain would draw fictional causality as fact |
