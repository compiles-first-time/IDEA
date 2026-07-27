# S-17 — Local control API (proxy)

**Phase:** 2 · **Workstream:** 5 Local models · **Status:** ✅ **Done** (2026-07-27)
**Component:** C-19 · **Traces to:** FR-6.1, FR-6.2, FR-6.3, FR-6.4, E-6.a, NFR-2
**Depends on:** S-15, S-16 · **Blocks:** nothing (completes the local-models workstream)

## Goal

IDEA's side of the local-models boundary: proxy to the user's helper, classify the
results with `lib/fit.ts`, and let the user register a local model into the registry.
IDEA **proxies and classifies** — it never does local work itself (PF-6).

## Scope

- `app/api/local/hardware` — fetch/store the `HardwareReport`
- `app/api/local/models` — discovered models, each annotated with a `FitResult`
- `app/api/local/hf/search` — proxy HF search
- `app/api/local/hf/install` — proxy install, report progress
- `app/api/local/register` — write a `provider: "local"` `ModelRecord` into the registry
- All proxied calls carry `IDEA_HELPER_TOKEN`

## Acceptance criteria

- [ ] Every route re-checks `auth()` → **401** unauthenticated (§6)
- [ ] Helper unreachable → a clear "start your local helper" message with the expected
      URL, not a 500 or a hung request
- [ ] All helper responses are Zod-validated before use — the helper is *trusted-ish*,
      but validate anyway (NFR-4)
- [ ] `GET /api/local/models` returns each model with its `FitResult` verdict
- [ ] Registering a local model produces a valid `ModelRecord` that S-04's schema accepts
      and that immediately appears in the picker (S-06)
- [ ] A request timeout is set — no unbounded waits on a machine that may be asleep
- [ ] No fs access, no child processes, no model loading in these routes (E-6.a, NFR-2)

## Exceptions honored

- **E-6.a** IDEA on Vercel never runs a local model. These routes proxy and classify only.
- **E-6.b** Hardware is helper-reported or user-supplied; the route does not detect it.
- **NFR-6** `IDEA_HELPER_TOKEN` is server-side only and never reaches the browser.

## Notes

- Registering a model **writes** to `config/models.json`. Vercel's filesystem is
  read-only at run time — so registration works in local dev and needs a different
  persistence story when deployed. Note the limitation; don't paper over it. This is
  the same constraint that makes S-07's budget accounting awkward, and it's a strong
  hint that Phase 3's "persistence" item is the real fix for both.
