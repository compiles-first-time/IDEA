---
name: update-state-log
description: At the end of every session, update STATE.md, LOG.md, and NEXT.md with consistent format. Enforces the session closure protocol.
---

# Update State Log

## When to Invoke

- Before ending any session
- When the user indicates they are done for now
- When a natural breakpoint is reached
- Before closing or archiving the exploration

## What This Skill Does

1. Reviews the current session's work
2. Identifies new decisions made
3. Identifies new use cases discovered
4. Identifies new back-propagation fixes
5. Updates STATE.md with new decisions (append only, no renumbering)
6. Updates LOG.md with session narrative
7. Updates NEXT.md with precise next action
8. Asks the user a final question to capture any missed thinking

## Procedure

### Step 1: Review Session Work
Scan the conversation for:
- Decisions made (should be prefixed D-XX)
- Use cases discovered (should be prefixed UC-XX)
- Back-propagation fixes (should be prefixed BP-XX)
- Open questions raised
- Ideas generated
- Dead ends encountered

### Step 2: Update STATE.md

#### Decisions Table
Append new decisions to the bottom. Never renumber existing decisions.
Format per CONVENTIONS.md:
```
| D-{N} | {description} | {confidence} | {session} | {rationale} |
```

#### Open Questions
Update or remove questions that were resolved. Add new open questions.

#### Ideas Generated
Append new ideas.

#### Dead Ends
Append any approaches that were tried and abandoned, with reasons.

### Step 3: Update LOG.md

Append a session continuation section with:
- Date
- Goal (what we set out to do)
- Nick's thinking (capture reasoning, mental models, analogies)
- What happened (what actually occurred)
- Key insight (single most important learning)
- Dead ends (what did not work and why)
- Open threads (what was started but not finished)
- Decisions made (D-IDs)
- Back-propagation fixes (BP-IDs)

### Step 4: Update NEXT.md

Replace the "Immediate Next Action" section with precise instructions for the next session:
- Specific task
- Prerequisites
- Success criteria
- Links to relevant files

### Step 5: Ask the Final Question
Before saving, ask the user:
"Before we close this session, is there anything about your thinking I should capture in the LOG that I might have missed? Any context, reasoning, or intuition you want preserved for the next session?"

Wait for the user's response. Incorporate anything they share.

### Step 6: Confirm
State clearly:
"Session state saved.

Updated files:
- STATE.md: [N new decisions, N new use cases, N new BPs]
- LOG.md: session narrative appended
- NEXT.md: next action set to [summary]

The next session should start by reading HANDOFF.md. Full context will be available through the file-based handoff."

## Critical Rules

- NEVER skip updating these files, even for short sessions
- NEVER renumber existing decisions, use cases, or BPs (append only)
- NEVER fabricate decisions that were not actually made in the session
- ALWAYS ask the user for missed thinking before closing
- ALWAYS save files before ending the session
- ALWAYS update NEXT.md with a concrete, specific next action (not "continue working")

## Error Handling

If the user ends the session abruptly without running this skill:
- Attempt to update files anyway
- Note in LOG.md that the session ended abruptly
- Flag any uncertainty in STATE.md so the next session knows to verify

## Integration

Invoked automatically at session end. Can also be invoked manually by user saying "save state" or "wrap up for today."
