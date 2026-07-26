# IDEA

A gated, multi-LLM console. The cloud hub (Vercel) for chatting across models, running
portable skills/agents, and surfacing each project's local **Observatory** dashboard
(Loom's `:4040` being the first project).

> **History:** this repo previously held an unbuilt Python "predictive governance platform."
> That work is archived under [`archive/legacy-predictive-governance/`](archive/legacy-predictive-governance/)
> for reference. The current app is a fresh Next.js build.

## Status — Phase 1

Cloud-only on Vercel. Delivered:

- **Auth** — GitHub OAuth via Auth.js, gated by a **fail-closed allowlist** (`ALLOWED_LOGINS`).
- **Chat** — streaming Claude via the Vercel AI SDK (provider-agnostic, so multi-model routing slots in later).
- **Repo-pull** — browse your GitHub repos, read the file tree, and **attach files as chat context** (GitHub API; no local git needed).

**Deliberately deferred** (later phases): manual/automatic model routing by complexity + cost,
local-model management (Hugging Face search/install, hardware fit), the portable
skills/agents runtime, and embedding each project's Observatory.

## Run locally

```bash
cp .env.example .env.local   # then fill it in (see below)
npm install
npm run dev                  # http://localhost:3000
```

### Environment (`.env.local`)

| var | what |
|---|---|
| `AUTH_SECRET` | `npx auth secret` |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | a GitHub OAuth App (callback `http://localhost:3000/api/auth/callback/github`) |
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `ALLOWED_LOGINS` | comma-separated GitHub usernames allowed in (empty ⇒ **nobody**) |
| `IDEA_CHAT_MODEL` | *optional* — model id your key can access (default `claude-sonnet-4-5`) |

## Deploy to Vercel

1. Push this repo (done) and import it at [vercel.com/new](https://vercel.com/new).
2. Add the same env vars in **Project → Settings → Environment Variables**.
3. In the GitHub OAuth App, add the production callback:
   `https://<your-app>.vercel.app/api/auth/callback/github`.
4. Deploy. Only allow-listed GitHub logins can sign in.

## Architecture notes

- `auth.ts` / `auth.config.ts` — Auth.js (split config so middleware runs on the Edge).
- `app/api/chat/route.ts` — streaming Claude; reads attached repo files as `context`.
- `app/api/repos/*` — list repos / read tree / read a file (Octokit, user's token).
- `components/chat-workspace.tsx` — the repo browser + chat client.
- The AI SDK is model-agnostic on purpose: manual-vs-auto routing and local models
  (via the Ollama provider or a local companion) attach without a rewrite.
