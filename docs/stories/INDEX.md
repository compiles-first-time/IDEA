# IDEA — Story Index

Status board for the Phase-2 build. One story per component, plus foundation stories that
close gaps between the architecture package and the repo.

**Statuses:** `Not started` · `In progress` · `Blocked` · `Done` · `Won't do`

Every story traces to a numbered requirement and a component. If a change doesn't trace
to one, it's scope creep — write a new story or an exception first.

> **Read [`08-local-first.md`](../architecture/08-local-first.md) first, then
> [`07-amendments.md`](../architecture/07-amendments.md).** `08` is the newest and wins:
> IDEA runs on the user's own machine and ships as a one-command package. `07` adds
> repo-resident conversations and project-per-repo. Both override `00`–`06`.

---

## Foundation

| ID | Story | Component | Status |
|---|---|---|---|
| [S-01](S-01-architecture-package-in-repo.md) | Land the architecture package in the repo | — | ✅ **Done** |
| [S-02](S-02-test-harness.md) | Test harness for deterministic libs | — (NFR-1) | ✅ **Done** |
| [S-36](S-36-cli-launcher.md) | **CLI launcher** (`npx idea`) | C-37 | ✅ **Done** |
| [S-03](S-03-route-gating-middleware.md) | Route-gating middleware | C-3 | Not started |
| [S-16](S-16-local-helper-contract.md) | ~~Local companion contract~~ | C-24 | ❌ **Won't do** — superseded by `08` |

## Workstream 1 — Model registry & manual picker

| ID | Story | Component | Status |
|---|---|---|---|
| [S-04](S-04-model-registry.md) | Model registry | C-11 | ✅ **Done** |
| [S-05](S-05-models-api.md) | Models API | C-14 | ✅ **Done** |
| [S-06](S-06-model-picker-ui.md) | Model picker UI | C-9 | Not started |

## Workstream 2 — Deterministic router

| ID | Story | Component | Status |
|---|---|---|---|
| [S-07](S-07-cost-and-budget.md) | Cost math & pre-flight estimates | C-13 | ✅ **Done** |
| [S-08](S-08-complexity-router.md) | Complexity scorer & model selector | C-12 | ✅ **Done** |
| [S-33](S-33-fallback-chain.md) | User-ordered fallback chain | C-34 | ✅ **Done** |
| [S-34](S-34-spend-ledger-and-allocation.md) | Spend ledger & financial allocation | C-35 | ✅ **Done** |
| [S-09](S-09-chat-route-routing.md) | Chat route: mode, model, RoutingDecision, fallback | C-8 | ✅ **Done** |
| [S-35](S-35-routing-settings-ui.md) | Routing & budget settings UI | C-36 | Not started |

## Workstream 3 — Provider adapters

| ID | Story | Component | Status |
|---|---|---|---|
| [S-10](S-10-local-provider-adapter.md) | Local provider adapter | C-15 | Not started |

## Workstream 4 — Portable skills & agents

| ID | Story | Component | Status |
|---|---|---|---|
| [S-11](S-11-skill-manifest-parser.md) | Skill manifest parser | C-16 | Not started |
| [S-12](S-12-tool-allowlist.md) | Tool allowlist & tool registry | C-18 | Not started |
| [S-13](S-13-agent-loop.md) | Provider-agnostic agent loop | C-17 | Not started |
| [S-14](S-14-skills-api.md) | Skills API | C-18 | Not started |

## Workstream 5 — Local models

| ID | Story | Component | Status |
|---|---|---|---|
| [S-15](S-15-fit-recommender.md) | Fit recommender | C-20 | ✅ **Done** |
| [S-17](S-17-local-control-api.md) | Local control API (proxy) | C-19 | Not started |

## Workstream 6 — Loom cost seeding

| ID | Story | Component | Status |
|---|---|---|---|
| [S-22](S-22-loom-vendor-and-cost-seed.md) | Seed cost rates from Loom's config | 06-loom | Not started — *narrowed* |
| [S-18](S-18-project-registry.md) | Project registry | C-21 | Not started — *expanded* |
| [S-19](S-19-projects-process-api.md) | Projects API: start / stop / status | C-22 | Not started — *narrowed to a proxy* |
| [S-20](S-20-dashboard-proxy.md) | Dashboard same-origin proxy | C-22 | **Won't do** (recommended) |
| [S-21](S-21-project-pane-ui.md) | Project pane UI | C-23 | **Won't do** — folded into S-31 |

