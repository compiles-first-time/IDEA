# S-50 — Hosted mode: IDEA on Vercel with bring-your-own-keys

**Phase:** 3 · **Status:** In progress · **Traces to:** FR-15 (doc `12`), NFR-4, NFR-6 (as re-scoped by E-15.b)
**Depends on:** S-04 (registry), S-09 (chat), S-35 (settings) — all ✅ done

## Goal

Friends open a URL, sign in with GitHub (allowlisted, fail-closed), paste their own
provider API keys once, and chat with Claude / GPT / Gemini / Kimi / Qwen — routed and
cost-accounted by the same deterministic `lib/` code the local install uses. Nothing
machine-bound pretends to work: it refuses, in words, and points at `npx idea`.

## Scope

**In:** the hosted flag (`lib/hosted.ts`); BYOK headers and browser-held keys
(`lib/byok.ts`, `lib/byok-client.ts`, hosted key panel); per-request key seam in
`lib/providers.ts`; OpenAI/Gemini/Kimi/Qwen registry records over the OpenAI-compatible
adapter; keyless-provider exclusion before routing; mechanical refusals on every
disk/process route and page; nav that advertises only what works; `maxDuration ≤ 300`;
vendored-file tracing for `/observatory`.

**Out (recorded, not forgotten):** hosted conversation persistence via the GitHub store
(E-15.d); per-user routing chain and allocation (E-15.c); any server-side key custody
(E-15.b — permanently out, not deferred).

## Keys — the part that decides the design (E-15.b)

A hosted key belongs to the person chatting. It is stored in **their browser's
localStorage**, sent as an `x-idea-key-<provider>` header on each same-origin
`/api/chat` request, used for that one provider call, and never written anywhere
server-side. The chat body — the thing that gets validated, routed on, and (locally)
persisted — never contains a key, so no transcript can either. The server cannot leak a
key store because there is no key store.

## Done when

- [x] `npx next build` succeeds with no route assuming disk at build time
- [x] Chat routes only among models whose provider has a reachable key; zero keys is a
      clear 400 naming Settings, not a mid-stream SDK error
- [x] A per-request header key reaches the provider client; env keys still work locally
      untouched (`lib/byok.test.ts`)
- [x] Every local-only API route returns 403 `hosted_unavailable` in hosted mode; every
      local-only page explains itself; the nav hides what cannot work
- [x] Hosted mode persists nothing server-side — no conversation writes, no key writes,
      no config writes
- [ ] Deployed on Vercel: second GitHub OAuth app, `ALLOWED_LOGINS` set, a friend has
      signed in and chatted on their own key
