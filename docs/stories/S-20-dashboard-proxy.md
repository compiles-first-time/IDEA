# S-20 — Dashboard same-origin proxy *(optional)*

**Phase:** 2 · **Workstream:** 6 Projects & Loom · **Status:** Not started
**Component:** C-22 · **Traces to:** FR-7.1, E-7.a, §6 security model
**Depends on:** S-19 · **Blocks:** nothing

## Goal

Optional polish: serve the Loom Observatory through IDEA's own origin so it can be
embedded as a seamless pane instead of a link that opens a new tab.

`06-loom-integration.md` Step 4 explicitly marks this **optional** — the preferred
default is to just link out. Do this only if the linked-out experience proves annoying.

## Scope

- `app/api/projects/[name]/proxy/[...path]` — forward to the project's `dashboardUrl`
- Guarded by `IDEA_HELPER_TOKEN` + Host allowlist (mirror the Loom/ripple pattern, §6)
- Forward status, headers, and body faithfully, including streaming responses
- Handle the Observatory's static assets and any websocket/SSE it uses

## Acceptance criteria

- [ ] The Observatory renders correctly through the proxy, assets included
- [ ] Target URL comes **only** from the validated registry (S-18) — the `[...path]`
      segment can never redirect the proxy to a different host. **This is an SSRF
      boundary**; test it with `../`, absolute URLs, and encoded traversal.
- [ ] `IDEA_HELPER_TOKEN` required; unauthenticated → 401 (in addition to `auth()`)
- [ ] Host header allowlist enforced
- [ ] Only `127.0.0.1`/`localhost` targets are ever reachable (E-7.a)
- [ ] Disabled entirely when running on Vercel — there's nothing local to proxy to
- [ ] Live-updating parts of the Observatory (websocket/SSE) still work, or the
      limitation is documented

## Exceptions honored

- **E-7.a** Only local dashboards are proxied. This must never become a general-purpose
  URL fetcher.
- **NFR-4** Fail closed: no registry match → 404, never a best-effort fetch.

## Notes

- **Defer this unless the link-out is genuinely painful.** It's the highest
  risk-to-value ratio in the backlog: a proxy that takes a path from the URL is an SSRF
  vector, and the feature it buys is "the iframe looks nicer." The linked-out
  Observatory works fine.
- If skipped, mark the story `Won't do (Phase 2)` rather than deleting it — the
  reasoning is worth keeping.
