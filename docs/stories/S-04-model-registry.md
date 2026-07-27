# S-04 — Model registry

**Phase:** 2 · **Workstream:** 1 Registry & picker · **Status:** ✅ **Done** (2026-07-26)
**Component:** C-11 · **Traces to:** FR-4.1, FR-4.3, AD-4, NFR-3
**Depends on:** S-02 · **Blocks:** S-05, S-07, S-08, S-10

## Goal

A declarative, Zod-validated list of every model IDEA can talk to — the single source of
truth that the picker, the router, and the cost math all read from. Models are **data,
not code** (AD-4): editing `config/models.json` is how you add a model.

## Scope

- `config/models.json` — seed with the Anthropic models we actually use today
- `lib/registry.ts` — schema + loader + lookups

```ts
Tier = z.enum(["light", "standard", "heavy"]);

ModelRecord = z.object({
  id: z.string(),                            // "claude-sonnet-4-5"
  provider: z.enum(["anthropic","openai","local","google","other"]),
  label: z.string(),
  tier: Tier,                                // capability tier
  inputWeight: z.number().min(0),            // USD per 1M input tokens
  outputWeight: z.number().min(0),           // USD per 1M output tokens
  contextWindow: z.number().int().positive(),
  enabled: z.boolean().default(true),
  endpoint: z.string().url().optional(),     // provider === "local" only
});
```

Exports: `loadRegistry()`, `getModel(id)`, `enabledModels()`, `modelsAtOrAboveTier(tier)`,
`defaultModelId()` (honors `IDEA_CHAT_MODEL`, FR-3.3).

## Acceptance criteria

- [ ] `config/models.json` parses against `ModelRecord[]` — invalid records fail loudly at load, not silently
- [ ] `defaultModelId()` respects `IDEA_CHAT_MODEL` and falls back to a registry default
- [ ] `enabled: false` models are excluded from selection everywhere
- [ ] A `provider: "local"` record without `endpoint` is a validation error
- [ ] Unit tests: valid load, invalid record rejected, tier filtering, default resolution
- [ ] `lib/registry.ts` imports no Next.js request objects (dependency rule, §C)

## Exceptions honored

- **NFR-3** No hard-coded vendor beyond a default — adding a provider is a registry edit.
- **NFR-6** No API keys in the registry. Keys live in env; the registry holds only ids,
  tiers, weights, and (for local) a base URL.

## Notes

- **Resolved:** the original contract specified a single scalar `costWeight`. Loom's
  actual `observatory/config.yaml` stores **separate input and output rates** in USD per
  1M tokens, and the ratio differs per model (opus 15/75, haiku 0.80/4.00). Flattening
  to one number would destroy information at the exact seam FR-4.5 says to preserve, so
  the schema now carries both. `05-data-contracts.md` §4 is superseded on this point —
  see [07-amendments.md](../architecture/07-amendments.md) §5.
- Seeded by hand here, **re-seeded from Loom's real rates in S-22**. Don't over-invest in
  precise numbers now — but do get the *shape* right, because S-07 and S-08 build on it.
- Loom's model ids (`claude-sonnet-4`) won't match IDEA's registry ids. The mapping is a
  real translation layer, documented in S-22.