## Workstream 7 — Conversations *(new)*

| ID | Story | Component | Status |
|---|---|---|---|
| [S-23](S-23-canonical-conversation-format.md) | Canonical conversation format | C-25 | ✅ **Done** |
| [S-24](S-24-provider-render-adapters.md) | Provider render adapters & conformance | C-26 | ✅ **Done** |
| [S-25](S-25-repo-context-sha-pinning.md) | Repo context SHA pinning | C-7/C-8 | ✅ **Done** |
| [S-26](S-26-secret-redaction.md) | Secret redaction before persistence | C-28 | ✅ **Done** — gates S-27 |
| [S-27](S-27-conversation-store.md) | Conversation store (GitHub API) | C-27 | Not started |
| [S-28](S-28-compaction-and-fidelity.md) | Compaction & fidelity reporting | C-29 | ✅ **Done** |
| [S-32](S-32-conversation-resume-ui.md) | Conversation resume UI | C-32 | Not started |

## Workstream 8 — Provisioning *(new)*

| ID | Story | Component | Status |
|---|---|---|---|
| [S-29](S-29-provisioning-engine.md) | Companion: provisioning engine | C-30 | Not started |
| [S-30](S-30-project-creation-from-template.md) | Project creation from `loom-template` | C-33 | Not started |
| [S-31](S-31-projects-page.md) | Projects page | C-31 | Not started |

---

## One tier now

The capability split is gone. IDEA runs on the user's machine, so there is no
"works here but not there" — every feature has the same access to files, processes,
and localhost. That removal is the point of
[`08-local-first.md`](../architecture/08-local-first.md).

## What remains

**Conversations** — S-27 (store) is the last piece of persistence. Both of its hard
prerequisites (S-25 pinning, S-26 redaction) are done. Then S-32 (resume UI).

**Projects & provisioning** — S-18 (registry) → S-29 (provision in-process) →
S-30 (create from template) → S-31 (projects page). S-19 folds into S-29.

**Skills** — S-11 (manifest) → S-12 (tool allowlist) → S-13 (agent loop) → S-14 (API).

**Local models** — S-10 (adapter) → S-17 (control API). Both now trivial: no proxy hop.

**UI** — S-06 (model picker), S-35 (routing & budget settings).

**Loose ends** — S-03 (middleware audit), S-22 (Loom cost seeding).

### Two ordering constraints that are not negotiable

1. **S-25 before S-27.** Persisting unpinned repo context makes every conversation
   written in the meantime permanently unreproducible. There is no backfill for a SHA
   you never recorded.
2. **S-26 before S-27.** A secret committed to git history means rotating the key and
   possibly rewriting a repo that may already be cloned. No retroactive fix exists.

## Open questions

| Question | Blocks | Recommendation |
|---|---|---|
| Is `loom-template` marked as a GitHub template repo? | S-30 | Check before designing the seed flow. |
| Is Loom's bootstrap non-interactive? | S-30 | FR-8.2 requires unattended. Read `loom-template/scripts/` first. |
| Does a capability shortfall escalate outside the user's chain? | S-33 | Probably yes — a cost-descending chain is the wrong order for escalation. Write the rule down. |
| ~~How does Vercel-hosted IDEA reach a `127.0.0.1` companion?~~ | — | **Resolved** — it doesn't. IDEA runs locally; the companion is deleted. See `08`. |
| ~~Where does session budget spend live?~~ | — | **Resolved** — derived from the conversation archive (AD-7). See S-34. |
| ~~Derive spend per turn, or maintain a roll-up?~~ | — | **Resolved** — a local ledger file is now trivial; the archive stays the source of truth. |

## Phase 3 — out of scope

Skill marketplace, multi-project orchestration, budget analytics dashboards, IDEA
emitting telemetry back to the Observatory. *(Chat persistence graduated into Phase 2.)*
