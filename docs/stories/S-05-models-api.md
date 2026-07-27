# S-05 — Models API

**Phase:** 2 · **Workstream:** 1 Registry & picker · **Status:** Not started
**Component:** C-14 · **Traces to:** FR-4.1
**Depends on:** S-04 · **Blocks:** S-06

## Goal

Serve the registry to the UI so the picker has something to render. Thin route:
authenticate → call `lib/registry.ts` → return.

## Scope

- `app/api/models/route.ts` — `GET`, `runtime = "nodejs"`

```ts
ModelsResponse = z.object({
  models: z.array(ModelRecord),
  defaultId: z.string(),
});
```

## Acceptance criteria

- [ ] `GET /api/models` returns `ModelsResponse` for a signed-in user
- [ ] Unauthenticated request returns **401** (§6: every route re-checks `auth()`)
- [ ] Only `enabled: true` models are returned
- [ ] Response is validated against the schema before sending
- [ ] Route contains no business logic — registry filtering lives in `lib/` (§C)

## Exceptions honored

- **NFR-6** The response must not leak API keys or any secret. For `provider: "local"`
  records, decide whether `endpoint` is safe to expose to the browser — it's a
  `127.0.0.1` URL the user already owns, so probably yes, but confirm it isn't a
  remote endpoint with a token embedded in the URL.

## Notes

- ⚠️ Next.js 16 route handler conventions may differ from training data. Read
  `node_modules/next/dist/docs/` first (per `AGENTS.md`).
