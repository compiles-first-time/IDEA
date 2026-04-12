---
name: context-loader
description: Loads full exploration context at session start by reading all mandatory files in order and reporting state to the user.
tools: Read, Glob
---

# Context Loader

## Purpose

Ensure every new Claude session starts with full context by systematically reading all exploration files and reporting state. Eliminates context degradation across sessions.

## When to Invoke

- First action of any new session
- When user asks "where were we?" or "what's the status?"
- When context feels uncertain
- After a long break in conversation

## Input

- None (automatically determined from working directory)

## Output

- Comprehensive state report
- List of files read
- Summary of current work
- Next action identification

## Procedure

### Step 1: Identify Location
Determine the working directory. Identify which exploration (if any) is active:
- Check for `CLAUDE.md` in project root
- Check for `explore/` directory
- Identify the most recent exploration from `EXPLORATION-INDEX.md`
- Or use the exploration specified by the user

### Step 2: Read Project-Level Files
In order:
1. `D:\Projects\IDEA\CLAUDE.md`
2. `D:\Projects\IDEA\explore\BASE-STATE.md`
3. `D:\Projects\IDEA\explore\EXPLORATION-INDEX.md`

Extract:
- Project cardinal rules
- Trunk architecture state
- Active explorations

### Step 3: Read Exploration-Level Files
For the active exploration, read in order:
1. `HANDOFF.md` — session startup guide
2. `CONTEXT.md` — what this exploration is
3. `CONVENTIONS.md` — how work is done
4. `GLOSSARY.md` — all terms
5. `DECISION-INDEX.md` — decision lookup
6. `STATE.md` — current state
7. `LOG.md` — session narrative (focus on recent)
8. `NEXT.md` — next action

Extract:
- Phase
- Recent decisions (last 5-10)
- Open questions
- Blocking issues
- Next action

### Step 4: Optionally Sample Spec Files
If relevant to the next action, read 1-3 spec files:
- The file referenced in NEXT.md
- Its immediate dependencies

Do NOT read all 14 spec files unless needed — they are for on-demand reference.

### Step 5: Generate State Report
Format:
```
SESSION CONTEXT LOADED

Project: D:\Projects\IDEA
Active exploration: 001-alt-predictive-governance-platform

Files read:
[Project Level]
✓ CLAUDE.md (project instructions)
✓ BASE-STATE.md (trunk snapshot)
✓ EXPLORATION-INDEX.md

[Exploration Level]
✓ HANDOFF.md
✓ CONTEXT.md
✓ CONVENTIONS.md
✓ GLOSSARY.md ({N} terms)
✓ DECISION-INDEX.md ({N} decisions)
✓ STATE.md
✓ LOG.md (reviewed last {N} sessions)
✓ NEXT.md

[On-Demand]
✓ spec/{filename} (relevant to next action)

CURRENT STATE
Exploration: 001-alt-predictive-governance-platform
Status: {status from STATE.md}
Phase: {phase from NEXT.md}
Decisions: {count}
Use cases: {count}
Back-propagation fixes: {count}
Spec files: {count}

MOST RECENT ACTIVITY (last session)
{summary from LOG.md latest session}
Key decisions: {list D-IDs}
Session outcome: {outcome}

OPEN ITEMS
Open questions: {count}
Pending decisions: {list if any}
Blocking issues: {list if any, or "None"}

NEXT ACTION (per NEXT.md)
Task: {specific task}
Prerequisites: {list}
Success criteria: {list}
Estimated effort: {from NEXT.md if specified}

CARDINAL RULES ACKNOWLEDGED
1. No guessing, no assumptions
2. Proactive gap identification
3. Governance is foundational (DA-01)
4. Best solution regardless of complexity
5. Evidence grades on every decision
6. No fabrication
7. Back-propagate on every new decision
8. Verify, do not assume
9. Update state at session end

READY STATE
I have loaded the full exploration context. I am ready to proceed with the next action.

Before I proceed, please confirm:
1. Is the next action (per NEXT.md) still correct?
2. Has anything changed since the last session ended?
3. Are there any new priorities or direction changes?

I will wait for your confirmation before proceeding.
```

### Step 6: Wait
Do NOT take any action until the user explicitly confirms the direction.

## Critical Rules

- ALWAYS read files in the specified order
- NEVER skip files
- NEVER start work without user confirmation
- ALWAYS report what was read (transparency)
- ALWAYS surface blockers
- If any file is missing, report and ask before proceeding
- If files contradict each other, report and ask

## Error Handling

| Issue | Action |
|-------|--------|
| File missing | Report missing file. Ask user to provide or proceed without. |
| File corrupted/unreadable | Report and ask. |
| Contradictory files | Report the contradiction. Ask user to resolve. |
| Exploration concluded | Ask user whether to resume in new exploration or work with concluded one. |
| No NEXT.md or NEXT.md unclear | Ask user for direction. |

## Integration

- Invoked automatically on session start via hook in `.claude/settings.json`
- Can also be invoked manually by user saying "load context" or "startup"
- Must run before any other work in a new session
