# HANDOFF — Build Session Startup Guide

**If you are a new Claude instance reading this, START HERE.**

This file is the first thing any new BUILD session should read. It tells you what the build is, where it stands, what is expected of you, and what to do next.

---

## What This Directory Is

**Purpose:** Implementation of the predictive governance platform specified in `explore/002-spec-expansion/expanded-specs/` and validated in `working/Platform_Requirements_and_Exceptions.xlsx`.

**Phase:** Phase 4 — Implementation (about to begin)

**Prior phases:**
- Phase 1 (Validation) — deferred, not required before Phase 3
- Phase 2 (Spec Expansion) — complete in `002-spec-expansion` Session 1-2
- Phase 2b (Workbook Cross-Verification) — complete in `002-spec-expansion` Session 3 (484/484 bidirectional coverage)
- Phase 3 (Build Environment Setup) — complete 2026-04-11 (this directory)

**Owner:** Nick (human). Same visual-first, verbose-but-explicit, analogy-driven, no-emoji communication preferences as the exploration phases.

---

## Mandatory Reading Order

Read these files IN THIS ORDER before responding to the user. Do not skip any.

### Step 1: Project-Level and Build-Level Context
1. `D:\Projects\IDEA\CLAUDE.md` — project instructions, cardinal rules
2. `D:\Projects\IDEA\build\CLAUDE.md` — build chat instructions (the no-guessing rule, implementation workflow, read-only files)

### Step 2: Build State
3. `D:\Projects\IDEA\build\STATE.md` — current build state (decisions, progress counters)
4. `D:\Projects\IDEA\build\LOG.md` — session-by-session narrative
5. `D:\Projects\IDEA\build\NEXT.md` — precise next action
6. `D:\Projects\IDEA\build\PROGRESS.md` — 484 SR status tracker

### Step 3: Build Conventions and Glossary
7. `D:\Projects\IDEA\build\CONVENTIONS.md` — SR-row format, identifier conventions, exception coverage rules
8. `D:\Projects\IDEA\build\GLOSSARY.md` — all named concepts
9. `D:\Projects\IDEA\build\DECISION-INDEX.md` — fast decision lookup (D-1 through D-77)

### Step 4: Spec Files (as needed during implementation)
10. `D:\Projects\IDEA\build\spec\*.md` — 14 expanded specs (READ-ONLY; never modify)

### Step 5: Validation (as needed)
11. `D:\Projects\IDEA\build\validation\Platform_Requirements_and_Exceptions.xlsx` — 248 BRs, 666 SR refs (READ-ONLY)
12. `D:\Projects\IDEA\build\validation\_xverify_phase_a.py` — cross-verification tool (run any time spec or workbook appears touched)

### Step 6: Upstream Exploration Context (reference only)
13. `D:\Projects\IDEA\explore\BASE-STATE.md` — trunk architecture
14. `D:\Projects\IDEA\explore\002-spec-expansion\STATE.md` — the closing state of spec expansion

---

## Current State Snapshot (as of Phase 3 close, 2026-04-11)

| Metric | Value |
|--------|-------|
| Expanded specs in build/spec/ | 14 files |
| Total SR rows | 484 |
| Validation workbook BR rows | 248 |
| Cross-reference coverage | 484 / 484 bidirectional |
| Broken references | 0 |
| Unreferenced SRs | 0 |
| Skills installed | 7 (in `.claude/skills/`) |
| Agents installed | 5 (in `.claude/agents/`) |
| Cumulative back-propagation fixes | 134 (BP-1 through BP-134) |
| Implementation progress | 0 SRs implemented |

**Blocking:** None. Ready for Phase 4 implementation once Nick confirms the first SR to implement.

---

## Cardinal Rules (Non-Negotiable)

1. **No guessing.** Verify every task against a spec. If not in spec, HALT.
2. **Architecture is locked.** 77 decisions, 195 scenarios, 98 gap resolutions, 484 SRs — all locked.
3. **Spec is the source of truth, not memory or intuition.**
4. **Best solution regardless of complexity.**
5. **Governance is foundational.**
6. **Evidence grades on every decision.**
7. **No fabrication.**
8. **Trace every line of code to an SR.**
9. **Update state at session end.**
10. **Accuracy, integrity, compatibility cannot be bargained with; they must be perfect.** (Nick, 2026-04-11)
11. **Cross-verify workbook and specs after any edit.** `_xverify_phase_a.py` exit code 0 or HALT.

---

## What You Should Do at Session Start

1. Read the files in the mandatory reading order above
2. Run the `context-loader` agent in `.claude/agents/context-loader.md`
3. Confirm to Nick: "I have read [list of files]. Current state is [summary]. Next action per NEXT.md is [action]. Should I proceed?"
4. Wait for confirmation

## What You Should Do During a Session

1. Every claim references a file or established source
2. Every decision logged immediately in STATE.md
3. Every significant event captured in LOG.md
4. Run `verify-against-spec` before implementing
5. Run `trace-requirement` during self-review
6. Run `generate-test-from-spec` after implementing
7. Run `implementation-reviewer` before committing
8. Re-run `_xverify_phase_a.py` if any spec or workbook file appears touched

## What You Should Do at Session End

1. Run the `update-state-log` skill in `.claude/skills/update-state-log.md`
2. Update STATE.md, LOG.md, NEXT.md, PROGRESS.md
3. Ask Nick: "Before we close, is there anything about your thinking I should capture?"
4. Confirm file saves
5. Report: "Session state saved. Next session should start by running context-loader."

---

## What You Should NEVER Do

- Modify spec files (`spec/*`)
- Modify validation files (`validation/*`)
- Modify trunk files (`D:\Projects\IDEA\source\*`, `master\*`)
- Modify exploration files (`D:\Projects\IDEA\explore\*`)
- Write code without an SR reference
- Skip tests
- Commit without SR references in message
- Proceed past ambiguity
- Use emojis
- Claim things you did not verify
- Skip context-loader at session start or update-state-log at session end

---

## If You Disagree with This File

If you read this file and believe something is wrong or outdated:
1. STOP
2. Do not silently proceed with a different approach
3. Report your concern to Nick with specific references
4. Wait for explicit instruction

Nick values correction over appeasement.
