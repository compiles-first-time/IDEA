# S-41 — The provenance graph

**Phase:** 3 · **Workstream:** 9 Observatory · **Status:** Not started
**Component:** C-38, C-40 (new) · **Traces to:** FR-13.1, 13.3, 13.5, 13.6, E-13.b
**Depends on:** S-39, S-40 · **Blocks:** nothing

## Goal

See a session as a graph instead of a list: what ran, in what order, caused by
what, governed by which rule, at what cost.

## What the data supports today

Buildable now, from events that already exist:

```
session ──▶ tool_call ──▶ tool_result
   │            └─ rule: LR-04 · exit_code · error_signature
   └──▶ claim (agent, confidence, sources)
```

Not buildable, because the data does not exist (measured: zero occurrences):

- **agent → skill.** No `skill` field on any event, anywhere.
- **agent → agent.** No `parent_agent`. `specialist_spawned` appears twice in
  10,015 events and carries no lineage.
- **model vs deterministic.** Nothing marks execution kind.

Those need the upstream events in `11`'s contract table. **Ship the graph
without them.** A graph that draws what is real and labels the rest "not
recorded" is more useful than one that waits — it shows exactly which
instrumentation to add next, which is itself the argument for adding it.

## Scope

- Nodes: session, agent, tool call, result, permission decision, test case.
- Edges: causal only, and only where the data supports one (FR-13.5). An
  unparented agent is drawn unparented. **No inferred hierarchy** — a plausible
  guess about who called whom is indistinguishable from a fact once drawn.
- Node labels carry execution kind: `model`, `deterministic`, or `unknown`,
  defaulting to `unknown` (FR-13.3).
- Rule links both directions: node → rule text, and rule → every decision it
  governed (FR-13.4).
- Streams like the rest of the dashboard (FR-13.6) — reuse
  `lib/observatory-stream.ts` rather than adding a second transport.
- Show event count and time span (E-13.b) so a sparse graph reads as sparse
  *data*, not a quiet system.

## Design constraint

The projection stays a pure function in `lib/`. Graph building is deterministic
(NFR-1) — layout may be a library, but *what connects to what* is plain code with
tests. No model call decides an edge.

## Not in scope

Cross-project graphs, and editing. This view is read-only (E-12.b).

## Done when

- A real session from `sovereign-forge` renders with correct edges.
- An agent with no parent renders unparented rather than attached to a guess.
- Rule nodes link to and from `LR-04` and `ADR-0047`.
- Adding a `skill_invoked` event to a fixture makes skill edges appear with no
  change to the graph builder's shape.
