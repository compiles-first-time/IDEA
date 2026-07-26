---
name: no-assumption-block
description: Detects when you are about to make an assumption and forces verification against the spec before proceeding.
---

# No Assumption Block

## When to Invoke

Invoke this skill when you notice yourself:
- About to use the phrase "I assume..."
- About to use the phrase "this is probably..."
- About to use the phrase "it should work like..."
- About to use the phrase "based on context..."
- About to use the phrase "I think..." in the context of architectural or implementation decisions
- About to implement a detail not explicitly covered in a spec
- About to infer user intent beyond what was explicitly stated
- About to pick between two valid options without user input

## What This Skill Does

1. Detects assumption language or assumption behavior
2. STOPS the current response
3. Forces you to verify the assumption against the spec
4. If the spec confirms, proceeds with a reference
5. If the spec does not confirm, asks the user for clarification

## Procedure

### Step 1: Detect the Assumption
When you find yourself about to make an assumption, STOP.

State what assumption you were about to make:
"I was about to assume: [exact assumption]"

### Step 2: Check the Spec
Search the relevant spec files:
- Is this assumption explicitly addressed?
- Is there an SR row that defines the correct behavior?
- Is there a decision (D-XX) that resolves this?
- Is there a convention (in CONVENTIONS.md) that applies?

### Step 3: Report
If the spec CONFIRMS the assumption:
"Verified: [assumption] is confirmed by [SR ID / D-XX / convention]. Proceeding with reference."

If the spec DOES NOT CONFIRM:
"Assumption not found in spec. HALTING.

My assumption was: [exact assumption]
What the spec says: [what was found, if anything]
What is missing: [what is needed]

Please clarify:
[specific question]"

### Step 4: Act
- Confirmed → proceed with reference
- Not confirmed → wait for user direction

## Critical Rules

- NEVER proceed with an unconfirmed assumption
- NEVER rationalize "it's a small detail"
- NEVER pick between valid options without asking
- ALWAYS prefer asking over guessing
- ALWAYS update STATE.md if the user's answer creates a new decision

## Examples of Assumption Language to Block

| Phrase | Action |
|--------|--------|
| "I'll assume the default is..." | STOP — check spec |
| "This probably uses..." | STOP — check spec |
| "It should be fine to..." | STOP — check spec |
| "I'll go with..." | STOP — check spec |
| "The typical pattern is..." | STOP — check spec |
| "This is a standard..." | STOP — check spec |
| "I think the user wants..." | STOP — check user |
| "Based on the context..." | STOP — check spec |
| "Without more info, I'll..." | STOP — ask for info |

## Integration

This skill runs BEFORE any significant decision or implementation step. Can be invoked manually or via hooks.
