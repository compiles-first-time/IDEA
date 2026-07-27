# S-14 — Skills API

**Phase:** 2 · **Workstream:** 4 Skills & agents · **Status:** Not started
**Component:** C-18 · **Traces to:** FR-5.1, FR-5.2, FR-5.4, NFR-5
**Depends on:** S-13 · **Blocks:** nothing (completes the skills workstream)

## Goal

Expose skills over HTTP: list what's available, run one, stream the result and its
trace events back.

## Scope

- `GET /api/skills` — list discovered skills as `SkillManifest[]`
- `POST /api/skills/[name]/run` — run a skill with user input via the S-13 loop
- Trace events surfaced to the client and made available to the Observatory (NFR-5)
- Skill discovery: read `SKILL.md` files from a known location (`skills/` in the repo,
  and/or `projects/loom`'s skills after S-22)

## Acceptance criteria

- [ ] `GET /api/skills` returns validated manifests; a malformed `SKILL.md` is reported
      as a skipped-with-reason entry, not a route-wide 500
- [ ] Unauthenticated → **401** on both routes (§6)
- [ ] Running a skill streams progress; tool calls are visible as they happen
- [ ] A skill naming a non-allowlisted tool fails with a clear "tool not allowed" error
      (the S-11 → S-12 → S-13 handoff, verified end-to-end)
- [ ] Routes stay thin — discovery, parsing, and the loop all live in `lib/` (§C)
- [ ] Skill `name` from the URL is validated against discovered skills; **no path
      traversal** into arbitrary files

## Exceptions honored

- **E-5.a / E-5.b** Enforced by S-12/S-13; this route must not add a bypass (e.g. no
  "extra tools" parameter in the request body).
- **NFR-2** Skill discovery reads from the bundled repo, not from user-writable disk
  paths at request time. Mind what actually exists in a Vercel deployment — bundled
  files do, `projects/` (git-ignored) does **not**.

## Notes / open questions

- **Open: where do skills live so they're readable on Vercel?** `projects/loom` is
  git-ignored (E-7.b) and therefore absent from a Vercel build. If we want Loom's skills
  available in the deployed app, they must be either copied into IDEA's own `skills/`
  directory or fetched at run time. Resolve this in S-22 — it's the same
  local-vs-deployed boundary as S-10 and S-19.
