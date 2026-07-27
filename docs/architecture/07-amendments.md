# IDEA — Amendments to the Architecture Package

> **Status:** Adopted 2026-07-26. Amends `01-vision-requirements-exceptions.md`,
> `02-architecture-spec.md`, and `06-loom-integration.md`.
> **Files `00`–`06` do not yet reflect these changes** — see [S-01](../stories/S-01-architecture-package-in-repo.md).
> Where this document and `00`–`06` disagree, **this document wins**.

Three decisions were taken that expand Phase 2 beyond the original package:

1. **Provisioning runs in a mandatory local companion.** IDEA on Vercel stays a control
   plane; a local agent the user installs does all clone / install / bootstrap / process work.
2. **Conversations persist to each project's own GitHub repo** under `.idea/conversations/`,
   written via the GitHub REST API.
3. **Each project is a fresh clone of `loom-template`** that then diverges into its own
   repo holding everything specific to that project — source, Loom state, and
   conversations. `loom-template` is the seed, never a shared container.

---

## 1. Amended decisions

### AD-1 (amended) — Serverless control plane, local data plane

Unchanged in principle, **strengthened in practice**. The local companion (C-24) is no
longer an optional Phase-2 helper serving local models only. It is a **load-bearing,
Phase-0 component** without which project provisioning, the Observatory, and local
models do not function. IDEA on Vercel remains: auth, registries, routing, chat,
conversation read/write. Everything touching a filesystem, a process, or `127.0.0.1`
belongs to the companion.

### AD-6 (new) — Conversation archive is provider-neutral and repo-resident

Conversations are stored in a canonical format that belongs to no vendor, committed to
the project repo. This makes the archive portable across models (FR-9), diffable in git,
readable by a human, and durable independently of IDEA's own storage. It is the same
reasoning as AD-4: **the important state is declarative data, not code.**

### AD-7 (new) — The conversation archive is also the observability record

Each stored assistant turn carries the `RoutingDecision` that produced it. The archive
therefore satisfies NFR-5 without a second telemetry path, and gives the Loom Observatory
something concrete to visualize.

---

## 2. Amended exceptions

| Original | Status | Amended form |
|---|---|---|
| **GE-4** No repo write operations (commits/PRs/issues) in Phase 1/2 | **Narrowed** | Two carve-outs, both explicit: **(a)** IDEA may **create a new repo** seeded from `loom-template` when the user creates a project (FR-8.2); **(b)** IDEA may write **only** under `.idea/conversations/**` on a dedicated branch. No writes to project source. No PRs. No issues. No branch or repo deletion. |
| **E-2.c** No write-back to repos from IDEA | **Narrowed** | Same carve-out as GE-4. |
| **E-2.a** No local `git clone` — GitHub REST API only | **Scoped** | Still absolute **for IDEA's Vercel routes**. The local companion clones; that is its job (E-8.a). |
| **E-3.a** No server-side chat persistence in Phase 1 | **Superseded** | Persistence lands in Phase 2 per FR-9. Storage is the project repo, not a server-side database. |
| **NFR-2** Serverless-safe | **Unchanged, reaffirmed** | Vercel routes still assume no process and no filesystem. The companion absorbs all of it. |

Everything else in `01-vision-requirements-exceptions.md` stands, including the ones it
would now be tempting to bend: **E-5.a** (no arbitrary shell/FS tools exposed to models),
**E-6.a/b** (no local inference on Vercel, no server-side hardware detection), and
**E-7.a/b** (dashboards are local; vendored source is git-ignored).

> The companion running shell commands for provisioning does **not** open E-5.a. A model
> never chooses those commands — they come from the validated registry. Provisioning and
> tool-calling are separate paths and must stay that way.

---

## 3. FR-8 Project provisioning *(Phase 2 — new)*

**A project is a fresh clone of `loom-template` that becomes its own repo.** This matches
Loom's own model — *"each new project gets a fresh warp of Loom threaded into it via the
bootstrap step"* — and means IDEA supports two entry flows, not one.

- **FR-8.1** IDEA presents a **projects page** listing the user's Loom projects, each
  selectable, plus a **New project** action.
- **FR-8.2 (new project)** Creating a project generates a **fresh repo seeded from
  `loom-template`** under the user's GitHub account, then provisions it. The new repo is
  the project: it holds that project's source, Loom state, and conversations.
