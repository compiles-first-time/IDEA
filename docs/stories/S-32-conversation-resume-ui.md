# S-32 — Conversation resume UI

**Phase:** 2 · **Workstream:** 7 Conversations · **Status:** ✅ **Done** (2026-07-27)
**Component:** C-32 · **Traces to:** FR-9.1, FR-9.5, FR-9.6, E-9.b, E-9.d
**Depends on:** S-24, S-27, S-28 · **Blocks:** nothing

## Goal

Where the whole conversation workstream becomes visible: pick a past conversation for a
project, see exactly how faithfully it will resume on the chosen model, and continue it —
on a different model than it started on, if you want.

## Scope

`components/conversation-picker.tsx` + chat workspace integration:

- List a project's conversations (title, last updated, models used, turn count)
- Open one → rendered history in the chat view
- **Fidelity banner before resuming** — the S-28 report, in plain language
- Continue the conversation; new turns append via S-27
- Model switching mid-conversation, with the fidelity report recalculated for the new
  target

## Acceptance criteria

- [ ] Conversations list per project, most recent first
- [ ] Opening one renders the full history from canonical form (S-23), including tool
      calls and repo context
- [ ] The fidelity report shows **before** resuming, not after: *"Full context"* or
      *"Compacted 340k → 7k, 12 turns summarized, 2 file contexts unavailable"* (FR-9.6)
- [ ] Switching models recalculates and re-displays fidelity — a switch that would
      compact heavily is visible *before* the user commits to it
- [ ] A conversation started on Claude resumes on an OpenAI-compatible or local model
      with no error and a correct fidelity report (**FR-9.5 demonstrated end to end** —
      this is the acceptance test for the whole workstream)
- [ ] A turn that fails to persist (S-27) is shown as unsaved, not silently dropped (E-9.d)
- [ ] Turns where redaction fired are marked (S-26)
- [ ] Calls API routes only (§C)

## Exceptions honored

- **E-9.b** The UI reports what the model *received*. It never implies the model will
  respond identically to how the previous one would have.
- **E-9.d** Persistence failures are visible.

## Notes

- **The fidelity banner is the product surface for the "99% accuracy" requirement.**
  Everything upstream — canonical format, adapters, SHA pinning, compaction — exists so
  this banner can be honest. Make it specific and legible; a vague "some context may be
  lost" wastes all of it.
- Good demo moment: start a conversation on Opus, resume it on Haiku, show the banner
  explaining precisely what changed. That single flow exercises S-23 through S-28.
