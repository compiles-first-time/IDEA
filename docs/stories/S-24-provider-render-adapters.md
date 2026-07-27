# S-24 — Provider render adapters & conformance suite

**Phase:** 2 · **Workstream:** 7 Conversations · **Status:** ✅ **Done** (2026-07-26)
**Component:** C-26 · **Traces to:** FR-9.5, AD-2, AD-6, NFR-1, NFR-3
**Depends on:** S-23 · **Blocks:** S-32

## Goal

Turn a canonical transcript into whatever shape the target model expects, without losing
structure. This story **is** the "any LLM can pick it up" guarantee — layer 3 of the
fidelity model, held to 100% structurally.

## Scope

`lib/conversation/render/` — one adapter per provider family, plus the shared conformance
suite every adapter must pass.

```ts
renderFor(provider: ProviderId, turns: CanonicalTurn[], opts) → ProviderMessages
```

Adapters: `anthropic`, `openai-compatible` (covers OpenAI + local endpoints), and a
`generic-text` fallback that flattens to plain prose for models with no structured
tool-calling.

**The conformance suite is the deliverable, not an afterthought.** Every adapter runs the
same fixtures and must satisfy the same invariants.

## Acceptance criteria

Structural invariants — asserted for **every** adapter against **every** fixture:

- [ ] Message count preserved (or a documented, tested merge rule — e.g. consecutive
      same-role turns coalesced — never a silent drop)
- [ ] Role sequence preserved in order
- [ ] Every `tool_call` has its matching `tool_result` in the rendered output, still paired
- [ ] No text content lost — concatenated text round-trips by hash
- [ ] `repo_context` parts render into the target's context with their pinned content
- [ ] `provider_artifact` parts belonging to a *different* provider are dropped cleanly,
      never leaked as raw JSON into a prompt
- [ ] A conversation with zero tool calls renders correctly for a model with no
      tool-calling support (`generic-text`)

Suite mechanics:

- [ ] Fixtures cover: text-only, multi-tool, interleaved tool + text, repo context,
      thinking blocks, and a 200-turn conversation
- [ ] Adding a new provider means adding an adapter and running the existing suite —
      no new test file required
- [ ] **A cross-provider test:** render the same canonical transcript for Anthropic and
      for OpenAI-compatible, assert both satisfy every invariant. This is FR-9.5 proven,
      not asserted.
- [ ] Pure — adapters take data and return data, no network (§C)

## Exceptions honored

- **E-9.b** Structural fidelity only. The suite proves no message was lost; it does not
  and cannot prove the model behaves identically (layer 5).
- **NFR-3** Adding a provider is an adapter plus registry data, not a rewrite.

## Notes

- Rendering is **lossy by design in one direction only**: dropping another vendor's
  artifacts is correct. Dropping a tool result is a bug. The suite must distinguish these.
- ⚠️ AI SDK v7 message shapes differ from earlier versions — read the installed docs
  rather than writing the Anthropic adapter from memory.
