---
name: trace-requirement
description: Given a piece of code or implementation, trace it back to the spec requirement(s) it implements. Used for audit and code review.
---

# Trace Requirement

## When to Invoke

- Reviewing code for spec compliance
- Generating implementation audit reports
- Responding to "why does this code exist?"
- Debugging: need to understand what requirement a piece of code is supposed to satisfy
- Before refactoring: understand what must be preserved

## What This Skill Does

1. Takes a code file, function, or line range as input
2. Searches the codebase for SR references (comments, commit messages)
3. Reads the referenced SR rows from spec files
4. Verifies the code actually implements what the SR requires
5. Reports a traceability matrix: code → SR → decision → use case

## Procedure

### Step 1: Identify the Code
Get the file path and optionally line range to trace.

### Step 2: Search for SR References
Look for SR IDs in:
- Code comments (e.g., `// Implements: SR_CONN_01`)
- Function/class docstrings
- File header comments
- Nearest commit message
- Test file references (tests should name their SR)

### Step 3: Read the Referenced SRs
For each SR found, read the full SR row and all related exception rows from the expanded spec file.

### Step 4: Verify Implementation
Compare code behavior to SR specification:
- Does the code do what the "Usecase" column says?
- Does the code accept the "Expected Input" format?
- Does the code produce the "Expected Output" format?
- Does the code handle all enumerated exceptions (SE, BE)?
- Does the code transition to the "Next Step" correctly?

### Step 5: Report
Format:
```
TRACEABILITY REPORT

File: [path]
Lines: [range or "entire file"]

SR references found:
- SR_CONN_01 (main flow)
- SR_CONN_01_SE-01 (CaaS unavailable)
- SR_CONN_01_BE-01 (insufficient permissions)

Implementation verification:
- Main flow: [MATCHES / MISSING / DEVIATES from spec]
  - Usecase: [match details]
  - Input handling: [match details]
  - Output format: [match details]
  - Next step: [match details]
- SE-01 handling: [MATCHES / MISSING / DEVIATES]
- BE-01 handling: [MATCHES / MISSING / DEVIATES]

Unimplemented exceptions:
- [list any SE/BE from spec not handled in code]

Extra behavior (not in spec):
- [list any code behavior not justified by spec — these are VIOLATIONS and must be removed or a new SR created]

Dependencies:
- [other SRs this code depends on]
- [other SRs that depend on this code]

Overall: [COMPLIANT / PARTIAL / NON-COMPLIANT]
```

## Critical Rules

- Code without an SR reference is a VIOLATION — trace cannot proceed
- Code behavior not justified by an SR is a VIOLATION — must be removed or a new SR added
- Tests must also reference SRs — untraced tests are suspect
- Report violations immediately; do not ignore

## Use in Code Review

During code review:
1. Invoke this skill on each changed file
2. Any NON-COMPLIANT result blocks the merge
3. Any VIOLATION requires either code removal or spec update
4. Generate a traceability matrix as part of the review report
