# S-44 — Requirements elicitation: use what Loom already decided

**Phase:** 3 · **Workstream:** 10 Requirements · **Status:** Blocked by design (see below)
**Component:** Loom core agent · **Traces to:** FR-14.1–14.4, E-13.d
**Depends on:** S-42 · **Blocks:** nothing

## What changed

This story first proposed a new requirements-analyst agent, and a follow-up idea
proposed a trio of agents debating until they reach resolution, refereed by HR,
rewarded for effort. Reading Loom's ADRs before building found that **most of
this is already decided, and the research in Loom contradicts parts of it.**

## Already decided in Loom

| Idea | Already exists | Status |
|---|---|---|
| Requirements/exceptions register | ADR-0022 (2026-05-20), from this same spreadsheet | Accepted |
| Requirements → exceptions → test cases | ADR-0046 (2026-07-05) | Accepted |
| Multi-agent challenge | ADR-0056 deliberation panel (2026-07-15) | Accepted |
| Agent reputation / reward | ADR-0053, with anti-gaming | Accepted |
| Keeping inputs current | ADR-0020 runtime discovery, ADR-0025/0026 discovery + gate | Accepted |
| Adversarial review of requirements | `critic` agent, ADR-0026 | Exists |

## The author agent is deferred, on purpose

ADR-0046 §5: a dedicated requirements/test-case author agent is **explicitly
deferred** — *"skill now, agent later (build once the pattern is proven on 2–3
requirements — architect's decision, 2026-07-05)."*

The `/testcase` skill comes first. Shipping the agent now would override a
decision the architect already made with a stated reason. The drafted skill at
`loom-template/agents/requirements-analyst/SKILL.md` stays a draft until 2–3
requirements have been authored through `/testcase` and the pattern holds.

## Why a debating trio is the wrong instrument

The proposal — two more agents challenging each other until resolution — is
intuitive and ADR-0056 already tested it against the literature. Its findings,
with primary sources:

- **Voting captures most of the debate gain** (arXiv 2508.17536). Debate ≈ voting
  in many settings, at several times the cost.
- **Diversity is oversold by error correlation** (arXiv 2605.29800). A 9-judge,
  7-family panel behaves like **~2.2 independent votes**. Three agents from one
  family are worth far less than three votes.
- **Under equal compute, single agents match multi-agent** (arXiv 2604.02460).
  Some "multi-agent gains" are just more tokens spent.
- Unanimity inside one error-correlation family is flagged
  `confabulation_consensus_suspected`, its confidence **capped**, and escalated —
  not trusted.

So a trio that argues to consensus can produce *confident agreement on a wrong
answer*, and the agreement itself is the thing that makes it look right.

**Use ADR-0056's panel instead:** cheap by default, escalating to a model-diverse
panel only on high disagreement or high stakes, one debate round maximum,
reputation-weighted with capped weights, robust aggregation, confidence priced on
*effective independence* rather than raw vote count.

## Why "reward effort" is the wrong incentive

Rewarding the agent that puts the most effort into finding a solution rewards
**effort theater** — more tokens, longer arguments, more speculative objections.
It is precisely the failure ADR-0056 names when it observes that some multi-agent
gains are just more compute.

ADR-0053 already solved this, and solved it better:

- Reputation is a **quality rate, not a total**, confidence-smoothed so a
  low-volume agent is not out-ranked for being low-volume.
- Opportunity is earned by **authorship** — an agent self-assesses relevance, and
  the *accuracy* of that judgment accrues.
- **A correct decline is credited.** An agent that correctly says "I am not needed
  here" gains standing. Under an effort metric, declining is strictly punished —
  which would train agents to pile into every question.
- **Anti-gaming is explicit:** over-claiming does not accrue and may cost standing.

The instinct behind the proposal is right and is already encoded: agents invest
because standing yields opportunity. The correction is that the reward tracks
**being right and knowing when you are not**, not how hard you visibly tried.

## Termination is mechanical, not agreement

The one part of the original design that survives intact, and the reason the
panel is a *contributor* rather than the *decider*:

Agents can agree on an incomplete register. They cannot agree that a required
field is non-empty when it is empty. So completion is decided by the checks —
every `BR` has a solution, every solution has an `SE` and was asked about `BE`s,
every field filled, every `Next Step` resolves, every format handoff type-checks,
every `TR` listed, every unknown owned and dated — and the panel is what gets
consulted when a *judgment* inside those checks is contested.

## IDEA's half

IDEA reads the register (S-42) and links it to `test_case` events (S-43). It does
not run the interview and does not host the panel. Both happen in the project,
where the work is.

## Done when

- 2–3 requirements exist, authored through `/testcase`, per ADR-0046's gate.
- The drafted skill is reviewed against what those runs actually needed.
- Only then: a human installs it in `loom-template`.
