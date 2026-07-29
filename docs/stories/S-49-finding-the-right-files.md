# S-49 — Finding the right files without attaching all of them

**Phase:** 3 · **Status:** Partly built (`search_files` ✅) · **Traces to:** FR-3, FR-9.4
**Depends on:** S-12, S-13 (done) · **Blocks:** nothing

## The problem

Opening a project and asking about it gets *"I don't have access to your files"*,
because files reach the model only when clicked. Attaching everything is not the
fix: a mid-size repo is far past any context window, and it would be paid for on
every message.

So: which files should reach the model for a given question?

## The options considered

| Approach | Verdict |
|---|---|
| **README with an index** | Yes for **orientation**, no for lookup |
| **JSON topic → path map** | **No** — the failure mode is silent and confident |
| **Hash table** | Not a separate approach — see below |
| **Search at query time** | **Yes** — the default |
| **Embeddings / vector index** | Later, if measurement demands it |

### Why not a maintained index

A hand-written map from topics to files is a **second source of truth about the
code**, and it drifts the moment someone moves a file. That would be tolerable if
it failed loudly. It does not: a stale index confidently points at the wrong
place, and the model follows it, reads the wrong file, and answers from the wrong
premise. **A wrong index is worse than no index**, because no index makes the
model search and find the truth.

Every argument for precomputing collapses here too. The repo is on local disk.
Searching a few thousand files is milliseconds. There is no network round trip to
amortise, so the index buys latency that was never the constraint and pays for it
in staleness.

### On the hash table

A hash table is the data structure *inside* a keyword index, not an alternative
to one. The real question is whether to maintain an index at all — and if the
answer ever becomes yes, the structure is an inverted index (term → postings),
with a hash map as its container. Worth naming precisely so the decision is about
staleness and cost rather than about containers.

### Where a README-style file does earn its place

Orientation, not lookup. A short hand-written map — what this project is, where
the entry points are, what the top-level directories mean, which invariants are
non-negotiable — encodes **intent that cannot be derived from the code**. Search
can find every use of `selectModel`; it cannot tell you that routing must stay
deterministic.

Loom already ships exactly this: `AGENTS.md`, `CLAUDE.md`, `README.md`. IDEA's
own `AGENTS.md` is the same shape. Nothing new to invent — attach it.

## The decision

**Orientation is attached; location is searched.**

1. **Auto-attach the project's orientation files** on first message — `AGENTS.md`,
   `CLAUDE.md`, `README.md`, whichever exist, capped at a few thousand tokens.
   Cheap, stable, and it answers "what is this and where do I start".
2. **Give the model search and read tools** so it finds the rest itself, at
   query time, against the code as it is right now. Never stale by construction.
3. **No maintained topic index.** If searching ever proves too slow or too
   imprecise, revisit with a measurement rather than an assumption.

## Built (this change)

`search_files` — pattern search over the project's text files, returning paths
and matching lines.

It exists so that finding something does not require `bash`. Handing the model a
shell to run `grep` works, but carries the whole shell: a far wider permission
surface than "read some files and say which lines matched", classified and gated
on every call. A narrow tool is cheaper to reason about and cannot be talked into
doing something else.

Details that matter:

- `node_modules`, `.git`, `dist`, `.next` skipped — searching dependencies buries
  the project's own code.
- Binary files skipped by looking for a NUL byte, **not by extension**, because
  extensions lie.
- Truncation is reported, never silent: "50 matches" and "at least 50 matches"
  lead to different next moves.
- An invalid regex is a reported error, not a crash.
- Paths outside the project are refused by the existing scope gate.

## Remaining

- Wire the agent loop (S-13) into `/api/chat` so the model can call these tools.
  Same pattern as S-46: the loop, the registry, and the permission gate are all
  built and tested; nothing calls them from chat.
- Auto-attach orientation files when a project is selected.
- **Bind the file sidebar to the selected project.** Today it lists GitHub repos
  independently, so you can attach files from repo A while saving to project B.

## Note for remote repos

Search assumes the project is on disk, which is true for a provisioned project.
A repo reached only through the GitHub API cannot be walked cheaply — that case
needs GitHub's code-search API, and is deliberately out of scope here rather than
pretended to work.
