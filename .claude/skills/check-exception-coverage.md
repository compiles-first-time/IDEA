---
name: check-exception-coverage
description: Verify that every main-flow SR has appropriate SE and BE exception rows defined. Identifies gaps in exception handling coverage.
---

# Check Exception Coverage

## When to Invoke

- After expanding a spec file
- Before approving an expanded spec for implementation
- During spec review
- When adding new SR rows

## What This Skill Does

1. Reads an expanded spec file
2. Identifies all main-flow SR rows (`---` type)
3. For each main flow, checks that SE and BE exception rows exist
4. Verifies exception rows are complete (all 12 columns filled)
5. Reports coverage gaps

## Procedure

### Step 1: Identify All Main Flows
Read the expanded spec file and list all rows where Type = `---`.

### Step 2: Check SE Coverage
For each main flow, verify SE rows exist for applicable infrastructure failures:

| Check | Trigger | Required If |
|-------|---------|-------------|
| Network failure | External system unreachable | Uses network/API |
| Auth failure | Credential expired or invalid | Uses credentials |
| Timeout | Operation takes too long | Has duration expectation |
| Resource exhaustion | Memory, disk, GPU, quota | Resource-intensive |
| Database failure | DB unavailable | Uses database |
| Service unavailable | Dependent service down | Has dependencies |
| Rate limit hit | External API rate limit | Calls external APIs |

### Step 3: Check BE Coverage
For each main flow, verify BE rows exist for applicable business logic failures:

| Check | Trigger | Required If |
|-------|---------|-------------|
| Input validation | Bad input format or values | Accepts input |
| Permission denied | User lacks required role | Requires authorization |
| Policy violation | Action violates governance rule | Subject to governance |
| State invalid | Invalid state transition | Has state machine |
| Duplicate detected | Operation already performed | Idempotent or unique operations |
| Conflict detected | Concurrent modification | Shared state |
| Expired resource | Working with stale data | Has freshness requirements |

### Step 4: Verify Completeness
For each exception row, check that all 12 columns are filled (no nulls, no N/A without justification).

### Step 5: Report
Format:
```
EXCEPTION COVERAGE REPORT

File: spec/03-connection-layer-expanded.md

Main flows analyzed: 15

Coverage by SR:

SR_CONN_01: ✓ COMPLETE
  Main flow: ---
  SE coverage: SE-01 (network), SE-02 (auth), SE-03 (timeout) ✓
  BE coverage: BE-01 (permission), BE-02 (input validation) ✓
  All rows complete: ✓

SR_CONN_02: ✗ INCOMPLETE
  Main flow: ---
  SE coverage: SE-01 (network) only
  MISSING: SE-02 (auth), SE-03 (timeout)
  BE coverage: none
  MISSING: BE-01 (permission), BE-02 (policy)

SR_CONN_03: ✓ COMPLETE
  ...

Summary:
- Complete: 12 of 15 (80%)
- Incomplete: 3 of 15
- Action required: Add missing exception rows for SR_CONN_02, SR_CONN_07, SR_CONN_11

BLOCKING: Cannot approve this spec for implementation until all SRs have complete exception coverage.
```

## Critical Rules

- Every main flow MUST have at least one SE row (infrastructure failures are always possible)
- Main flows that accept input MUST have BE-01 (input validation)
- Main flows requiring permission MUST have BE row for permission denial
- Exception rows must have all 12 columns filled
- Exception rows must specify detection method, recovery, notification, retryability
- Uncovered exceptions are implementation hazards — block approval until fixed

## Integration

Run this skill as part of the spec expansion workflow. Any incomplete spec is blocked from implementation.
