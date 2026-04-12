---
name: session-startup
description: At the start of every session, reads all mandatory context files in order and reports state to the user before proceeding.
---

# Session Startup

## When to Invoke

- Always, as the first action of any new session
- When a user asks "where were we?" or "what's the status?"
- When context feels uncertain and needs resetting

## What This Skill Does

1. Reads the mandatory context files in the order specified in HANDOFF.md
2. Extracts the current state
3. Reports to the user what was read and what state the exploration is in
4. Identifies the next action per NEXT.md
5. Waits for user confirmation before proceeding with any work

## Procedure

### Step 1: Read HANDOFF.md
This is the entry point. Read it completely. It contains:
- What the exploration is
- Mandatory reading order
- Current state summary
- Cardinal rules
- Expected behaviors

### Step 2: Read in Mandatory Order
Per HANDOFF.md, read in this order:
1. `CLAUDE.md` (project level)
2. `BASE-STATE.md` (trunk)
3. `CONTEXT.md` (exploration)
4. `CONVENTIONS.md`
5. `GLOSSARY.md`
6. `DECISION-INDEX.md`
7. `STATE.md`
8. `LOG.md` (focus on most recent session)
9. `NEXT.md`

Do NOT skip any. Do NOT speed-read. Spec files can be read on demand during work; these foundation files must be fully absorbed.

### Step 3: Extract Current State
From the files, extract:
- Phase (what high-level phase we are in)
- Most recent decisions (last 5-10 D-IDs)
- Open questions
- Blocking issues
- Next action per NEXT.md
- Any explicit instructions from the user in recent LOG entries

### Step 4: Report to User
Format:
```
SESSION STARTUP COMPLETE

I have read the following files:
✓ CLAUDE.md (project instructions)
✓ BASE-STATE.md (trunk snapshot)
✓ HANDOFF.md (session handoff)
✓ CONTEXT.md (exploration context)
✓ CONVENTIONS.md (working conventions)
✓ GLOSSARY.md ({N} terms defined)
✓ DECISION-INDEX.md ({N} decisions)
✓ STATE.md (full current state)
✓ LOG.md (reviewed recent sessions)
✓ NEXT.md (next action loaded)

CURRENT STATE
Phase: [phase name]
Most recent decisions: [D-XX, D-XX, D-XX]
Open questions: [count] (most recent: [description])
Blocking issues: [none / list]

NEXT ACTION (per NEXT.md)
[description of next action]
Prerequisites: [list]
Success criteria: [list]

CARDINAL RULES ACKNOWLEDGED
- No guessing, no assumptions
- Proactive gap identification
- Governance is foundational
- Always pick best solution regardless of complexity
- Update state before closing

I am ready to proceed with the next action. Should I proceed, or would you like to take a different direction?
```

### Step 5: Wait for User
Do NOT proceed with any work until the user explicitly confirms the direction.

The user may:
- Confirm and say "proceed"
- Redirect: "actually, let's do X instead"
- Ask for clarification
- Add new context

Only after explicit direction do you begin work.

## Critical Rules

- ALWAYS read files in the mandatory order
- NEVER skip files to save time
- NEVER start work without user confirmation
- ALWAYS report what was read (transparency)
- ALWAYS surface blocking issues immediately
- If a file is missing or corrupted, HALT and report

## Error Handling

If a mandatory file is missing:
- STOP
- Report which file is missing
- Do not attempt to recreate it from memory
- Ask the user whether to proceed without it or fix it first

If a file contradicts another file:
- STOP
- Report the contradiction
- Ask the user to resolve
- Do not silently pick one version

## Integration

This skill runs automatically on every new session. Configured via a hook in `.claude/settings.json` or invoked by the user saying "startup" or "begin."