- **FR-8.3 (existing project)** Selecting an already-registered project clones and
  provisions it without re-seeding from the template.
- **FR-8.4** Provisioning through the companion runs: clone → install dependencies →
  Loom bootstrap (new projects) → start the Observatory.
- **FR-8.5** Provisioning streams **live per-step progress**. A failed step surfaces the
  actual error and the step it failed on — never a silent stall.
- **FR-8.6** Provisioning is **idempotent**. Re-selecting a provisioned project reuses
  the existing checkout rather than re-cloning.
- **FR-8.7** Each project reports state: `unprovisioned | provisioning | ready | running | error`.
- **Exception E-8.a** IDEA on Vercel never clones, installs, or spawns. Repo *creation*
  happens over the GitHub REST API (no filesystem); everything else runs in the companion.
- **Exception E-8.b** **New project repos default to private.** They will contain
  conversation transcripts. A public default would publish them.
- **Exception E-8.c** Provisioning steps come from the **validated registry**, never from
  content inside the project repo. IDEA does not read and execute a repo-supplied script list.
- **Exception E-8.d** Provisioning is **user-initiated and shows what it will run** before
  running it. No silent background provisioning on page load.
- **Exception E-8.e** IDEA never pushes to `loom-template` itself. The template is
  read-only upstream; a project's divergence is its own repo's business (AD-5).

> **Named risk:** `npm install` executes `postinstall` scripts, and Loom's bootstrap runs
> repo scripts. Provisioning any repo therefore eventually runs that repo's code on the
> user's machine. This is the ambient risk of `git clone && npm install` and cannot be
> designed away — only bounded. Bounds: registry-listed repos only, explicit user
> initiation, visible command list, companion runs as the user (not elevated).

## 4. FR-9 Conversation persistence & portability *(Phase 2 — new)*

- **FR-9.1** Conversations are **scoped to a project** and persisted to that project's
  GitHub repo under `.idea/conversations/` on a dedicated branch.
- **FR-9.2** Persistence uses the **GitHub REST API** and requires no local checkout —
  it works from a Vercel function and does not depend on the companion.
- **FR-9.3** The stored transcript is **canonical and provider-neutral**. It is never a
  dump of one provider's message format.
- **FR-9.4** Every piece of injected repo context is **pinned to a commit SHA**, so
  replay reconstructs what the model actually saw.
- **FR-9.5** A stored conversation can be **resumed on any configured model**. Rendering
  to a provider format preserves message count, role sequence, and tool-call/result pairing.
- **FR-9.6** When a conversation exceeds the target model's context window, IDEA compacts
  **deliberately** and **reports the fidelity of the resume** to the user.
- **Exception E-9.a** IDEA writes only under `.idea/conversations/**` (narrows GE-4).
- **Exception E-9.b** **Behavioral equivalence across models is not claimed.** See the
  fidelity model below.
- **Exception E-9.c** **Secrets are redacted before persistence.** A conversation is
  committed to a git repo that may be public or become public; an API key that appeared
  in chat must never reach a commit.
- **Exception E-9.d** No conversation is persisted to a repo the signed-in user cannot
  write. Write failures are surfaced, never swallowed.

### The fidelity model (what "99% accuracy in context" resolves to)

| Layer | Guarantee | Verified by |
|---|---|---|
| **1. Transcript integrity** — bytes stored = bytes loaded | **100%** | Content hash round-trip test |
| **2. Referenced context recoverable** | **100%**, conditional on FR-9.4 SHA pinning | Re-fetch by SHA; mismatch = reduced fidelity, reported |
| **3. Format translation** — canonical → any provider | **100% structural** | Conformance suite: no message dropped, roles preserved, tool pairs intact |
| **4. Context-window fit** | **Not always possible** | Measured and surfaced per resume (FR-9.6) |
| **5. Behavioral equivalence** | **Not guaranteeable** | Out of scope (E-9.b) |

Layers 1–3 are deterministic and testable, and are held to **100%**, not 99%. Layer 4 is
where fidelity is genuinely lost — a 400k-token conversation cannot enter an 8k-context
model — so it is quantified and shown to the user rather than silently truncated. Layer 5
is model behavior and belongs to no storage layer.

---

## 5. FR-4 extensions — fallback ordering & financial allocation *(Phase 2 — new)*

