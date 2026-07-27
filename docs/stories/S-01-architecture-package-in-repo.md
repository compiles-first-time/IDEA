# S-01 — Land the architecture package in the repo

**Phase:** 2 foundation · **Workstream:** Foundation · **Status:** ✅ **Done** (2026-07-26)
**Component:** — · **Traces to:** `00-opening-prompt.md` Step 0
**Depends on:** nothing · **Blocks:** everything (it's the shared reference)

## Goal

Copy the architecture package from `c:\Users\14134\dev\idea-architecture` into
`docs/architecture/` and commit it, so any future Claude Code session rooted at the
IDEA repo can read the plan without being handed the files.

The opening prompt assumes this has been done. It hasn't — the repo has no `docs/`
directory at all.

## Scope

- `docs/architecture/00-opening-prompt.md` … `06-loom-integration.md` (all seven files)
- A short `docs/architecture/README.md` pointing at the reading order — and stating that
  **[07-amendments.md](../architecture/07-amendments.md) overrides `00`–`06` where they
  disagree**
- Reference `docs/architecture/` and `docs/stories/` from `CLAUDE.md` / `AGENTS.md`
  so they're discovered automatically

> `07-amendments.md` is **already written and in the repo.** It records the adopted
> changes: mandatory local companion, repo-resident conversations, project-per-repo,
> FR-8, FR-9, and the amended exceptions. Files `00`–`06` do not yet reflect any of it.

## Acceptance criteria

- [x] All seven architecture files present under `docs/architecture/`
- [x] The README states the precedence rule: `07` wins over `00`–`06`
- [x] `AGENTS.md` points at the architecture package and the story index
- [x] A fresh chat rooted at the repo can find the plan without external files
- [x] **Known errors annotated, not silently copied** — five listed in the architecture
      README: the `configPath` mistake, the single-scalar `costWeight`, the C-3
      `middleware.ts` "shipped ✅" claim, the `00` Step 0 instruction to read it, and
      `06`'s conflation of Loom with its Observatory

## Outcome

`00`–`06` copied verbatim from `c:\Users\14134\dev\idea-architecture` — **not rewritten**,
so the originals stay intact. Corrections live in
[`docs/architecture/README.md`](../architecture/README.md) as a known-errors table plus
the `07` precedence rule.

`AGENTS.md` now carries the invariants that are easiest to violate by accident:
dependency direction, determinism, fail-closed, the two narrow repo-write carve-outs,
SHA pinning, and redaction-before-persist. It's loaded every session, so it's the right
place for rules whose violation is silent.

## Exceptions honored

- None applicable.

## Notes

- The source directory stays as-is; this is a copy, not a move. If they diverge later,
  the repo copy is the source of truth.
