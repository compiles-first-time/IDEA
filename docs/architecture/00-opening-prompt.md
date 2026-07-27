# IDEA — Opening Prompt (paste this into a fresh IDEA-rooted chat)

> **How to use:** Open a VS Code window on `c:\Users\14134\dev\IDEA`, start a new
> Claude Code chat, and paste this whole file as your first message. The other
> documents in this folder (`01`–`06`) are the architecture package — attach or
> copy them into the IDEA repo under `docs/architecture/` so the chat can read
> them. This file is self-contained enough to work even if the others aren't
> present yet, but it's better with them.

---

You are picking up **IDEA**, a gated cloud web app (Vercel) — a provider-agnostic
multi-LLM chat + agent console. **Phase 1 is already shipped and committed on
`main`** (`7e48ed3`): streaming chat against Claude via the Vercel AI SDK,
GitHub-OAuth auth with a fail-closed allowlist, and GitHub repo-pull as chat
context. Do **not** rebuild Phase 1. Read the existing code first.

## Step 0 — Orient (read before writing anything)

1. Read `CLAUDE.md` (if present) and the shipped Phase-1 code:
   - `auth.ts`, `middleware.ts`, `app/api/auth/[...nextauth]/route.ts`
   - `lib/github.ts`, `app/api/repos/route.ts`, `app/api/repos/tree/route.ts`, `app/api/repos/file/route.ts`
   - `app/api/chat/route.ts`, `components/chat-workspace.tsx`, `app/page.tsx`, `app/login/`
2. Read this architecture package in order:
   - `01-vision-requirements-exceptions.md` — what we're building and, importantly, what we are **not**.
   - `02-architecture-spec.md` — the system design and phase plan.
   - `03-component-map.md` — components → files/routes → dependencies, with requirements traceability.
   - `04-process-flows.md` — auth, repo-pull, chat, model-routing, skills/agents, project-registry flows.
   - `05-data-contracts.md` — Zod-shaped request/response and registry schemas.
   - `06-loom-integration.md` — how Loom's Observatory becomes IDEA's first "project."

## Step 1 — Pull Loom into IDEA as the first "project"

Loom (the Observatory) is IDEA's first embedded project. It already exists
locally and on GitHub:

- **Local path:** `c:\Users\14134\dev\loom-template`
- **Remote:** `https://github.com/compiles-first-time/loom-template.git`
- **Run the Observatory:** `node observatory/server.mjs` → serves `http://127.0.0.1:4040`

Bring Loom in as a **vendored, ignored sibling** (do not commit Loom's source into
IDEA). From the IDEA repo root, run:

```bash
# Preferred: clone fresh so the project registry has a clean checkout
git clone https://github.com/compiles-first-time/loom-template.git projects/loom
# (or, if you'd rather reuse the local checkout, copy it)
# cp -r /c/Users/14134/dev/loom-template projects/loom
echo "projects/" >> .gitignore
```

Then register it in IDEA's project registry per `06-loom-integration.md`
(name `loom`, dashboard `http://127.0.0.1:4040`, launch `node observatory/server.mjs`).
IDEA should be able to **start/stop** the Observatory and **iframe/proxy** it as a
project pane, and read its `config.yaml` (Models & Budget / cost_rates) to seed
the cost side of model routing.

## Step 2 — Confirm the plan, then build Phase 2

Phase 2 scope (see `01` and `02` for detail):

1. **Model routing** — manual model picker **plus** an "automatic" mode that scores
   prompt complexity and routes to the cost-appropriate model. Deterministic/
   rule-based first; per-model cost weight ("monetary adjustment") from the
   registry. No ML classifier in Phase 2.
2. **Portable skills/agents runtime** — run Loom-style `SKILL.md` / agent
   definitions through an agent loop on **any** provider (Claude primary), using
   the AI SDK's provider-agnostic tool-calling.
3. **Local models** — user-supplied local endpoint (OpenAI-compatible), Hugging
   Face model search/install, local-path / HF-cache discovery, and a
   size-vs-memory "too large / good fit / overkill" recommender. **Runs on a
   machine the user controls, not on Vercel** (see the exceptions in `01`).

Start by reading, then give me a short Phase-2 implementation plan (files to add,
in what order) before writing code. Prefer deterministic/classical code wherever a
model isn't strictly required.

---

### Locked decisions (do not relitigate without asking)

- **Cloud-only on Vercel.** Hardware detection is **dropped**. Local-model runtime
  is out-of-process, reached over an HTTP endpoint the user provides.
- **Auth:** Auth.js/NextAuth v5 + GitHub OAuth; `ALLOWED_LOGINS` allowlist, fail
  closed (empty allowlist = nobody signs in).
- **Model layer:** Vercel AI SDK v7 (`ai` + `@ai-sdk/*`), provider-agnostic.
- **IDEA is the umbrella hub;** each project runs its own local Observatory. Loom's
  `:4040` is project #1.
- **Deterministic where possible** — routing, cost math, hardware-fit, and manifest
  parsing are plain code, not model calls.

### Stack of record (from IDEA `package.json`)

Next.js `16.2.11` · React `19.2.4` · `ai@^7.0.37` · `@ai-sdk/anthropic@^4.0.20` ·
`@ai-sdk/react@^4.0.40` · `@octokit/rest@^22.0.1` · `next-auth@^5.0.0-beta.32` ·
`zod@^4.4.3` · Tailwind 4 · TypeScript 5.
