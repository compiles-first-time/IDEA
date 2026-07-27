# S-27 — Conversation store (GitHub API)

**Phase:** 2 · **Workstream:** 7 Conversations · **Status:** ✅ **Done** (2026-07-27)
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

---

## Outcome (2026-07-27)

`lib/conversation-store.ts` (logic, 26 tests) + `lib/github-store.ts` (Octokit adapter)
+ `app/api/conversations/{route,[id]/route}.ts`.

### Why still the GitHub API, after local-first

The original rationale — "works from a Vercel function without a checkout" — died with
[08-local-first](../architecture/08-local-first.md). Three reasons survive, and they're
better ones:

1. **It writes to a different branch without touching the working tree.** No conversation
   files in `git status`, none swept into the user's commits, no merge conflicts with
   work in progress. Writing to a non-checked-out branch locally would need a worktree or
   git plumbing; over the API it's one call.
2. One call is durable *and* pushed. A local write still needs commit + push.
3. It works before a project has been cloned.

### The testability seam

All I/O goes through a `RepoFileStore` interface. The logic is tested against an
in-memory fake — concurrency, conflicts, 403s, corrupt files — with no network. The
Octokit implementation is the only part that touches GitHub, and it is thin enough to
read in one screen.

### Redaction cannot be bypassed

There is no parameter, flag, or alternative path that writes an unredacted turn. A test
greps the module to prove it: exactly one `serializeTurns(` call, and `redactTurn(`
appears before it. The `extraSecrets` argument only *adds* values.

The route passes `session.accessToken` as an extra secret, so the GitHub token can never
reach a commit even by way of a tool result.

Turns are stamped and sequenced *before* redaction, so the redacted turn is exactly what
gets hashed, written, and read back — the layer-1 hash covers what is actually stored.

### Bug found and fixed by a test

On the final retry attempt, a conflict threw the raw upstream message (`"sha mismatch"`),
which tells a user nothing. It now throws `"could not append after 3 attempts … the turn
was not saved"` — E-9.d is about the user knowing their turn is gone, not about an error
merely existing.

### Verified

- Round trip create → append → load, hash-verified
- Every write under `.idea/conversations/**`, every write on the conversations branch,
  never on the default branch
- Traversing conversation id rejected **before** any write occurs
- Concurrent-append conflict retried and succeeds without duplicating or dropping a turn
- No write access → `403` with a message saying the turn was not saved
- Append-only JSONL: an earlier turn's line is byte-identical after a later append
- A corrupt conversation does not hide the others in a listing
