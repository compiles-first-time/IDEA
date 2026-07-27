# S-23 — Canonical conversation format

**Phase:** 2 · **Workstream:** 7 Conversations · **Status:** Not started
**Component:** C-25 · **Traces to:** FR-9.3, FR-9.4, AD-6, AD-7, NFR-1, NFR-3
**Depends on:** S-02 · **Blocks:** S-24, S-27, S-28, S-32

## Goal

Define the provider-neutral transcript format that every other conversation story reads
and writes. This is the foundation of the portability guarantee — if the format encodes
one vendor's message shape, FR-9.5 is unachievable no matter how good the adapters are.

## Scope

`lib/conversation.ts` — schema only, pure, no I/O.

**On-disk layout** (inside the project repo):

```
.idea/conversations/<conversation-id>/
  meta.json      # ConversationMeta
  turns.jsonl    # one CanonicalTurn per line, append-only
```

JSONL and append-only is deliberate: appends produce clean git diffs instead of
rewriting the whole file on every turn.

```ts
ConversationMeta = z.object({
  id: z.string(),                 // stable, url-safe
  schemaVersion: z.number().int(), // migration hook — set it now, not later
  projectName: z.string(),
  title: z.string(),
  createdAt: z.string(),          // ISO, server-stamped
  updatedAt: z.string(),
  modelsUsed: z.array(z.string()),// provenance across providers
});

CanonicalTurn = z.object({
  seq: z.number().int(),
  role: z.enum(["user", "assistant", "tool"]),
  ts: z.string(),                          // ISO, server-stamped
  content: z.array(CanonicalPart),
  modelId: z.string().optional(),          // which model produced an assistant turn
  routingDecision: RoutingDecision.optional(), // AD-7 — archive doubles as telemetry
});

CanonicalPart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("repo_context"),               // FR-9.4 — PINNED
             owner: z.string(), repo: z.string(), path: z.string(),
             sha: z.string(), bytes: z.number().int(), contentHash: z.string() }),
  z.object({ type: z.literal("tool_call"), id: z.string(),
             tool: z.string(), args: z.record(z.unknown()) }),
  z.object({ type: z.literal("tool_result"), callId: z.string(),
             ok: z.boolean(), result: z.unknown() }),
  z.object({ type: z.literal("provider_artifact"),          // see note
             provider: z.string(), kind: z.string(), data: z.unknown() }),
]);
```

## Acceptance criteria

- [ ] All schemas parse and reject malformed input with located errors
- [ ] `schemaVersion` present from day one, with a documented migration policy
- [ ] `ts` and `createdAt` are **server-stamped** — a client-supplied timestamp is ignored
- [ ] `repo_context` **requires** `sha` — a context part without one is a validation error,
      not a warning. This is the whole of layer-2 fidelity.
- [ ] `tool_call.id` ↔ `tool_result.callId` pairing is validated: an unmatched result or
      a dangling call fails validation
- [ ] Append-only is enforced by the API surface — there is no "edit turn N" function
- [ ] Round-trip test: serialize → parse → deep-equal, with a content hash assertion
      (this **is** the layer-1 100% guarantee — make it a real test, not a comment)
- [ ] Pure — no fs, no network, no Next.js imports (§C)

## Exceptions honored

- **E-9.b** The format carries no claim about model behavior. It stores what happened.
- **NFR-3** No vendor shape in the canonical form.

## Notes

- **`provider_artifact` is the pressure valve.** Claude thinking blocks, OpenAI
  `function_call` structures, and other vendor-specific payloads get preserved here
  rather than discarded — but nothing in replay *depends* on them. Store on write, drop
  on render to a different provider. That's how you keep Claude→Claude resumes lossless
  without making Claude→local resumes impossible.
- **Open: store repo context bytes, or just the SHA?** Storing bytes bloats the repo on
  every turn; storing only the SHA means re-fetching at replay and losing fidelity if the
  file was deleted or the repo went away. **Recommend SHA + `bytes` + `contentHash`, with
  re-fetch on replay** — and if re-fetch fails or the hash mismatches, report reduced
  fidelity (S-28) rather than silently substituting current content.
