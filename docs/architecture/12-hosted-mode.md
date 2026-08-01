# IDEA — Hosted mode (amends `08-local-first`)

> **Status:** Adopted 2026-08-01. Amends `08` for one deployment variant; `08` remains
> the design of record for the local install.
> **Precedence, newest first:** `12` → `11` → `10` → `09` → `08` → `07` → `00`–`06`.
> Where this document and any earlier file disagree *about hosted deployments*, this
> document wins. It says nothing new about running IDEA locally.

## Why

`08` made IDEA local-first, and its own "What we gave up" section named the price:
*access from a phone or a second device*. The operator has now asked for exactly that
half back — IDEA reachable from anywhere with an internet connection, for a small circle
of invited friends, **each bringing their own provider API keys** for the frontier models
(Claude, GPT, Gemini, Kimi, Qwen).

The wrong way to do this is to reverse `08` and drag the whole product back onto a
serverless host — that path was walked once and abandoned for six separately documented
reasons. The right way is to admit what a serverless host can and cannot be: it can be
IDEA's **chat core** — auth, routing, cost math, streaming — because those were pure or
GitHub-API-bound all along (NFR-1 did that work years of commits ago). It cannot be the
projects, the agents, or the observatory, because those *are* the user's machine.

So hosted mode is a **deployment variant, not a fork**: one codebase, one flag, and
every machine-bound surface structurally absent rather than broken.

## What we gave up

- **In hosted mode there are no projects, agents, skills, observatory, board, or saved
  conversations.** Hosted IDEA is a gated multi-provider chat console, nothing more.
  Friends who want the whole product run `npx idea` on their own machines.
- **NFR-6's "keys via env only" is re-scoped** (E-15.b): a hosted user's key lives in
  their browser and rides each request as a header. That is a second key channel to
  reason about, accepted because the alternative — the operator's env key billing for
  everyone, or a server-side key store — is strictly worse.
- **A second GitHub OAuth app and a deployment to operate.** The callback URL of an
  OAuth app is fixed, so localhost and the public host cannot share one.

## 1. Superseded and amended decisions

| Ref | Was | Now |
|---|---|---|
| `08` "What we gave up" (no second device) | Chat required your machine | **Amended.** Chat is reachable from anywhere; everything else still needs the machine |
| NFR-2 serverless-safe (superseded by `08`) | Routes may use disk and processes freely | **Re-scoped, not re-asserted.** Locally `08` stands; in hosted mode every disk- or process-bound route refuses (FR-15.3) instead of assuming |
| NFR-6 keys via env only | One channel: `.env.local` / env | **Re-scoped (E-15.b).** Hosted keys are per-user, browser-held, header-borne, never stored |
| AD-1 control/data plane split | Superseded by `08` | **Not revived.** Hosted mode is the same one process on a different host — there is still no companion and no split |
| E-2.a / E-8.a (no clone, no spawn) | Lifted by `08` for local | **Re-applied in hosted mode only**, as mechanical refusals rather than assumptions |
| E-6.a local models | `127.0.0.1` endpoints are registry entries | **Narrowed.** A hosted server can't see anyone's loopback; `local` entries are filtered from the picker and the router there |

**Unchanged and still binding, everywhere:** FR-1.3 fail-closed allowlist (the hosted
sign-in is the *same* gate — an empty `ALLOWED_LOGINS` locks everyone out), NFR-1
determinism-first, NFR-4 fail-closed defaults, E-9.c redaction before persistence,
LR-01 repo content is data, and all of `09`'s agent-authority limits — trivially, since
agents do not run in hosted mode at all (E-15.a).

> ⚠️ A hosted deployment is IDEA reachable over the public internet. The allowlist is
> the only door. Every login added can chat through your deployment — on **their own
> keys** by design; if you also set provider keys in the deployment's env, those become
> a shared fallback billed to whoever owns them. Set env keys on a hosted deployment
> only if that is what you mean.

## 2. FR-15 Hosted mode *(new)*

- **FR-15.1** Hosted mode is a property of the process, detected from the environment
  (`VERCEL=1`, or `IDEA_HOSTED=1` for any other host) — `lib/hosted.ts`. There is no UI
  toggle; where you run *is* the decision.
