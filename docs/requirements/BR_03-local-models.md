# BR_03 — Local models are discovered and connected from Settings

> **Format:** ADR-0022 / ADR-0046. **Status:** built · **Validated by:** `lib/local-models.test.ts`, UI panel

| Field | Value |
|---|---|
| **ID** | `BR_03` |
| **Type** | `BR` |
| **Usecase** | IDEA scans the machine for local models and connects to a running endpoint without the user typing a URL |
| **Expected Input** | Model cache directories; candidate endpoints on localhost |
| **Expected Output** | A list of discovered models with fit, and a connected endpoint if one answers |
| **Input Data Format** | `LocalModelInfo[]`, `EndpointProbe` |
| **Output Data Format** | Rendered panel + connection state |
| **Next Step** | — |
| **Justifications** | `discoverLocalModels()` and `probeEndpoint()` were built and tested with no UI; a scan nobody can trigger is not a feature |

## Technical requirements

| ID | Type | Usecase | Justifications |
|---|---|---|---|
| `BR_03_TR-01` | `TR` | A local runtime (Ollama / LM Studio) must be installed and running to connect | No amount of UI substitutes for a server that is not there |

## Solutions

| ID | Type | Usecase | Next Step | Justifications |
|---|---|---|---|---|
| `BR_03_Scan` | `---` | Settings panel calls `GET /api/local` | `BR_03_Probe` | The route existed with no caller |
| `BR_03_Probe` | `---` | Probe known endpoints and report which answered | — | Auto-connect is the ask; typing a URL is the thing being replaced |

## Exceptions

| ID | Type | Condition | Expected Output | Next Step | Justifications |
|---|---|---|---|---|---|
| `BR_03_SE-01` | `SE` | Cache directory unreadable (permissions) | Skip it, name it in "where we looked" | A partial scan reported as complete is a wrong answer |
| `BR_03_BE-01` | `BE` | No models found | "No local models found", plus the directories searched | Where we looked is what makes the result actionable |
| `BR_03_BE-02` | `BE` | Models found but no endpoint responds | **"found but not reachable"**, distinct from "not found" | The two have different fixes: start the server vs install a model |
| `BR_03_BE-03` | `BE` | A model is too large for the machine | Shown as `too_large` with the shortfall | Fit is already computed; hiding it invites a failed run |