The original FR-4 router selects the **cheapest capable model within budget**. Cost is
the sole ordering function and the user has no say in it. Two additions:

- **FR-4.6** The user defines an **ordered fallback chain** of models. The router walks
  it in order.
- **FR-4.7** In auto mode the chain is the **ordering function**; the capability floor
  (FR-4.2) and the budget cap (FR-4.3) remain **filters**. Cost ranking applies only
  where the chain is silent. *This preserves determinism — the chain is data, and the
  walk is a pure function.*
- **FR-4.8** Fallback **triggers are distinguished and recorded**:
  `budget · provider_error · capability · unavailable`.
- **FR-4.9** A **financial allocation** is configurable per project and per period
  (day/month). The router consults remaining allocation before selecting.
- **FR-4.10** Spend is recorded from **actual provider-reported usage**, not estimates.
  Estimates are for pre-flight checks only.
- **FR-4.11** Every fallback is surfaced to the user: which trigger fired, which model
  was used, and what it replaced.

- **Exception E-4.c** Fallback is **bounded** — each chain entry is attempted at most
  once per turn. No loops, no unbounded retry.
- **Exception E-4.d** **No mid-stream fallback.** Once the first token has streamed, a
  failure is surfaced, not silently restarted on another model. Restarting mid-stream
  makes text vanish and rewrite itself, and bills the user twice.
- **Exception E-4.e** The chain **never bypasses the capability floor**. A cheaper entry
  that cannot meet the required tier is skipped, not used.
- **Exception E-4.f** If the ledger is unreadable, the router **degrades to the cheapest
  chain entry and warns**. It does not block chat, and it does not assume unlimited
  budget. (Fail-closed in spirit per NFR-4, without bricking the app when GitHub is slow.)

### The archive is already the ledger

Every stored assistant turn carries its `RoutingDecision` (AD-7), and every
`RoutingDecision` carries what the turn cost. **Cumulative spend is therefore derivable
from the conversation archive** — no second storage system, no database.

This resolves the open question left in [S-07](../stories/S-07-cost-and-budget.md): spend
was untrackable because Phase 1 had no persistence. It has persistence now. The one
change required is recording **actual** usage from the provider response alongside the
pre-flight estimate, so the ledger reflects what was spent rather than what was guessed.

## 6. Amended component map

| # | Component | Path | Phase | Change |
|---|---|---|---|---|
| C-24 | **Local companion** | *user's machine* | **0** | **Promoted** — load-bearing, not optional |
| C-25 | Conversation format | `lib/conversation.ts` | 2 | New |
| C-26 | Provider render adapters | `lib/conversation/render/*` | 2 | New |
| C-27 | Conversation store | `lib/conversation-store.ts` + `app/api/conversations/*` | 2 | New |
| C-28 | Secret redaction | `lib/redact.ts` | 2 | New |
| C-29 | Compaction & fidelity | `lib/compact.ts` | 2 | New |
| C-30 | Provisioning engine | companion | 2 | New |
| C-31 | Projects page | `app/projects/` + `components/project-list.tsx` | 2 | New |
| C-32 | Conversation resume UI | `components/conversation-picker.tsx` | 2 | New |
| C-33 | Project creation (seed from template) | `lib/scaffold.ts` + `app/api/projects/create` | 2 | New |
| C-34 | Fallback chain | `lib/fallback.ts` + `config/routing.json` | 2 | New |
| C-35 | Spend ledger & allocation | `lib/ledger.ts` | 2 | New |
| C-36 | Routing & budget settings UI | `components/routing-settings.tsx` | 2 | New |
| C-21 | Project registry | `lib/projects.ts` | 2 | **Expanded** — `gitUrl`, provisioning state, conversation branch |
| C-11 | Model registry | `lib/registry.ts` | 2 | **Changed** — `costWeight` → `inputWeight`/`outputWeight` |

## 6. Dependency direction (unchanged, now with the companion)

```
UI ─▶ API routes ─▶ lib (pure) ─▶ providers/adapters
                       ▲                    │
        registries (data)                   ▼
                                  companion (HTTP, 127.0.0.1)
                                       │
                                       ▼
                            git · npm · processes · HF · hardware
```

The companion is reached the same way a provider is: over HTTP, behind an adapter,
never imported. Vercel routes still never touch a filesystem or spawn a process.
