# BR_04 — Destructive tool calls are confirmed, and context follows the project

> **Format:** ADR-0022 / ADR-0046. **Status:** built · **Validated by:** `lib/chat-tools.test.ts`

Two asks that share one root: chat had no way to *ask* the user anything, so it
could only refuse; and the file sidebar was bound to GitHub rather than to the
selected project, so you could attach files from repo A while chatting about
project B.

| Field | Value |
|---|---|
| **ID** | `BR_04` |
| **Type** | `BR` |
| **Usecase** | An agent in chat may write and run commands, with irreversible actions confirmed by a human first (Kernel Rule 20) |
| **Expected Input** | A tool call plus its classification |
| **Expected Output** | Reversible calls execute; destructive calls pause for confirmation; out-of-scope calls refuse outright |
| **Input Data Format** | `ToolCall` |
| **Output Data Format** | Tool result, or a pending confirmation |
| **Next Step** | — |
| **Justifications** | `09-agent-authority`: the axis is reversibility, not capability. Refusing everything is as wrong as allowing everything |

## Solutions

| ID | Type | Usecase | Next Step | Justifications |
|---|---|---|---|---|
| `BR_04_Classify` | `---` | Every call passes `gate()` before executing | `BR_04_Confirm` | The one layer that does not depend on the model's judgment |
| `BR_04_Confirm` | `---` | A `confirm` verdict returns a prompt to the user; approval re-runs the call | — | Rule 20: destructive operations require confirmation |
| `BR_04_ProjectScope` | `---` | The file sidebar lists the selected project's files, not arbitrary GitHub repos | — | Attaching from repo A while saving to project B is incoherent |

## Exceptions

| ID | Type | Condition | Expected Output | Next Step | Justifications |
|---|---|---|---|---|---|
| `BR_04_SE-01` | `SE` | The command times out or is killed | Reported as timed out, distinct from exit 1 | Already handled in `lib/tools.ts`; must stay true through chat |
| `BR_04_BE-01` | `BE` | The path is outside the project | **Refuse. Never a confirmation** | A scope violation must not become a prompt a user can wave through (E-11.e) |
| `BR_04_BE-02` | `BE` | The user declines a confirmation | The model is told it was declined and continues | A decline is an answer, not an error |
| `BR_04_BE-03` | `BE` | A destructive call arrives with no human present | Pause, do not act | Rule 20 with nobody to ask means stop |
| `BR_04_BE-04` | `BE` | No project is selected | No tools at all | There is no scope to bound them to |

## Execution (ADR-0046 actual/status)

| ID | Status | Actual |
|---|---|---|
| `BR_04_Classify` | pass | every call passes `gate()`; verified for read and write paths |
| `BR_04_Confirm` | pass | `confirm` callback gates mutating tools; approval executes, decline does not |
| `BR_04_BE-01` | pass | out-of-scope write refuses and **never** reaches `confirm` (asserted) |
| `BR_04_BE-02` | pass | decline returns `declined: true`; the file is untouched |
| `BR_04_BE-03` | pass | `allowMutations` without `confirm` yields no mutating tools at all |
| `BR_04_BE-04` | pass | no project → `workspaceFor` returns null → no tools |
| `BR_04_ProjectScope` | **not built** | the sidebar still lists GitHub repos, not the project's files |

### Correction found by testing

The first draft of these tests asserted that **any** `write_file` prompts. It
does not, and should not: `gate()` classifies an in-scope file write as `auto`
(reversible — git recovers it) and only `destructive_actions` such as
`rm -rf` or `git push --force` return `confirm`.

That is the architecture working as written — the axis is reversibility, not
capability. Gating every write would train the user to click through prompts,
which is how a confirmation stops being a control. The tests were wrong; they now
assert the real contract.
