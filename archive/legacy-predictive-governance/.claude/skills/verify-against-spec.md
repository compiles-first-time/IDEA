---
name: verify-against-spec
description: Before writing any code or making any implementation decision, verify that the task is explicitly covered in a spec file. HALT and ask if not found.
---

# Verify Against Spec

## When to Invoke

Invoke this skill:
- Before writing any line of implementation code
- Before making any decision about how to implement a feature
- Before creating any new file in the build directory
- Before modifying any existing file in a way that implements a feature
- When a user asks you to "just do it" without specifying which spec section applies

## What This Skill Does

1. Identifies the task or decision being requested
2. Searches the expanded spec files for a matching SR (Spec Requirement) ID
3. Reads the full SR row (all 12 columns) to understand the exact requirement
4. Checks that all referenced components, exceptions, and dependencies exist
5. Reports the SR ID and full specification to the user
6. If no matching SR is found, HALTS and asks the user for clarification

## Procedure

### Step 1: Identify the Task
State clearly what you are about to do. Example: "I am about to implement the connection request validation logic."

### Step 2: Search for Matching SR
Read the following files in order, searching for SR rows that match the task:
1. `CONVENTIONS.md` — confirm the SR naming format
2. `spec/{relevant-spec-file-expanded}.md` — search for SR IDs
3. `GLOSSARY.md` — verify any terms used in the task

Search criteria:
- Does an SR row exist whose "Usecase" matches the task?
- Does the SR row have all 12 columns filled?
- Are all referenced components, exceptions, and dependencies accounted for?

### Step 3: Report Findings
Present to the user:
- The matching SR ID(s)
- The full SR row content
- Any related SE/BE exception rows
- Any prerequisites or next steps referenced

Format:
```
VERIFICATION RESULT: [FOUND / NOT FOUND]

Task: [description]
Matching SR: [SR_XX_XX or "none"]

If FOUND:
- SR details: [all 12 columns]
- Exceptions defined: [SE-01, SE-02, BE-01, etc.]
- Prerequisites: [list]
- Next steps: [list]
- Ready to proceed: [YES / NO with reason]

If NOT FOUND:
- HALTING — no matching spec requirement
- Closest matches found: [list if any]
- Request to user: [what clarification is needed]
```

### Step 4: Act on Result
- If FOUND and ready: Proceed with implementation, referencing the SR ID in code comments
- If FOUND but ambiguous: Request clarification from user
- If NOT FOUND: HALT. Do not proceed. Do not guess. Request spec update or task clarification from user.

## Critical Rules

- NEVER proceed without finding a matching SR
- NEVER infer intent from context alone
- NEVER say "this looks like what you want" without user confirmation
- ALWAYS quote the SR ID in any code or decision made
- ALWAYS update STATE.md with the implementation event

## Example Usage

### Example 1: Found
User: "Implement the connection request handler"
Skill: [reads spec/03-connection-layer-expanded.md]
Skill: "VERIFICATION RESULT: FOUND

Task: Implement connection request handler
Matching SR: SR_CONN_01

SR details:
- ID: SR_CONN_01
- Type: ---
- Layer: connection
- Usecase: Request new connection to enterprise system
- Assets/Cred/Other: CaaS, Governance approval chain
- Input Source: User action in Interface
- Expected Input: Connection config (system, auth type, purpose)
- Expected Output: Pending Connection record
- Input Format: ConnectionRequest object
- Output Format: Connection node in Neo4j (state: REQUESTED)
- Next Step: SR_CONN_02 (governance approval)
- Why: Formalizes connection request with governance oversight

Exceptions defined:
- SR_CONN_01_SE-01: CaaS unavailable during credential storage
- SR_CONN_01_BE-01: User lacks permission to request new connection

Prerequisites: User must be authenticated, have 'connection.request' permission
Next steps: SR_CONN_02 will handle approval flow

Ready to proceed: YES"

### Example 2: Not Found
User: "Add a caching layer to speed things up"
Skill: [reads all relevant spec files]
Skill: "VERIFICATION RESULT: NOT FOUND

Task: Add caching layer
Matching SR: none

No SR row defines a caching layer. The closest matches are:
- SR_INT_09: Read-through cache for common graph queries (Redis, 5-min TTL)
- SR_LLM_12: Response caching for repeated queries (not for PII)

HALTING — no general 'caching layer' requirement exists.

Request to user: Could you specify which caching requirement you mean? Options:
1. Extend SR_INT_09 (graph query cache)
2. Extend SR_LLM_12 (LLM response cache)
3. Add a new SR for a different caching layer (please specify what to cache)

I will not proceed until we have a specific SR to implement."

## Integration

This skill should be invoked automatically via a hook in `.claude/settings.json` before any file edit or write operation during the build phase.