- **FR-15.2** Bring-your-own-key: each signed-in user's provider keys live in their
  browser and ride each `/api/chat` request as `x-idea-key-<provider>` headers
  (`lib/byok.ts`, `lib/byok-client.ts`). Per-request keys win over env; models whose
  provider has no reachable key are excluded from routing *before* the decision, so a
  missing key is a clear 400, never a mid-stream provider error.
- **FR-15.3** Every machine-bound surface refuses mechanically in hosted mode: API
  routes return 403 `hosted_unavailable` naming where the feature does work; pages
  render the same explanation; the nav advertises only what works. A refusal, never a
  crash and never a silent empty success.
- **FR-15.4** The hosted server persists nothing: no conversations, no keys, no
  settings writes. A turn exists in the user's browser and in the provider call, and
  then it is gone.
- **FR-15.5** Frontier providers are registry data, not code: OpenAI, Gemini, Kimi, and
  Qwen ride the existing OpenAI-compatible adapter with per-vendor endpoints in
  `config/models.json` (AD-2 held — `/api/chat` gained zero provider branching).

### Exceptions

- **Exception E-15.a** Hosted mode has no projects, agents, tools, provisioning,
  observatory, or persistence. Those *are* the user's machine; providing them on shared
  serverless infrastructure would mean mounting user repos and running user-directed
  commands on hardware nobody in the conversation owns — a different product with a
  different threat model, not a missing feature.
- **Exception E-15.b** Hosted provider keys are never stored server-side — not in env,
  not in a file, not in a database. They exist in the user's browser and in the headers
  of requests that user sends. The deployment cannot leak a key store because there is
  no key store; closing your account is clearing a localStorage entry.
- **Exception E-15.c** No per-user server-side settings in hosted mode. The routing
  chain and allocation render read-only from bundled defaults; saving refuses. Honoring
  per-user settings needs a database and per-user namespacing, and hosted mode has not
  earned that yet.
- **Exception E-15.d** Hosted conversations are unsaved for now. The GitHub-API
  conversation store (`lib/github-store.ts`) is already serverless-safe and is the
  designed follow-up; it is not wired in this pass because shipping BYOK with *zero*
  server-side write paths keeps the custody story auditable at a glance.

## 3. Amended component map

| # | Component | Status |
|---|---|---|
| C-40 | Hosted gate & BYOK — `lib/hosted.ts`, `lib/byok.ts`, `lib/byok-client.ts`, refusals in routes/pages/nav | **New.** Tested in `lib/byok.test.ts` |
| C-2 (providers) | `lib/providers.ts` | **Amended.** `resolveModel(model, keys?)` — per-request key seam; Gemini/Kimi/Qwen/OpenAI via the compatible adapter |
| C-24 | Local companion | Still deleted (`08`); hosted mode does **not** revive it |

## 4. Deployment contract

Set in the hosting platform's env (never committed):

| Var | Value |
|---|---|
| `AUTH_SECRET` | fresh secret for the deployment — not the one in your local `.env.local` |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | a **second** GitHub OAuth App whose callback is `https://<host>/api/auth/callback/github` |
| `ALLOWED_LOGINS` | comma-separated GitHub usernames of the invited friends (fail-closed when empty) |
| provider keys | **normally none** (E-15.b). Any env key you do set becomes a deployment-paid fallback |

Serverless function duration is capped at 300s repo-wide (`maxDuration`) so the deploy
validates on every Vercel plan; locally `next start` ignores the field entirely.

## 5. Story impact

| Story | Change |
|---|---|
| [S-50](../stories/S-50-hosted-mode-vercel.md) | *(new)* — this feature |
| [S-48](../stories/S-48-provider-key-discovery.md) | Unchanged for local; the hosted key panel deliberately diverges (browser-held, E-15.b) |
| [S-46](../stories/S-46-wire-up-what-is-built.md) | Hosted persistence deferred by E-15.d; the GitHub store is the follow-up path |
| [S-10](../stories/S-10-local-provider-adapter.md) | Local model discovery refuses in hosted mode — scanning a serverless container's home dir would report the host's files as the user's |

Local-first is not discarded. The machine remains the product; hosted mode is the same
product stepping out with only what it can carry.
