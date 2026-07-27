<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# IDEA

Provider-agnostic multi-LLM chat and agent console that **runs on the user's own
machine** and is distributed as a one-command package (`npx idea`). Shipped so far:
GitHub OAuth + fail-closed allowlist, repo-pull as chat context, streaming chat,
deterministic cost routing, and the conversation-portability spine.

## Read before writing code

- **[`docs/architecture/`](docs/architecture/README.md)** — the design of record.
  Precedence: **`08` beats `07` beats `00`–`06`.**
  [`08-local-first.md`](docs/architecture/08-local-first.md) is the newest — it removed
  the Vercel/companion split. `00`–`06` also contain known errors listed in the README.
- **[`docs/stories/INDEX.md`](docs/stories/INDEX.md)** — the backlog. Every story traces
  to a numbered requirement.

**If a change doesn't trace to a requirement in `01`, `07`, or `08`, it's scope creep.**
Write a story or an exception first.

## Invariants

**Dependency direction** — one way, no exceptions:

```
UI ─▶ API routes ─▶ lib (pure) ─▶ adapters ─▶ git · npm · processes · providers
```

- UI never imports provider SDKs — it calls API routes.
- API routes hold no business logic — they authenticate, validate with Zod, call `lib/`.
- `lib/` pure functions never import Next.js request objects.

> Routes **may** touch the filesystem and spawn processes now — that was a hosting
> constraint, not a design one, and `08` removed it. Everything else above still holds.

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
- **The tool allowlist is now the primary defense, not a secondary one.** Running
  locally means a prompt-injection attack that reaches a tool is no longer bounded by a
  read-only sandbox. Model-invoked tools get no shell, no filesystem, no repo writes
  (E-5.a) — and provisioning is a separate path a model can never trigger (E-8.c).
- **Never modify anything under `projects/`** — vendored, git-ignored, lost on re-clone.
- **Pin commit SHAs** on any repo content injected as context. Unpinned context makes
  stored conversations unreproducible, and there's no backfill.
- **Redact secrets before persisting a conversation.** It becomes a git commit.
- **Bind `127.0.0.1` by default.** Exposing IDEA to a network is an explicit opt-in
  (E-10.b) — it can read files and run commands.

## Commands

```bash
npm start          # run IDEA (builds on first run, opens a browser)
npm run dev        # Next.js dev server
npm test           # unit tests (node --test via tsx)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```
