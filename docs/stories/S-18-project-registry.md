# S-18 — Project registry

**Phase:** 2 · **Workstream:** 6 Projects & Loom · **Status:** ✅ **Done** (2026-07-27)
**Component:** C-21 · **Traces to:** FR-7.1, E-7.b, AD-4, AD-5
**Depends on:** S-02 · **Blocks:** S-19, S-22

## Goal

Declare what a "project" is, so IDEA can be the umbrella hub over many of them. Loom is
the first; the registry is what makes there be a second.

## Scope

- `config/projects.json`
- `lib/projects.ts` — schema, loader, lookups

```ts
ProjectRecord = z.object({
  name: z.string(),                    // "my-project"
  title: z.string(),
  gitUrl: z.string().url(),            // NEW — the project's own GitHub repo
  owner: z.string(),                   // NEW — GitHub owner, for the conversation store
  repo: z.string(),                    // NEW — GitHub repo name
  root: z.string(),                    // "projects/<name>" (git-ignored)
  launch: z.string(),                  // "node observatory/server.mjs"
  dashboardUrl: z.string().url(),      // "http://127.0.0.1:4040"
  configPath: z.string().optional(),   // "observatory/config.yaml"
  conversationBranch: z.string().default("idea/conversations"),  // NEW — S-27
  seededFrom: z.string().optional(),   // NEW — "loom-template", provenance
  autostart: z.boolean().default(false),
});
```

> **Expanded** by the amendments — a project is now a fresh clone of `loom-template` that
> becomes its own GitHub repo, holding that project's source, Loom state, and
> conversations. See [07-amendments.md](../architecture/07-amendments.md) §3.
> `dashboardUrl` may vary per project once there is more than one Observatory —
> don't hard-code `:4040`.

- Add `projects/` to `.gitignore` — **it is not there today** (E-7.b)

## Acceptance criteria

- [ ] `config/projects.json` parses against `ProjectRecord[]`
- [ ] `projects/` is in `.gitignore`; `git status` stays clean after cloning Loom into it
- [ ] `root` is validated as a **relative path inside the repo** — no `..`, no absolute
      paths. This value feeds a process spawn in S-19; treat it as security-relevant.
- [ ] `dashboardUrl` is validated as a URL and restricted to `127.0.0.1`/`localhost`
      (E-7.a — project dashboards are local by definition)
- [ ] `gitUrl` is validated as a GitHub URL and **must agree with `owner`/`repo`** —
      a mismatch is how the conversation store ends up writing to the wrong repository
- [ ] `conversationBranch` defaults to `idea/conversations` and can never be the
      default branch (E-9.a depends on this)
- [ ] Unit tests: valid record, path traversal in `root` rejected, non-local
      `dashboardUrl` rejected, `gitUrl`/`owner`/`repo` mismatch rejected, defaults applied
- [ ] No Next.js imports (§C)

## Exceptions honored

- **E-7.a** Dashboards are local (`127.0.0.1`); Vercel does not host them.
- **E-7.b** Vendored project source is git-ignored, never committed into IDEA.
- **AD-5** Loom is a project, not a fork. IDEA commits **only the registry entry**.

## Notes

- Validating `root` and `dashboardUrl` here is what keeps S-19's `spawn` and S-20's
  proxy safe. A registry that accepts `root: "../../.."` or
  `dashboardUrl: "http://evil.com"` turns those stories into vulnerabilities. Do the
  validation in this story, with tests.
