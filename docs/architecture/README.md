# IDEA — Architecture Package

The design of record for IDEA. Read in order.

| File | What it covers |
|---|---|
| [00-opening-prompt.md](00-opening-prompt.md) | Orientation for a fresh session; locked decisions; stack of record |
| [01-vision-requirements-exceptions.md](01-vision-requirements-exceptions.md) | What we're building and — importantly — what we are **not**. FR/NFR/exceptions |
| [02-architecture-spec.md](02-architecture-spec.md) | System design, layering, phase plan, ADRs, security model |
| [03-component-map.md](03-component-map.md) | Components → files/routes → dependencies, with requirements traceability |
| [04-process-flows.md](04-process-flows.md) | Auth, repo-pull, chat, routing, skills, projects — as sequence/flow diagrams |
| [05-data-contracts.md](05-data-contracts.md) | Zod-shaped request/response and registry schemas; env contract |
| [06-loom-integration.md](06-loom-integration.md) | How Loom's Observatory relates to IDEA |
| **[07-amendments.md](07-amendments.md)** | **Adopted changes that override the above** |

## ⚠️ Precedence

> **`07-amendments.md` wins wherever it disagrees with `00`–`06`.**

Files `00`–`06` are preserved as originally authored and have **not** been rewritten.
`07` records three decisions adopted 2026-07-26 that expand Phase 2 substantially:

1. **A mandatory local companion** does all provisioning (clone / install / bootstrap /
   process control). It is Phase-0 and load-bearing, not an optional helper.
2. **Conversations persist to each project's own GitHub repo** under
   `.idea/conversations/`, written via the REST API — so chat works with the companion off.
3. **Each project is a fresh clone of `loom-template`** that becomes its own repo,
   holding that project's source, Loom state, and conversations.

It also adds **FR-8** (provisioning), **FR-9** (conversation persistence & portability),
**FR-4.6–4.11** (user-ordered fallback chain and financial allocation), and amends
**GE-4**, **E-2.a**, **E-2.c**, and **E-3.a**.

## Known errors in `00`–`06`

Verified against the real repos. Left in place rather than silently edited, so the
originals stay intact — but **do not build from them without reading this list.**

| Where | Says | Reality |
|---|---|---|
| `05` §8, `06` Step 2 | `configPath: "config.yaml"` | Loom's config is at **`observatory/config.yaml`**. `projects/loom/config.yaml` does not exist. |
| `05` §4 | `costWeight: z.number()` — a single scalar | Loom's `cost_rates` are **asymmetric** (`input`/`output`, USD per 1M tokens) and the ratio differs per model. The registry carries `inputWeight` + `outputWeight`. See `07` §6. |
| `03` C-3 | `middleware.ts` — shipped ✅ | **The file does not exist.** Gating is per-route only. See [S-03](../stories/S-03-route-gating-middleware.md). |
| `00` Step 0 | "Read `middleware.ts`" | Same as above. |
| `06` "Coordinates" | Loom is "the Observatory" | The Observatory is **one component** of Loom. Loom is a framework — constitution, 18 subagents, 33 ADRs, discovery, lessons-learned. IDEA integrates with the Observatory and the `SKILL.md` format, not the framework. |

## Stories

Implementation is tracked in [`../stories/`](../stories/) — one story per component, each
tracing back to a numbered requirement here. Start at
[INDEX.md](../stories/INDEX.md).

**If a proposed change doesn't trace to a requirement in `01` or `07`, it's scope creep.**
Write a story or an exception first.

---

## Update: local-first (2026-07-27)

**[08-local-first.md](08-local-first.md) is the newest document and takes precedence
over everything else, including `07`.**

IDEA no longer runs on Vercel. It runs on the user's own machine and ships as a
one-command package (`npx idea`). This deletes the local companion (C-24 / S-16)
entirely and lifts three constraints — `E-2.a` (no local clone), `NFR-2`
(serverless-safe), and the `AD-1` control/data plane split.

**Precedence, newest first:** `08` → `07` → `00`–`06`.

## Update: agent authority (2026-07-27)

**[09-agent-authority.md](09-agent-authority.md) supersedes E-5.a and narrows GE-4 again.**

Agents can run commands and write code. IDEA adopts Loom's LR-04 permission
classification and Kernel Rule 20 (reversible → auto; destructive → confirm) rather than
inventing its own scheme. Scope is per-project; `loom-template` and IDEA's own source are
never agent-writable.

**Precedence, newest first:** `09` → `08` → `07` → `00`–`06`.

> `09` §5: the canonical Trajectory Kernel V6 is installed (2026-07-27). Reading the
> full text upgraded the Rule 22 trace record and added the Rule 15 verification ladder.

## Update: the Observatory is the dashboard (2026-07-27)

**[10-observatory-merged.md](10-observatory-merged.md) supersedes the
Observatory-as-separate-process model.**

IDEA's dashboard *is* the Loom Observatory, projecting each project's event log.
There is no `launch`, no `dashboardUrl`, no per-project server, and no `running`
state — a project is not a process.

**Precedence, newest first:** `10` → `09` → `08` → `07` → `00`–`06`.
