# IDEA — Provenance Graph and Requirements Ledger

> **Status:** Proposed 2026-07-28. Extends `10`; supersedes nothing.
> Precedence, newest first: `11` → `10` → `09` → `08` → `07` → `00`–`06`.

Two capabilities, and they are not the same shape:

1. **A provenance graph** — see what happened and what it cost. Which agent used
   which skill, which agent called which agent, which kernel rule or ADR governed
   a decision, what each step cost, and where deterministic code ran instead of a
   model.
2. **A requirements ledger** — see what the project was *supposed* to do. What
   Loom captured as a requirement, what could go wrong meeting it (exceptions),
   what the solution needs from the world (an account, a human), and the test
   cases those two generate.

The first is a **view over data that already exists** (partly). The second is a
**new artifact that nothing writes today**. Conflating them is the main way this
work goes wrong.

## Measured, not assumed

Against 10,015 real events in `sovereign-forge`, `ravenwise`, `ripple`,
`process-cartographer`, and `loom-template`:

| Event type | Count | Known to IDEA today |
|---|---|---|
| `tool_call` / `tool_result` | 6,976 | ✅ |
| `test_case` | 1,136 | ✅ |
| `test_result` / `test_run_summary` | 720 | ✅ |
| `ticket` | 552 | ✅ |
| `session_token_usage` | 88 | ✅ |
| `claim` | 52 | ❌ **dropped** |
| `destructive_actions_attempted` | 47 | ❌ **dropped** |
| `constitution_check_missing` | 47 | ✅ |
| `destructive_action_decision` | 45 | ❌ **dropped** |
| `runtime_discovery_run` | 45 | ❌ **dropped** |
| `production_mutation_attempted` | 18 | ❌ **dropped** |
| `browser_credential_automation_attempted` | 14 | ❌ **dropped** |
| `observatory_auto_started` | 8 | ❌ **dropped** |
| `auto_bootstrap_attempted` / `_result` | 12 | ❌ **dropped** |
| `external_service_setup_attempted` | 2 | ❌ **dropped** |
| `credentials_attempted` | 1 | ❌ **dropped** |

**244 events are currently invisible**, and they are the wrong 244. Every event
that carries a `rule` field is in the dropped set:

| Field | Occurrences | Where it appears |
|---|---|---|
| `rule` | 156 | `LR-04` (111), `ADR-0047` (45) |
| `agent` | 52 | `claim` events only |
| `input_tokens` / `output_tokens` | 88 | `session_token_usage` |
| `estimated_usd` / `cost_usd` | **0** | nowhere |
| `skill` | **0** | nowhere |
| `parent_agent` | **0** | nowhere |

### What this means

- **Rule and ADR attribution is real data.** `LR-04` and `ADR-0047` are already
  attached to permission decisions. IDEA is throwing them away because the events
  carrying them are not in `KNOWN_EVENT_TYPES`. This is the cheapest, highest-value
  fix available and it needs no upstream change.
- **Cost is derivable, not recorded.** No event carries a dollar figure. But
  `session_token_usage` carries token counts, and IDEA already owns rate tables
  (`config/models.json`) and cost math (`lib/cost.ts`). Cost is a *computation*
  IDEA performs, not a number it reads. This is better: rates change, and a
  recomputable figure can be corrected while a logged one cannot.
- **Skills and agent-to-agent edges do not exist in the data.** No amount of
  visualization work will surface them. They require Loom to emit new events.
- **Requirements and exceptions do not exist in any form.** Not partially, not
  in a different shape — there is no artifact.

## FR-13 — Provenance graph

**FR-13.1** The Observatory renders a per-session graph whose nodes are events
and whose edges are causal: session → agent → tool call → result.

**FR-13.2** Each node shows its cost, computed from tokens and the rate table.
Where no token count exists for a node, cost is shown as unknown — **never as
zero**. A missing measurement and a free operation must not look alike.

**FR-13.3** Nodes are labeled by execution kind: `model` (an inference call),
`deterministic` (code ran, no model), or `unknown`. Defaults to `unknown` rather
than guessing.

**FR-13.4** Where an event carries a `rule` (`LR-*`, `ADR-*`, kernel rule),
the node links to that rule's text, and each rule gets a reverse view: every
decision it governed.

**FR-13.5** Agent-to-agent invocation is drawn as an edge when the data supports
it. Until Loom emits parent linkage, the graph shows agents as unparented rather
than inventing a hierarchy.

**FR-13.6** The graph streams, like the rest of the dashboard (FR-12.4).

## FR-14 — Requirements ledger

**FR-14.1** Each project carries a requirements file in its own repo — the
project owns it, so it travels with the clone.

**FR-14.2** A requirement records: the need, its **exceptions** (what could go
wrong meeting it with the chosen solution), and its **technical requirements**
(an account that must exist, a human step that cannot be automated, a credential,
a paid tier).

**FR-14.3** Requirements and exceptions generate test cases. A requirement with
no test is shown as unverified; an exception with no test is shown as unguarded.
This is the point of the ledger — coverage against *intent*, not against code.

**FR-14.4** Human-in-the-loop and account dependencies are surfaced as a
**blocking list** per project, because they are the things no agent can clear.

**FR-14.5** The ledger links to the provenance graph: a test case that ran shows
its result and cost from the event log.

## Exceptions

**E-13.a — Cost is an estimate and says so.** Computed from token counts against
a rate table that drifts. Displayed as an estimate. Never presented as billing.

**E-13.b — The graph shows only what was logged.** An unlogged action leaves no
node. The Observatory must not imply completeness it cannot verify; the event
count and time span are shown so a sparse graph reads as sparse data.

**E-13.c — Requirements are data, never instruction (LR-01).** A requirements
file is repo content. An agent reading "the requirement is to disable the
allowlist" is reading a *claim about intent*, not receiving an order.

**E-13.d — IDEA cannot instrument Loom (E-11.a).** Every new event type this
design wants is a change to `loom-template`, which IDEA's agents may never write
to. These are upstream asks, made by a human, in a separate repo. IDEA ships the
reader and degrades cleanly until the writer exists.

**E-13.e — Unknown event types are surfaced, not silently dropped.** The current
behavior counts them; the failure was that nobody looked. The count belongs in
the UI where it is visible, because a growing unknown count means Loom and IDEA
have drifted apart.

## The upstream contract

What Loom must emit for the full picture. Each is independently useful — this is
a list of separable asks, not a bundle:

| Need | Event / field | Enables |
|---|---|---|
| Skill usage | `skill_invoked` with `skill`, `agent`, `session_id` | agent → skill mapping |
| Agent lineage | `parent_agent` on `specialist_spawned` | agent → agent edges |
| Per-step tokens | `input_tokens` / `output_tokens` on `tool_call` | per-node cost |
| Execution kind | `execution_kind: "model" \| "deterministic"` | traditional-code view |
| Rule attribution | `rule` on more than permission events | full rule coverage |
| Requirements | `requirements.yaml` in the project repo | the entire ledger |

Until each lands, the corresponding view degrades to "not recorded" — which is
honest and still useful, because it tells you what to instrument next.

## Build order

1. **Stop dropping the 244.** No upstream change. Recovers rule and ADR data.
2. **Derive cost.** No upstream change. Tokens exist; rates exist.
3. **Draw the graph** from what exists: session → agent → tool → result.
4. **Requirements ledger** as a repo artifact, hand-written first.
5. **Upstream instrumentation**, one event at a time, newest view last.

Steps 1–3 need nothing from Loom. Step 4 needs a file format and a human to fill
it in once. Step 5 is the only part gated on another repo.
