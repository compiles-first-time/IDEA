# BR_01 — Chat uses the user's routing configuration

> **Format:** ADR-0022 columns / ADR-0046 taxonomy (`BR` · `TR` · `---` · `SE` · `BE`).
> **Status:** built · **Validated by:** `lib/chat-routing.test.ts`

## The ask

The routing workstream — complexity scoring, the user-ordered fallback chain, the
spend allocation — is complete and tested, and **chat never calls it**. The chat
sends no `mode` and no `model`, so `ChatRequest` defaults to `manual` against
`defaultModelId()`. Ordering a chain in Settings changes nothing.

This is worse than a missing feature. The Settings page implies an effect it does
not have, so the user configures something and is told nothing.

| Field | Value |
|---|---|
| **ID** | `BR_01` |
| **Type** | `BR` |
| **Usecase** | A chat turn is routed using the user's configured mode, chain, and budget |
| **Expected Input** | A prompt, plus the user's routing config and allocation |
| **Expected Output** | A `RoutingDecision` naming the chosen model and why, applied to the call |
| **Input Data Format** | `ChatRequest` |
| **Output Data Format** | `RoutingDecision` + streamed `TurnMetadata` |
| **Next Step** | `BR_02` |
| **Justifications** | Settings that do not affect behaviour are a lie told by the UI |

## Solutions

| ID | Type | Usecase | Next Step | Justifications |
|---|---|---|---|---|
| `BR_01_SendMode` | `---` | Chat sends `mode` and `model` on every turn | `BR_01_ShowDecision` | Without this the server defaults to manual and the chain is skipped |
| `BR_01_ShowDecision` | `---` | The UI reads `start` metadata and shows which model answered and why | `BR_02` | The decision is already computed and streamed; it was being discarded |
| `BR_01_ModeToggle` | `---` | The user picks auto or manual, persisted per browser | `BR_01_SendMode` | Auto is the point of the chain; manual is the escape hatch |

## Exceptions

| ID | Type | Condition | Expected Output | Next Step | Justifications |
|---|---|---|---|---|---|
| `BR_01_SE-01` | `SE` | `/api/models` unreachable when the picker loads | Picker shows an error, chat still sends | Chat must not be blocked by a metadata fetch |
| `BR_01_BE-01` | `BE` | Auto mode selected but no chain is configured | Falls back to cost ordering, and says so | Silent fallback hides that the chain is missing |
| `BR_01_BE-02` | `BE` | Every chain entry is skipped (budget or capability) | Turn refuses with the reasons per entry | A blank failure gives the user nothing to fix |
| `BR_01_BE-03` | `BE` | Manual mode names a model that is disabled or unknown | Refuse and name the model | Silently substituting another model spends money the user did not choose |
| `BR_01_BE-04` | `BE` | The budget cap is already exhausted | Refuse before calling a provider | A cap enforced after the spend is not a cap |

## Execution (ADR-0046 actual/status)

| ID | Status | Actual |
|---|---|---|
| `BR_01_SendMode` | pass | `turnBody()` sends `mode` on every turn; `model` only in manual |
| `BR_01_ShowDecision` | pass | `describeDecision()` renders under each assistant message |
| `BR_01_ModeToggle` | pass | auto/manual toggle, auto default, model select disabled in auto |
| `BR_01_SE-01` | pass | fetch failure sets a notice; chat still sends |
| `BR_01_BE-01` | pass | no chain → server falls back to cost ordering (`chainFor` returns undefined) |
| `BR_01_BE-02` | pass | skips are rendered with the first reason and a count |
| `BR_01_BE-03` | pass | unknown model id is not sent; server defaults rather than erroring |
| `BR_01_BE-04` | pending | budget exhaustion is enforced server-side in `resolveChain`; **no dedicated test through the chat path** |
