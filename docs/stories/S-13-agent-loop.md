# S-13 — Provider-agnostic agent loop

**Phase:** 2 · **Workstream:** 4 Skills & agents · **Status:** Not started
**Component:** C-17 · **Traces to:** FR-5.2, FR-5.3, FR-5.4, AD-2, NFR-3, NFR-5
**Depends on:** S-11, S-12 · **Blocks:** S-14

## Goal

Run a parsed skill/agent against **any** configured provider through the AI SDK's
uniform tool-calling interface. Same skill, same behavior, whether it's Claude, a local
model, or a future provider — that's the whole point of FR-5.3.

## Scope

`lib/agent.ts` — the loop from `04-process-flows.md` PF-5:

```
generate(messages, tools = allowlisted)
  → tool_call?  validate ∈ allowlist → execute → observation → emit trace → loop
  → final text? → return
```

- Model chosen by `manifest.modelPolicy`: `pinnedModelId`, else `preferredTier` +
  router, else auto-route (reuses S-08 — do not write a second selection path)
- Hard stop at `maxSteps` (default 12)
- Emit a `ToolTraceEvent` per tool call:

```ts
ToolTraceEvent = z.object({
  ts: z.string(),                  // ISO, server-stamped
  skill: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  ok: z.boolean(),
  result_summary: z.string(),
});
```

## Acceptance criteria

- [ ] The same skill runs against two different providers with no code change (NFR-3) —
      test with Claude and a local endpoint, or two Claude models at different tiers
- [ ] `maxSteps` is enforced — a looping agent terminates and says why
- [ ] A tool call outside the allowlist is refused mid-loop; the loop continues or
      aborts by **defined** behavior, and the refusal is traced (E-5.a)
- [ ] A tool that throws is caught → `ok: false` trace → the model sees an error
      observation and can recover; it does not crash the loop
- [ ] `ts` is **server-stamped**, never client-supplied (provenance integrity, FR-5.4)
- [ ] Trace events are emitted for every call, including refusals and failures
- [ ] No provider-specific branching in the loop body (AD-2)

## Exceptions honored

- **E-5.a** Only allowlisted tools execute — the loop re-checks, it does not trust the
  manifest's `tools` list (S-11 deliberately doesn't validate names).
- **E-5.b** No eval of untrusted code.
- **NFR-5** Traces carry enough provenance to reconstruct the run.
- **NFR-2** Serverless-safe: bounded steps, mind the Vercel function timeout. A 12-step
  agent loop can exceed it — see below.

## Notes / open questions

- **Open: Vercel function timeout.** A multi-step agent loop with slow tool calls can
  blow the execution limit. Options: cap `maxSteps` lower for the deployed environment,
  stream partial progress so the user sees work happening, or accept that long agents
  are a local-dev capability in Phase 2. Decide before S-14 exposes this over HTTP.
- Where trace events *go* (log, response stream, Observatory push) is S-14's concern.
  This story just emits them through an injected sink.
- ⚠️ AI SDK v7 tool-calling shape differs from earlier versions. Read the installed
  docs before writing the loop.
