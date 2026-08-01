# IDEA

A provider-agnostic multi-LLM chat and agent console that runs **on your own machine**.

Chat across models, pull GitHub repos in as context, and let IDEA route each turn to a
cost-appropriate model — with conversations that survive being picked up by a different
model later.

> **History:** this repo previously held an unbuilt Python "predictive governance platform,"
> archived under [`archive/legacy-predictive-governance/`](archive/legacy-predictive-governance/).
> It was then briefly a Vercel-hosted app; see
> [`docs/architecture/08-local-first.md`](docs/architecture/08-local-first.md) for why it
> now runs locally instead.

---

## Run it

```bash
npx @ideallab/idea
```

Your browser opens. No install step, no configuration files, no platform-specific
build — Windows, macOS, and Linux from one codebase. Needs Node.js 20+.

First run builds once (a few minutes), then starts instantly. Sign in with a GitHub
device code (no OAuth app to create — S-52), and the **first account to sign in becomes
that install's owner**. Then paste a provider API key in Settings and chat.

### Options

```bash
npx @ideallab/idea --port 5000      # different port (default 4300)
npx @ideallab/idea --no-open        # don't open a browser
npx @ideallab/idea --dev            # development mode
npx @ideallab/idea --host 0.0.0.0   # expose to your network — see below
```

> **`--host` is off by default on purpose.** IDEA can read your files and run commands.
> Only expose it on a network you trust.

## Setup

There is none required — the launcher generates its own session secret, sign-in uses a
GitHub device code, and provider keys are pasted in Settings after sign-in. Everything
lands in `.env.local`, which you can also set by hand:

| Setting | What it is |
|---|---|
| `AUTH_SECRET` | Session secret — *generated automatically on first run* |
| `ALLOWED_LOGINS` | GitHub usernames allowed to sign in, comma-separated — *claimed by the first sign-in when empty* |
| `ANTHROPIC_API_KEY` etc. | Provider keys — or paste them in Settings |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | *Optional* — your own GitHub OAuth app; with a secret set, sign-in uses the classic web redirect instead of a device code |
| `IDEA_CHAT_MODEL` | *Optional* — override the default model |

> Once `ALLOWED_LOGINS` has a value it **fails closed**: only listed accounts sign in.
> The first-run claim exists because a fresh install binds to 127.0.0.1 — whoever
> completes the device code is sitting at this machine.

## What it does

- **Chat** across models with streaming, and attach repo files as context.
- **Automatic cost routing** — a deterministic scorer sizes each prompt and picks the
  cheapest model that can handle it. No hidden ML: every weight and threshold is a named
  constant you can read and change.
- **Your own fallback order** — you decide which models are tried in which order. The
  capability floor and your budget still apply; the ordering is yours.
- **Budgets** in real dollars, per project and per period, that degrade to a cheaper
  model rather than failing outright.
- **Portable conversations** — transcripts are stored in a canonical, vendor-neutral
  format in the project's own repo, so a conversation started on one model resumes on
  another. When it can't fully fit, you're told exactly what was lost.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # unit tests
npm run typecheck
npm run lint
```

## Documentation

- [`docs/architecture/`](docs/architecture/README.md) — design of record.
  Precedence: **`09` → `08` → `07` → `00`–`06`.**
- [`docs/stories/INDEX.md`](docs/stories/INDEX.md) — the backlog and what's built.
