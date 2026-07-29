# S-46 — Wire up what is already built

**Phase:** 3 · **Status:** Not started · **Traces to:** FR-9, E-9.d
**Depends on:** S-27, S-32, S-15, S-17 (all ✅ done)

## The finding

Features are **fully built, tested, and unreachable**. Same class of defect as
the missing nav: code that works, with no wire to the UI.

Measured 2026-07-29 by checking every API route for a client caller and every
component for an importer — not from memory.

### Done since

| Built | Status |
|---|---|
| Conversation store | ✅ wired (project-scoped, local store) |
| Repo search / read for chat | ✅ wired (`search_files`, `read_file`, `list_files`) |
| Project orientation docs | ✅ wired |

### Still unreachable

| Built | Where | Why it matters |
|---|---|---|
| **Routing, chain, budget** | `lib/router.ts`, `lib/fallback.ts`, `lib/ledger.ts` | **The big one** — see below |
| Model picker | `components/model-picker.tsx`, `/api/models` | No caller; chat cannot choose a model |
| Compaction / resume fidelity | `lib/compact.ts`, `/api/conversations/[id]/plan` | The "will it survive a different model" answer |
| Conversation picker | `components/conversation-picker.tsx` | Never rendered (chat uses a plain dropdown) |
| Local model discovery | `lib/local-models.ts`, `/api/local` | No UI |
| Skills + the agent loop | `lib/skills.ts`, `lib/agent.ts`, `/api/skills/**` | No caller — includes the confirmation flow |
| Loom config reader | `lib/loom-config.ts` | Imported by nothing at all |

### The routing gap

`components/chat-workspace.tsx` sends **no `mode` and no `model`**. `ChatRequest`
defaults `mode` to `"manual"`, so every chat turn runs manual mode against
`defaultModelId()`.

Consequences, all silent:

- The user-ordered fallback chain (S-33) is **never consulted in chat**.
- The spend allocation and budget cap (S-34) never apply.
- Complexity scoring and auto-selection (S-08) never run.
- The `RoutingDecision` *is* computed and streamed as `start` metadata — and the
  UI reads no metadata at all, so it is discarded.

Workstream 2 is six stories, all marked done, and none of it reaches the only
screen where a model gets chosen. Configuring a chain in Settings changes
nothing, which is worse than the feature being absent: the settings page implies
an effect it does not have.

**Fix order:** send `mode`/`model` from chat and render the returned decision.
That is a small change and it activates six completed stories at once.

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
