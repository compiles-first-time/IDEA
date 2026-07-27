# S-31 — Projects page

**Phase:** 2 · **Workstream:** 8 Provisioning · **Status:** ✅ **Done** (2026-07-27)
**Component:** C-31 · **Traces to:** FR-8.1, FR-8.3, FR-8.5, FR-8.7, E-8.d, E-7.a
**Depends on:** S-29, S-30 · **Blocks:** nothing

## Goal

The page you actually asked for: every Loom project as a selectable item, one click to
set it up, live progress while it happens, and a clear state for each.

Supersedes the narrower [S-21](S-21-project-pane-ui.md) project pane.

## Scope

`app/projects/page.tsx` + `components/project-list.tsx`:

- Grid or list of projects with state badges:
  `unprovisioned · provisioning · ready · running · error`
- **New project** action → S-30
- Select an unprovisioned project → confirmation showing **what will run** → S-29
- Live per-step progress (`clone → install → bootstrap → verify → start`)
- Ready projects: Open chat · Open Observatory · Stop
- Error projects: the real error, and a retry that resumes

## Acceptance criteria

- [ ] Every registered project renders with accurate live state
- [ ] Provisioning shows the current step and streams output — no indeterminate spinner
      sitting on "Setting up…" (FR-8.3)
- [ ] The confirmation step lists the commands before running them (E-8.d)
- [ ] An error shows the failing step and its actual output, with a working retry
- [ ] **Companion not running → the page says so plainly** and explains how to start it,
      rather than showing every project as broken. This is the most common state for a
      new user and it must not look like a bug.
- [ ] Chat still works with the companion down — conversations go through the GitHub API
      (S-27), so a project can be chatted with even when unprovisioned. Reflect that:
      don't gate chat behind provisioning.
- [ ] Observatory opens as a link to `127.0.0.1:4040` (E-7.a)
- [ ] Calls API routes only — no direct process or filesystem access (§C)

## Exceptions honored

- **E-8.d** User-initiated, commands shown first.
- **E-7.a** Observatory is local; link out rather than embed (see S-21 notes on mixed
  content and `X-Frame-Options`).

## Notes

- **The two capability tiers must be legible.** Conversations and chat work from
  anywhere via the GitHub API; provisioning and the Observatory need the companion.
  A user should never wonder why half the page works. Say it in the UI, once, clearly.
- Consider a persistent companion-status indicator in the app shell rather than
  per-project error states — one honest signal beats six confusing ones.

---

## Outcome (2026-07-27) — S-18, S-29, S-30, S-31 together

Four stories land as one flow: **create a project → set it up → open it.**

| Story | Lands as |
|---|---|
| S-18 | `lib/projects.ts` — the registry, validated |
| S-29 | `lib/provision.ts` — clone → install → bootstrap → verify → start, in-process |
| S-30 | `lib/scaffold.ts` — a fresh repo seeded from `loom-template` |
| S-31 | `components/project-list.tsx` + `app/projects/page.tsx` |

### Registry validation is security, not cosmetics

`root` feeds a process spawn and `dashboardUrl` feeds a link, so the schema rejects path
traversal, absolute roots, non-local dashboard hosts, a `gitUrl` that disagrees with
`owner/repo` (which would write conversations to the wrong repository), and a conversation
branch of `main` or `master`.

### State is derived, never remembered

`isProvisioned` reads `.git` from disk; `running` comes from probing the port. A pid held
in memory would be wrong the moment IDEA restarts, and a stale "Running" badge is worse
than no badge.

### Provisioning is idempotent and resumable

An existing checkout skips `clone`; existing `node_modules` skips `install`. A test
provisions, fails at `install`, then re-runs and confirms `clone` is **not** repeated —
FR-8.6 means resuming, not starting over.

Commands are **argv arrays, never shell strings**. Provisioning arguments come from the
registry — a repo URL, a directory name — and a shell would turn a hostile value in either
into command injection. (The agent-facing `bash` tool *does* use a shell; that path is
gated by Rule 20. This one is not user-directed at all, so it takes the stricter option.)
A test asserts no shell metacharacter ever reaches an argv element.

### Creating a project

Prefers GitHub's template-generate API — a clean repo, no shared history, no fork link.
**Private by default** (E-8.b), because the repo will hold conversation transcripts.

If `loom-template` is not marked as a GitHub template repository, an empty repo is created
and the UI **says so** rather than silently producing something different from what was
asked for. That also answers one of the backlog's open questions without needing to
check first.

`loom-template` itself is refused as a target in code (E-8.e), not left to convention.

### The page

Live per-step progress over NDJSON — "Cloning the repository", "Installing dependencies" —
rather than an indeterminate spinner (FR-8.3). Setup shows **the exact commands it will
run** before running them (E-8.d), including the honest note that installing a repository
runs its own setup scripts, the same as `git clone && npm install` would.

Initial data loads **server-side**. A lint rule flagged the mount effect, and it was right:
moving the fetch to the server component removed the effect, the loading flash, and a round
trip.
