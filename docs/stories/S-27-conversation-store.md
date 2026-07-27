# S-27 — Conversation store (GitHub API)

**Phase:** 2 · **Workstream:** 7 Conversations · **Status:** Not started
**Component:** C-27 · **Traces to:** FR-9.1, FR-9.2, E-9.a, E-9.d, GE-4 (amended)
**Depends on:** S-23, S-25, **S-26 (hard blocker)** · **Blocks:** S-28, S-32

## Goal

Persist and load conversations by committing them to the project's own repo over the
GitHub REST API. No local checkout, no database — which means it works from a Vercel
function and does **not** depend on the companion running.

## Scope

`lib/conversation-store.ts` + `app/api/conversations/*`:

- `list(project)` → conversation metadata for a project
- `load(project, id)` → `{ meta, turns }`
- `appendTurn(project, id, turn)` → redact (S-26) → commit
- `create(project, title)` → new conversation id + `meta.json`

Writes go to `.idea/conversations/` on a **dedicated branch** (e.g. `idea/conversations`),
via the Contents API using the caller's session `accessToken`.

## Acceptance criteria

- [ ] Round-trip: create → append N turns → load returns exactly what was written,
      **hash-verified** (this completes the layer-1 100% guarantee end to end)
- [ ] **Redaction (S-26) runs on the write path and cannot be bypassed** — no parameter,
      no code path, no "raw" mode writes an unredacted turn
- [ ] Writes touch **only** `.idea/conversations/**` — enforced in code, with a test that
      a path outside that prefix is rejected (E-9.a)
- [ ] Never writes to the default branch; the conversation branch is created if absent
- [ ] A user without write access gets a clear error and the turn is **not** silently
      lost — the UI must be able to say "not saved" (E-9.d)
- [ ] Concurrent appends don't clobber: handle the Contents API's SHA-conflict path with
      a retry, tested
- [ ] Rate-limit and 409 responses are handled, not swallowed
- [ ] Every route re-checks `auth()` → 401 (§6)
- [ ] Routes stay thin; commit logic lives in `lib/` (§C)

## Exceptions honored

- **GE-4 (amended)** Writes confined to `.idea/conversations/**`. No PRs, no issues, no
  source edits, no branch deletion.
- **E-2.a** REST API only, no clone — which is exactly why this works on Vercel.
- **E-9.c** Enforced upstream by S-26, re-verified here.
- **E-9.d** Write failures surface.

## Notes / open questions

- Committing per turn is a lot of commits. Options: one commit per turn (best durability,
  noisy history), debounce and batch (fewer commits, a crash loses the tail), or commit on
  conversation close (cleanest history, worst durability). **Recommend per-turn on a
  dedicated branch** — the branch is already segregated, so history noise costs nothing,
  and durability is the entire point of persisting.
- The conversation branch never merges to the default branch. Say so in the story when
  you build it, or someone eventually will.
- Because this path is API-only, conversations keep working when the companion is off.
  Preserve that property — it's what makes chat usable from any device.
