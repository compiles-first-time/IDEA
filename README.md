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
npx idea
```

Your browser opens. No install step, no platform-specific build — Windows, macOS, and
Linux from one codebase.

First run builds once (about a minute), then starts instantly.

### Options

```bash
npx idea --port 5000      # different port (default 4300)
npx idea --no-open        # don't open a browser
npx idea --dev            # development mode
npx idea --host 0.0.0.0   # expose to your network — see below
```

> **`--host` is off by default on purpose.** IDEA can read your files and run commands.
> Only expose it on a network you trust.

## Setup

IDEA needs five settings in `.env.local`. Just run `npx idea` — it tells you exactly
which are missing, how to get each one, and the precise OAuth callback URL for your port.

| Setting | What it is |
|---|---|
| `AUTH_SECRET` | Session secret — generate with `npx auth secret` |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | A GitHub OAuth app (Settings → Developer settings) |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com/) |
| `ALLOWED_LOGINS` | GitHub usernames allowed to sign in, comma-separated |
| `IDEA_CHAT_MODEL` | *Optional* — override the default model |

> `ALLOWED_LOGINS` **fails closed**: if it's empty, nobody can sign in — including you.

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
