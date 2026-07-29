# S-48 — Discover models from a pasted API key

**Phase:** 3 · **Status:** Not started · **Traces to:** FR-4, NFR-6
**Depends on:** S-04, S-33, S-34 (all ✅ done)

## Goal

Paste a provider key in Settings; IDEA asks that provider what models the key can
reach, and those models become selectable, orderable in the fallback chain, and
priceable in the allocation — using the machinery that already exists.

Today `config/models.json` is a static list. A key that unlocks a model IDEA has
never heard of gets you nothing.

## Scope

- **Per provider, a live capability query.** Anthropic exposes `GET /v1/models`;
  OpenAI-compatible endpoints expose `/v1/models`. Ask, do not assume — the
  point is to learn what *this* key can actually reach.
- Merge discovered models into the registry, marked `discovered` with the date,
  so a stale entry is distinguishable from a shipped one.
- Rates are **not** discoverable. No provider returns pricing over the API. A
  discovered model with no rate must show cost as **unknown, never zero** — the
  same rule as everywhere else — and prompt for the rate rather than guessing it.
- Feed straight into the existing chain (S-33) and allocation (S-34) UI.

## Secrets (NFR-6) — the part that decides the design

A pasted key must reach `.env.local` or the OS keychain and **nothing else**. It
must never be:

- written to `config/*.json` (they are read by the client-facing routes),
- included in a conversation, tool argument, or event log,
- returned by any API route, even masked, once stored.

The Settings UI sends the key **once**, to a route that stores it and returns
only the discovered model list. Re-rendering a stored key back into a form field
is how keys end up in browser history, screenshots, and support tickets — show
`sk-…last4` and a "replace" action instead.

Validation happens by *using* the key against the models endpoint. A 401 is
reported as "this key was rejected", not "something went wrong".

## Done when

- Pasting an Anthropic key lists the models that key can reach.
- A discovered model can be ordered in the chain and given a budget.
- A discovered model with no rate shows unknown cost and asks for one.
- The key never appears in any response body, log line, or persisted
  conversation — asserted by a test, not by inspection.
- A rejected key says so plainly.
