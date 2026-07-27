# S-30 — Project creation (fresh clone of loom-template)

**Phase:** 2 · **Workstream:** 8 Provisioning · **Status:** Not started
**Component:** C-33 · **Traces to:** FR-8.2, E-8.b, E-8.e, GE-4 (amended), AD-5
**Depends on:** S-18, S-29 · **Blocks:** S-31

## Goal

"New project" produces a **fresh repo seeded from `loom-template`** under the user's
GitHub account, which then becomes that project's own repo — holding its source, its Loom
state, and its conversations.

This matches Loom's own model: *"each new project gets a fresh warp of Loom threaded into
it via the bootstrap step."* The template is a seed, never a shared container.

## Scope

`lib/scaffold.ts` + `app/api/projects/create`:

1. Create the new repo from `loom-template` — **private by default** (E-8.b)
2. Register it in `config/projects.json` (S-18)
3. Hand off to the companion for clone → install → bootstrap → start (S-29)
4. Create the `idea/conversations` branch so S-27 has somewhere to write

**Prefer GitHub's template-generate API** (`POST /repos/{owner}/{repo}/generate`) if
`loom-template` is marked as a template repo — it creates a clean repo with no shared
history, entirely over REST, no filesystem, works from Vercel. **Verify that flag first**;
if it isn't set, fall back to companion-side clone-and-push, or ask the user to set it.

## Acceptance criteria

- [ ] Creating a project yields a new GitHub repo seeded from `loom-template`
- [ ] **The new repo is private** unless the user explicitly opts out, and the opt-out
      warns that conversations will be stored there (E-8.b)
- [ ] The new repo has clean history — it is not a fork and carries no upstream link
- [ ] `loom-template` itself is **never** written to (E-8.e, AD-5) — assert it, since a
      misconfigured token plus a wrong owner is exactly how that accident happens
- [ ] Name collision with an existing repo is caught **before** any work, with a clear message
- [ ] A registry entry is written only after the repo exists — no orphan entries
- [ ] Failure part-way leaves no half-registered project
- [ ] Every route re-checks `auth()` → 401 (§6)
- [ ] Repo creation uses the caller's session token — IDEA never creates repos under any
      account but the signed-in user's

## Exceptions honored

- **GE-4 (amended)** Repo creation is carve-out (a). Still no PRs, no issues, no source
  writes, no deletion.
- **E-8.b** Private by default.
- **E-8.e** Never push to `loom-template`.
- **AD-5** Loom stays independent. A project is *seeded from* the template, not coupled to it.

## Notes / open questions

- Needs the `repo` OAuth scope for private repo creation — Phase 1 already requests
  `repo` (see PF-1), so verify rather than assume.
- **Open: does the user pick the template?** Right now `loom-template` is hard-coded as
  the only seed. A `templates` registry would generalize it cheaply, but YAGNI until
  there's a second template. Recommend hard-coding with the seam obvious.
- **Open: what does "bootstrap" mean concretely?** Loom has a bootstrap step that stamps
  placeholders and threads the warp into a project. Read `loom-template`'s
  `scripts/` and `README.md` bootstrap section before building this — the exact command
  and its prompts determine whether it can run unattended, which FR-8.2 requires. If it's
  interactive, this story needs a non-interactive path.
