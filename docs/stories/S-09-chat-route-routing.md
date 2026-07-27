# S-09 — Chat route: mode, model, RoutingDecision

**Phase:** 2 · **Workstream:** 2 Router · **Status:** ✅ **Done** (2026-07-26)
**Component:** C-8 (extend `app/api/chat/route.ts`) · **Traces to:** FR-4.1, FR-4.2, FR-4.4, NFR-5
**Depends on:** S-08 · **Blocks:** nothing (completes the routing workstream)

## Goal

Wire the router into the shipped chat route. This is where manual/auto becomes real.
The route stays **thin**: authenticate → validate → call `lib/` → stream.

## Scope

Extend the request contract (additive — Phase-1 clients must keep working):

```ts
ChatRequest = z.object({
  messages: z.array(UIMessage),
  context: z.string().optional(),
  mode: z.enum(["manual","auto"]).default("manual"),  // NEW
  model: z.string().optional(),                        // NEW, manual mode
});
```

Behavior:
- `mode: "manual"` → use `model` if valid and enabled, else the registry default
- `mode: "auto"` → `scoreComplexity()` → `selectModel()` → use the chosen model
- Emit the `RoutingDecision` to the client for **both** modes (manual decisions are
  trivially "user picked it", but FR-4.4 says *every routed turn* records one)
- Emit the decision as a trace event for the Observatory (NFR-5)
- **Record actual token usage** from the provider response for the ledger (FR-4.10, S-34)
- **Execute the fallback plan** from S-33 when the primary model fails —
  **only before the first token streams** (E-4.d)

## Acceptance criteria

- [ ] A Phase-1-shaped request body (no `mode`, no `model`) still works unchanged
- [ ] Unauthenticated → **401** (FR-3.2, unchanged)
- [ ] An unknown or disabled `model` id is rejected or falls back — **defined and tested**,
      never a 500
- [ ] `mode: "auto"` streams from the router-chosen model, not the default
- [ ] The `RoutingDecision` reaches the client (see open question) and is validated
      against the schema before emission
- [ ] Repo context injection (FR-2.4) still works and is counted in `fileCount` / `tokens`
- [ ] Route holds no scoring or cost logic — it calls `lib/router.ts` and `lib/cost.ts` (§C)
- [ ] A primary-model failure **before streaming starts** advances to the next chain
      entry, at most once per entry (E-4.c), and the user is told which trigger fired (FR-4.11)
- [ ] A failure **after** the first token surfaces the error — it does **not** restart on
      another model (E-4.d). Test this explicitly; it's the tempting wrong behavior.
- [ ] Actual `inputTokens`/`outputTokens` from the provider response are recorded, not
      the estimate (FR-4.10)

## Exceptions honored

- **E-3.a** Still no server-side chat persistence. The routing decision is emitted, not stored.
- **E-4.b** A degraded decision reaches the user visibly.
- **NFR-2** No process or filesystem assumptions — this runs in a Vercel function.

## Notes / open questions

- **Open (blocks S-06): how does `RoutingDecision` reach the client?** The data contract
  says "header/event". A response header can't carry per-turn data once streaming has
  begun and is awkward for multi-turn UIs. **Recommend a data part in the AI SDK UI
  message stream** — it arrives inline with the turn it describes. Confirm AI SDK v7
  supports the shape you want before committing.
- ⚠️ AI SDK v7 `streamText` / `toUIMessageStreamResponse` signatures differ from v3/v4.
  Read the installed package docs, don't write from memory.
