# S-14 — Skills API

**Phase:** 2 · **Workstream:** 4 Skills & agents · **Status:** ✅ **Done** (2026-07-27)
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

---

## Outcome (2026-07-27)

`lib/skills.ts` (discovery) + `lib/tools.ts` (registry & execution) +
`lib/agent-provider.ts` (the AI SDK backing) + two routes. 21 new tests.

### The open question is resolved

The story asked *"where do skills live so they're readable on Vercel?"* —
[08-local-first](../architecture/08-local-first.md) answered it. Skills are read from the
project's own checkout, scoped to the project directory for the same reason tool calls
are (E-11.e): a skill list is something an agent acts on, so where it comes from is a
boundary.

### Skill names are matched, never resolved to paths

`findSkill` matches against *discovered* names rather than building a path from user
input. A name like `../../etc/passwd` simply matches nothing — there is no traversal to
defend against, because no path is ever constructed. Tested.

### The tool registry

Four tools: `read_file`, `write_file`, `list_files`, `bash`. Small, enumerable, and each
declares a description and a Zod schema. Adding one is a deliberate edit to a single
file.

`bash` uses `shell: true` because the model writes command lines, not argv arrays. That
is precisely why the Rule 20 gate runs first — the protection is classification and
confirmation, not an escaping trick.

Execution re-checks paths even though the gate already did. A defence that runs in only
one place is one refactor away from running in none.

### Two real bugs found by tests

**Killing a shell-spawned command didn't kill the command.** `child.kill()` signals only
the shell; on Windows the actual process is a grandchild and kept running. A "timed out"
command would carry on holding files and burning CPU — exactly what the timeout exists to
prevent. Now `taskkill /T` walks the tree on Windows, and POSIX signals the process group
(which needs `detached: true` at spawn).

**A timed-out command reported `exit 1`.** Killing the process makes `close` fire
immediately, so the two outcomes raced and `close` always won — reporting a timeout as a
plain non-zero exit, the kind of misleading error that sends someone debugging the wrong
thing. A `timedOut` flag makes `close` aware.

### Tools are declared without `execute`

The SDK surfaces tool calls rather than running them, so execution stays in the loop
behind the gate. A tool the SDK executed itself would bypass governance entirely.

### Honest limitation

The run route returns the complete result — output, traces, and any pending confirmation
— rather than streaming progress as it happens. The acceptance criterion asked for
streaming; SSE is a natural follow-up alongside the resume UI (S-32), where there is a
surface to stream *into*. The pending-confirmation payload, which is the part that
unblocks a paused agent, is complete.
