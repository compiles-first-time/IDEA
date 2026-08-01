# S-51 — Supabase store for hosted mode: saved chats and per-user settings

**Phase:** 3 · **Status:** Done (code) — needs the schema run once in Supabase and two env vars on the deployment
**Traces to:** FR-15 (doc `12`), amends E-15.c and E-15.d · **Component:** C-41
**Depends on:** S-50 (hosted mode), S-27 (conversation store) — the seam this rides

## Goal

A friend chats on the hosted deployment, closes the laptop, comes back tomorrow on
their phone, and the conversation is there. Their routing chain is theirs, not shared.
And the deployment still holds no provider keys — the store never changes E-15.b.

## The design decision that matters

`lib/conversation-store.ts` already speaks to storage through one seam,
`RepoFileStore`, with two backends (local disk, GitHub API). Supabase is the **third
backend of the same seam** (`lib/supabase-store.ts`): one table of small text
documents, namespaced by GitHub login, talked to over PostgREST with plain `fetch` —
no SDK dependency for two functions and four verbs.

Because it is the same seam, everything the conversation layer guarantees is
inherited rather than reimplemented: **unconditional redaction** before every write
(with the requester's BYOK values added as extra secrets), **optimistic concurrency**
via a version token, and the **append retry loop**. The test file proves the whole
conversation lifecycle and the redaction guarantee over a faked PostgREST wire.

Fail-closed posture (NFR-4): the table has RLS enabled with **no policies** — the
publishable key can touch nothing; only the server's secret key works. No Supabase
wiring at all means hosted persistence is simply off (S-50's shipped state), never an
error.

## Scope

**In:** `lib/supabase-store.ts` (config + `RepoFileStore` + row helpers),
`lib/hosted-conversations.ts` and `lib/hosted-settings.ts` (thin per-login wrappers),
`/api/hosted/conversations` routes, chat-route persistence and per-login routing
chain, per-login settings in `/api/routing` and the settings page, the hosted
conversation picker in chat, `supabase/schema.sql`.

**Out:** cross-user sharing, conversation deletion UI, budget *enforcement* from
stored spend (the allocation is stored and shown; enforcement is the same open
question locally), migrating hosted history into a project repo.

## Done when

- [x] The full conversation lifecycle passes over the Supabase backend in tests,
      including a BYOK key pasted into chat being redacted before storage
- [x] One login cannot read another's conversations or settings (namespace tests)
- [x] Hosted chat saves and restores conversations end to end when the store is
      configured, and says "not saved" plainly when it is not
- [x] Routing chain and allocation save per login in hosted mode and drive the very
      next turn's routing (no restart, read per request)
- [ ] Schema run in the real Supabase project; `SUPABASE_URL` + `SUPABASE_SECRET_KEY`
      set on Vercel; a saved conversation survives a reload from a second device
