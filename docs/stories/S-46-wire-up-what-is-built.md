# S-46 — Wire up what is already built

**Phase:** 3 · **Status:** Not started · **Traces to:** FR-9, E-9.d
**Depends on:** S-27, S-32, S-15, S-17 (all ✅ done)

## The finding

Three features are **fully built, tested, and unreachable**. This is the same
class of defect as the missing nav — code that works, with no wire to the UI:

| Built | Where | Reachable from the UI? |
|---|---|---|
| Conversation store (append-only, redacted, SHA-pinned) | `lib/conversation-store.ts`, `/api/conversations` | **No** |
| Conversation picker | `components/conversation-picker.tsx` | **No** — never rendered |
| Local model discovery + endpoint probe | `lib/local-models.ts`, `/api/local` | **No** |

`app/api/chat/route.ts` contains no persistence call at all. `useChat` holds
messages in memory, so closing the tab loses the conversation — exactly what was
observed: open a project, come back, the chat is gone.

This is worth naming as a pattern. Each of these passed its own tests and closed
its own story. "Done" was measured against the library, never against a user
being able to reach it.

## Scope

**Chat persistence (FR-9)**
- `/api/chat` appends each turn through the existing store — the redaction and
  SHA-pinning are already there and must not be bypassed.
- A conversation id in the URL (`/chat?c=<id>`), so a reload resumes.
- Failure to persist is **surfaced, not swallowed** (E-9.d): the store already
  throws "the turn was not saved" after retries; the UI must show it. A chat that
  silently stops saving is the worst outcome.

**Multiple conversations**
- Render `ConversationPicker` in the chat sidebar: list, switch, new, rename.
- Scope conversations to the active project, since that is where they persist.

**Local models**
- A Settings panel calling the existing `GET /api/local` — discovered models,
  where it looked, and the fit classification from `POST /api/local`.
- Probe endpoints (`probeEndpoint()` exists) and connect automatically when one
  answers. Report "found but not reachable" distinctly from "not found" — the
  fixes are different.

## Not in scope

New libraries. Everything needed exists; this story is wiring only. If a change
here requires new `lib/` code, that is a signal the seam was wrong, and it should
be written down rather than absorbed.

## Done when

- A conversation survives a reload, a project switch, and a restart.
- Several conversations exist per project and can be switched between.
- A failed save is visible in the chat, not only in the server log.
- Settings lists local models, and a running endpoint connects without being
  typed in by hand.
