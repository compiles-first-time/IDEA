<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# IDEA

A gated cloud console (Vercel) — provider-agnostic multi-LLM chat and agent console.
Phase 1 is shipped: GitHub OAuth + allowlist, repo-pull as chat context, streaming chat.

## Read before writing code

- **[`docs/architecture/`](docs/architecture/README.md)** — the design of record.
  **[`07-amendments.md`](docs/architecture/07-amendments.md) overrides `00`–`06`** where
  they disagree, and `00`–`06` contain known errors listed in the architecture README.
- **[`docs/stories/INDEX.md`](docs/stories/INDEX.md)** — the backlog. Every story traces
  to a numbered requirement.

**If a change doesn't trace to a requirement in `01` or `07`, it's scope creep.** Write a
story or an exception first.

## Invariants

**Dependency direction** — one way, no exceptions:

```
UI ─▶ API routes ─▶ lib (pure) ─▶ providers/adapters ─▶ companion (HTTP)
```

- UI never imports provider SDKs — it calls API routes.
- API routes hold no business logic — they authenticate, validate with Zod, call `lib/`.
- `lib/` pure functions never import Next.js request objects.
- Vercel routes never touch a filesystem or spawn a process. That's the companion's job.

**Determinism first (NFR-1).** Routing, cost math, fit classification, manifest parsing,
and conversation handling are plain code with unit tests — not model calls. Pure `lib/`
functions ship with tests: `npm test`.

**Fail closed (NFR-4).** Auth allowlist, tool allowlist, budget caps, and unknown-tool
handling all default to the denied/safe state.

**Secrets (NFR-6).** Provider keys via env only — never in client bundles, chat input,
tool args, or persisted conversations.

## Hard rules that are easy to break by accident

- **No repo writes** beyond two explicit carve-outs: creating a project repo from
  `loom-template`, and writing under `.idea/conversations/**`. No PRs, no issues, no
  source edits. **Tools invoked by a model get neither carve-out.**
- **Never modify anything under `projects/`** — vendored, git-ignored, lost on re-clone.
- **Pin commit SHAs** on any repo content injected as context. Unpinned context makes
  stored conversations unreproducible, and there's no backfill.
- **Redact secrets before persisting a conversation.** It becomes a git commit.

## Commands

```bash
npm run dev        # Next.js dev server
npm test           # unit tests (node --test via tsx)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```
