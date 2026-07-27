# S-03 — Route-gating middleware

**Phase:** 1 hardening · **Workstream:** Foundation · **Status:** ✅ **Done** (2026-07-27)
**Component:** C-3 · **Traces to:** FR-1.2, FR-1.3, NFR-4, §6 security model
**Depends on:** nothing · **Blocks:** nothing (independent)

## Goal

The component map lists `middleware.ts` as **shipped ✅** (C-3, "gate protected
routes/pages") and the opening prompt tells you to read it. **The file does not exist.**
Right now gating relies entirely on each route and page checking `auth()` itself.

Resolve the discrepancy: either implement the middleware, or correct the component map
if per-route checks are the deliberate design.

## Scope

1. Audit what's actually gated today: `app/api/chat/route.ts`, `app/api/repos/*`,
   `app/chat/page.tsx`, `app/page.tsx`. Find anything reachable unauthenticated.
2. Either:
   - **(a)** Add `middleware.ts` with a matcher covering protected pages and API routes; **or**
   - **(b)** Confirm per-route `auth()` is sufficient and fix C-3 in the component map.
3. Whichever way it goes, `§6` still holds: **every API route re-checks `auth()`** —
   middleware is defense in depth, never the only check.

## Acceptance criteria

- [ ] Every protected page redirects an unauthenticated visitor to `/login`
- [ ] Every API route returns 401 unauthenticated (verify, don't assume)
- [ ] A non-allowlisted GitHub user who completes OAuth still cannot reach the app
- [ ] Empty/unset `ALLOWED_LOGINS` admits nobody (FR-1.3, verified by test or manual check)
- [ ] `03-component-map.md` C-3 row reflects reality

## Exceptions honored

- **E-1.b** No org/team auto-allow — the allowlist stays an explicit login list.
- **E-1.c** No role hierarchy; every allowed user is a full user.

## Notes

- ⚠️ Next.js 16 middleware differs from older versions. Read
  `node_modules/next/dist/docs/` before writing it (per `AGENTS.md`) — do not
  copy a Next 13/14 middleware pattern from memory.
