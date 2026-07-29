# BR_02 — The user can choose a model in chat

> **Format:** ADR-0022 / ADR-0046. **Status:** built · **Validated by:** `lib/chat-routing.test.ts`

| Field | Value |
|---|---|
| **ID** | `BR_02` |
| **Type** | `BR` |
| **Usecase** | The user selects which model answers, from the models this build can reach |
| **Assets / Cred** | `ANTHROPIC_API_KEY` (BR_05 `TR`) |
| **Expected Input** | The enabled model registry |
| **Expected Output** | A model id sent with the turn, and the answer visibly from that model |
| **Input Data Format** | `PublicModel[]` from `/api/models` |
| **Output Data Format** | `ChatRequest.model` |
| **Next Step** | `BR_01_SendMode` |
| **Justifications** | A multi-LLM console whose model cannot be chosen is a single-LLM console |

## Solutions

| ID | Type | Usecase | Next Step | Justifications |
|---|---|---|---|---|
| `BR_02_FetchModels` | `---` | Chat loads `/api/models` on mount | `BR_02_Picker` | The route existed with no caller |
| `BR_02_Picker` | `---` | A select in the chat bar, disabled in auto mode | `BR_01_SendMode` | In auto the router chooses; an enabled control that does nothing misleads |

## Exceptions

| ID | Type | Condition | Expected Output | Next Step | Justifications |
|---|---|---|---|---|---|
| `BR_02_SE-01` | `SE` | `/api/models` returns an error | Picker shows "could not load models"; chat still works | Metadata failure must not block the product |
| `BR_02_BE-01` | `BE` | No models are enabled | Picker says so; sending is refused with that reason | "Nothing happened" is not a diagnosis |
| `BR_02_BE-02` | `BE` | A previously chosen model is no longer enabled | Selection resets to the default and says why | A stale selection would fail every turn silently |
