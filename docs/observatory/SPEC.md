# LOOM Observatory (L9) — Architectural Specification

| | |
|---|---|
| **Document** | `loom-observatory-spec-v4.md` |
| **Version** | 4.0 |
| **Date** | 2026-07-31 |
| **Status** | **Normative.** Where this spec and any prototype disagree, the spec wins; record deliberate deviations in §20 (Decision Log). |
| **Supersedes** | `loom-observatory-handoff.md` (v3 handoff brief) |
| **Reference implementation** | Single-file `loom-observatory.html` (v4, ~172 KB). Syntax-checked, data-validated, 34/35 smoke assertions passing at time of writing (§17.4). |
| **Suggested repo home** | `docs/observatory/SPEC.md` in `loom-template` |

---

## If you read nothing else (10 lines)

1. The Observatory answers six questions about every agent action: **who, what, where, when, why, how much (tokens + dollars)**.
2. It is the **combat log + damage meter** for the LOOM raid: read-only glass over the trace stream.
3. Two views only: **Home** (portfolio: project cards + cross-project analytics) and **Project dashboard** (the weave). There is no third "combined" view — Home *is* the combination.
4. One write path exists in the entire product: **Rule-19 amendment/approval proposals** into `update-bus/inbox/`. Everything else is display.
5. Data hierarchy: **Session → Run → Event**, mapped 1:1 onto OTel `session_id → trace_id → span_id`.
6. Every event carries **intent, justification, and a causal trigger** (Rule-22 schema v2). No orphan actions, ever.
7. **Amber ≠ red.** Halted-by-governance is amber and is the system *working*. Failed is red and is the system *breaking*. Never conflate them.
8. Config is **account-wide defaults with per-character overrides** (WoW-style): top-level DEFAULTS, per-project profile overrides, visual prefs always global.
9. All persistence is namespaced `l9:` in localStorage behind a try/catch wrapper; the app must run fine with storage disabled.
10. Single file, zero build step, zero network dependencies, Node 22 serves it at `localhost:4040`, live data arrives by SSE.

---

## 0. How to use this document (for Claude Code)

**Audience.** A fresh Claude Code session with zero conversation history, plus Nick reading alongside. Assume the reader has the `loom-template` repo and this file, nothing else.

**Precedence.** This spec is normative. The reference implementation is the working example of it. If you find a conflict: implement the spec, then log the conflict in §20.

**The missing 1%.** This spec deliberately does **not** duplicate the verbatim demo narrative text (the ~100 events' `intent` / `just` / `cap` strings). Those live in the reference implementation's data arrays (`R41`, `R42_MAIN`, `R42_APPROVE`, `R42_REJECT`, `R101`, `R102`). **Port them; do not re-author them.** §15 gives the authoring rules for *new* events.

**Build order (from scratch).** This ordering is dependency-safe and matches how v4 was actually built:

1. CSS type system first: rem scale (§12.2), contrast tokens (§12.3), design tokens (§12.1).
2. Layout: 5-column grid with gutters, adjustable-panel CSS variables (§12.6).
3. Static HTML shells: header controls, home shell, glossary overlay, guardrails pane (§3, §8, §11).
4. Core weave engine + demo data (§4, §9, §15) — this is v3's heart; keep it intact.
5. v4 JS layer, in module order (§14.2): persistence → project-2 data → projects → catalog/rates/defaults → cost → vault → fallback resolution → glossary → causal → panels → font → guardrails → policy editor → home → router.
6. Surgical hooks into the core engine (§14.3).
7. QA gates (§17): syntax check, data validator, smoke harness. **All three are mandatory before calling any change done.**

**Definition of done for any feature:** it has smoke coverage (§17.3), the data validator passes, `node --check` passes on the extracted script, and the feature obeys the invariants in §14.4.

---

## 1. Mission and mental model

### 1.1 The six questions

The Observatory exists so a human can point at any single agent action — out of millions of tokens of activity — and get an immediate, honest answer to:

| Question | Surfaced as |
|---|---|
| **Who** did it | actor thread + actor chip (Inspector "Who") |
| **What** they did | `action` string + verdict badge |
| **Where** it landed | `target` path + layer badge |
| **When** it happened | timestamp + duration + event id + run id |
| **Why** they did it | `intent` (one line) + `justification` (the fuller case) + causal `trigger` |
| **How much** it cost | tokens in/out/cache + model + dollars via the rates table |

If a screen doesn't help answer one of these six, it doesn't belong in the product.

### 1.2 The loom metaphor (load-bearing, not decorative)

- **Warp** — the vertical threads: persistent actors (human, agents, engine, files). They exist before, during, and after any run.
- **Weft** — the horizontal threads: events, woven left-to-right across the warp actors they connect, top-to-bottom in time.
- **Weaving** — playback. A run "weaves" as its events land.
- A finished run is **fabric**: you can read the whole cloth (who touched what, in what order) at a glance.

### 1.3 The raid-frame analogy (for orientation, WoW/ARPG register)

The Observatory is the **combat log, damage meter, and threat meter** for the agent raid. The token meter is literally a damage meter (bars per actor, hover for the per-source breakdown). Causal connectors are threat lines — who pulled aggro from whom. The R19 gate is the ready-check: the pull does not happen until the raid lead clicks yes. Amber "halted" is a called-off pull; red "failed" is a wipe. The distinction matters (§1.4).

### 1.4 Amber ≠ red (doctrine)

| Color | Meaning | Example | Reading |
|---|---|---|---|
| **Amber** (`--warn`) | Governance engaged. Blocked writes, waiting gates, human rejection, halted runs. | Run 042 rejected at R19 | **The system worked.** Nothing was written; everything was recorded. |
| **Red** (`--fail`) | Something broke. Failed verdicts, errors. | IPv6 zone-index parse failure | The system hit a genuine defect or bad input. |

Every visual, badge, caption, and chart in the product must preserve this distinction. A halted run card is amber, never red.

### 1.5 Teaching-first design

The product assumes a first-time viewer. Mechanisms: the **Learn** toggle narrates every event in plain language (`cap` field, second person, honest); the **glossary** makes every rule/ADR token clickable everywhere it appears; empty states explain themselves; captions never lie about what's scripted vs. live.

---

## 2. System context

### 2.1 Where L9 sits

LOOM's layer stack (also the `layer` vocabulary for events, §4.6):

| Layer | Name | One-liner |
|---|---|---|
| L0 | constitution | Kernel rules; pre-flight checks; the un-toggleable floor |
| L1 | skeleton | Repo structure, ADRs, scaffolding |
| L2 | agents | Base agents + ephemeral specialists (EAC lifecycle) |
| L3 | memory | Reconciliation, lessons-learned, self-knowledge |
| L4 | tooling | Scripts, deterministic tools |
| L5 | orchestration | Supervisor, task ledger, run lifecycle |
| L6 | observability | Trace emission (what this product consumes) |
| L7 | update bus | Inbox/outbox; the one write path's destination |
| L8 | discovery | Research, ADR reads for decision context |
| L9 | **observatory** | **This product** — the glass |

### 2.2 Runtime constraints (hard)

| Constraint | Value | Why |
|---|---|---|
| Server | Node 22, `localhost:4040` | Matches LOOM dev harness |
| Transport | SSE, one-way (`EventSource('/events')`) | Trace stream is append-only; no client → agent channel |
| Packaging | **One HTML file**, vanilla ES2022, no build step, no frameworks, no CDN, no network fetches | Auditability + drop-in portability; the Observatory must not depend on anything it can't see |
| Write path | Exactly one: Rule-19 proposals → `update-bus/inbox/` | The glass must not become a control panel |
| Theme | Dark only (slate/charcoal, `#3b82f6` accent) | §12.1 |
| Emoji | None anywhere in product UI | House rule |
| Storage | localStorage only, `l9:` namespace, failure-tolerant | §13 |

### 2.3 Read-only doctrine

The dashboard renders state; it does not command agents. The two apparent exceptions are both **proposal** flows, not commands: (a) R19 approve/reject buttons at a live gate record a *human decision event* into the trace (the runtime enforces it); (b) "Propose amendment" drafts a proposal file for human review. Everything else — switches, sliders, editors — edits *dashboard-side profile data* (§5–§6) that the runtime reads at next-run boundaries.

---

## 3. Information architecture

### 3.1 Two views, one router

| View | Body class | What it is |
|---|---|---|
| **Home** | `body.home-mode` | The portfolio: rich project cards + cross-project analytics + top-level settings. **This is the "all projects" view** — there is no other. |
| **Project dashboard** | (default) | v3's three-panel view (run rail / weave stage / right rail) + all v4 features, scoped to one project. |

**Routing rules (locked decisions D3/D4):**

1. Every page load lands on **Home**. No deep-link restore of a project (yet).
2. The card of the last-opened project wears a small `last opened` chip (from `l9:lastproj`).
3. Header, both views: **HOME** button + a project `<select>` (placeholder option "— portfolio —") + brand click → Home.
4. Opening a project selects its best run: `project.lastRun` if set this session → else first run in `ready` state → else first non-queued run.
5. Home hides project-only header controls (transport, odometer, Learn, session chip) via `body.home-mode` CSS.

### 3.2 Project view wireframe

```
┌ header: LOOM OBSERVATORY · sesschip · status ── HOME [project ▾] [A− 16 A+] Learn ⏵ transport 1× odometer ┐
├───────────────┬──┬─────────────────────────────────────────────┬──┬───────────────────────────────┤
│ run rail      │H1│ stagebar: RUN 042 · title · legend          │H2│ tabs: INSPECTOR TOKENS GUARD. │
│  ┌─────────┐  │  │ ┌─────────────────────────────────────────┐ │  │ ┌───────────────────────────┐ │
│  │ runcard │  │  │ │            weave (SVG)                  │ │  │ │  active pane              │ │
│  │ 041 ●   │  │  │ │  warp: 17 actor columns                 │ │  │ │  (inspector cells /       │ │
│  │ 042 ◍   │  │  │ │  weft: events woven downward            │ │  │ │   token meter /           │ │
│  │ 043 ◌   │  │  │ │  gate bands · halt band · causal arcs   │ │  │ │   guardrails+profile)     │ │
│  └─────────┘  │  │ └─────────────────────────────────────────┘ │  │ └───────────────────────────┘ │
│               │  │ layerstrip: L0..L9 chips · causality chip   │  ├──────────── H3 ───────────────┤
│ railfoot:     │  │ caption (Learn narration)                   │  │ feed (mono event stream)      │
│ project total │  │ gate bar (only while a gate waits)          │  │                               │
└───────────────┴──┴─────────────────────────────────────────────┴──┴───────────────────────────────┘
```

H1/H2/H3 are drag handles (§12.6). The layer strip's right side holds the causality mode chip (§9.6) and the filter hint.

### 3.3 Home view wireframe

```
┌ header: LOOM OBSERVATORY ─────────────── HOME [— portfolio — ▾] [A− 16 A+] ┐
│                                                                            │
│  PORTFOLIO — ALL PROJECTS                                                  │
│  [spend $] [total tokens] [runs by state] [projects · stages]              │
│                                                                            │
│  PROJECTS                                                                  │
│  ┌ pcard: netcap-redaction · TESTING ┐  ┌ pcard: telemetry-ingest · DEV ┐  │
│  │ desc · $ · tokens · runs · events │  │ ...                            │  │
│  │ last used 2026-07-31 09:14 · nick │  │ last used 2026-07-29 · m.osei  │  │
│  └───────────────────────────────────┘  └────────────────────────────────┘  │
│                                                                            │
│  ┌ AGENT USAGE (hover → per-project) ┐  ┌ GOVERNANCE CITATIONS ┐           │
│  ┌ PATTERNS ACROSS PROJECTS (computed counts + labeled readings) ┐          │
│  ▸ TOP-LEVEL SETTINGS — defaults every project inherits                    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data model

### 4.1 Hierarchy and OTel mapping

```
Session  (one conversation)          = OTel session_id     e.g. prism-chat-07
└─ Run   (one prompt→response cycle) = OTel trace_id       e.g. 042
   └─ Event (one traced action)      = OTel span_id        e.g. evt-042-17
```

Run boundary: opens at `task_submitted`, closes at `session_end · *`. One session per project in the demo (decision D1); multi-session is deferred to live wiring (§16, §18).

### 4.2 Event schema (Rule-22 trace record, v2) — authored fields

| Field | Type | Req | Semantics |
|---|---|---|---|
| `id` | string | ✓ | `evt-<run>-<nn>`, `nn` zero-padded, sequential, **immutable** (parents and xrefs point at these — never renumber) |
| `ts` | string | ✓ | `HH:MM:SS.mmm`, monotonic within a run |
| `from` | thread id | ✓ | Acting thread (§4.4) |
| `to` | thread id | ✓ | Receiving thread; the weft spans `from`→`to` |
| `cls` | enum | ✓ | Visual/semantic class (§4.5); drives weft color |
| `action` | string | ✓ | Verb vocabulary (§4.7) |
| `layer` | enum | ✓ | `L0`…`L9` (§2.1) |
| `target` | string | ✓ | Path or object acted on; mono in UI; ADR ids (`ADR-0051`) are scanned out of here for analytics |
| `intent` | string | ✓ | **Why, one line.** Mandatory for every event, no exceptions |
| `just` | string | ✓ | Justification: rule basis, expected outcome, alternatives rejected |
| `trigger` | `{rule, parent}` | ✓ | Causal chain (§4.8). Both nullable only at run roots |
| `thought` | string | – | LLM reasoning summary; **only** on model-call events |
| `model` | string | – | Model id when a model produced the output, incl. embeddings (`voyage-3 · embedding`) |
| `tokens` | `{in, out, cache}` | ✓ | `in` **grows across a run** (agent loops re-send accumulated context — this is why runs reach millions). `cache` = cache reads |
| `dur` | int (ms) | ✓ | Drives playback animation time (`max(240, dur)/speed`) |
| `verdict` | enum/null | ✓ | `pass` · `fail` · `blocked` · `null` (= in flight) |
| `cap` | string (HTML) | ✓ | Learn-mode caption. Second person, teaching voice, `<b>` for emphasis, honest about scripted vs live |
| `xref` | `{run, evt, label}` | – | Cross-run provenance link (lesson born here / consumed there). Same-project only |
| `gate` | `true` | – | Marks an interactive pause point (live-play runs with tails only) |

Runtime attaches `_els`, `_g`, `_path` (render handles). Never author these; always reset them to `null` before re-rendering a run.

### 4.3 Run object schema

| Field | Type | Semantics |
|---|---|---|
| `id` | string | `"041"` — unique within project; display id |
| `title` | string | Card + stagebar title |
| `started` | string | `HH:MM` or `"—"` (queued) |
| `state` | enum | `queued → ready → weaving ⇄ gate → complete \| halted` (§4.9) |
| `specialist` | string | Label swapped onto the `smith` warp column while this run renders |
| `events` | Event[] | Main line |
| `tails` | `{approve: Event[], reject: Event[]}` or `null` | Alternate futures after the R19 gate. `ACTIVE = events + tails[decision]` |
| `cursor` | int | Index of last woven event; `-1` = nothing woven |
| `decision` | `"approve"` / `"reject"` / `null` | Set by gate buttons (live) or pre-set (scripted). Stepping back across the splice point clears it |
| `note` | string/null | Rail card hint ("uses 1 lesson from run 041") |

Helpers (keep these exact semantics): `runActive(r)` returns the spliced ACTIVE array; `runMaxLen(r)` = events + longest tail (used for stage height so the weave never reflows on decision).

### 4.4 Warp threads (the 17 columns, in order)

| id | label | group | Notes |
|---|---|---|---|
| `nick` | you | HUMAN | The human is a first-class actor with a column |
| `sup` | supervisor | L5 ORCH | Run orchestrator |
| `cs` | constitution-svc | WARP · BASE AGENTS | Kernel checks |
| `hr` | hr-agent | WARP · BASE AGENTS | |
| `eac` | eac | WARP · BASE AGENTS | Specialist lifecycle (spawn/retire) |
| `critic` | critic | WARP · BASE AGENTS | Post-write review |
| `mem` | memory-keeper | WARP · BASE AGENTS | Reconcile, lessons |
| `rep` | human-replica | WARP · BASE AGENTS | `dormant:true` → dashed, inert |
| `smith` | *specialist* | WEFT · SPECIALIST | `hidden:true` until spawned; label = `RUN.specialist`; re-hidden on retire and on re-render reset (§14.4) |
| `llm` | llm | ENGINE | |
| `script` | scripts / tools | ENGINE | |
| `f_const` | constitution/ | LIBRARY · FILES | `file:true` → dotted warp |
| `f_adr` | adr/ | LIBRARY · FILES | |
| `f_mem` | memory/ | LIBRARY · FILES | |
| `f_led` | orchestration/ | LIBRARY · FILES | |
| `f_bus` | update-bus/ | LIBRARY · FILES | Where decisions + proposals land |
| `f_ws` | workspace | LIBRARY · FILES | Project working tree; the only column real writes touch |

`KIND` maps thread → `human | supervisor | agent | specialist | llm | script` for actor chips.

### 4.5 `cls` vocabulary (weft color classes)

| cls | Meaning | Typical actions |
|---|---|---|
| `human` | Human-involving events | task_submitted, approval_request, decision · *, session_end · * |
| `ledger` | Task-ledger writes | ledger_write |
| `gov` | Governance checks/verdicts | constitution_check_request, constitution_verdict |
| `read` | File reads | file_read |
| `write` | Real file writes | file_write |
| `block` | Blocked attempts | write_attempt · BLOCKED |
| `ok` | Lifecycle/positive outcomes | specialist_spawned, specialist_retired, critic_review · pass |
| `fail` | Genuine failures | any `verdict:"fail"` event |
| `llm` | Model calls | llm_call · * |
| `mem` | Memory ops | reconcile, lesson_promoted, lesson_reinforced, memory_query |
| `tool` | Deterministic tool/script runs | script_run · *, spawn_request |

Colors come from `--c-*` custom properties (§12.1). Amber/red doctrine (§1.4) overlays this: `block` renders amber-family, `fail` renders red-family.

### 4.6 Layers

Use the L0–L9 table in §2.1. Rules of thumb: kernel activity `L0`; ADR reads `L1` (structure/decision context) or `L8` (research); specialist lifecycle `L2`; memory `L3`; script runs `L4`; ledger/orchestration `L5`; workspace reads/writes `L6`; bus decisions `L7`.

### 4.7 Action naming conventions

- `snake_case` verb-first: `file_read`, `ledger_write`, `spawn_request`.
- Qualifier suffix with spaced middot for outcomes/purposes: `write_attempt · BLOCKED`, `decision · APPROVE`, `decision · REJECT`, `session_end · report`, `session_end · halted`, `llm_call · design specialist`, `script_run · span-link dry-run`.
- The renderer keys off prefixes, so keep them stable: gate bands trigger on `write_attempt · BLOCKED` + `verdict:"blocked"`; the halt band triggers on `action.startsWith("session_end · halted")`; step-back run-state repair keys off `action.startsWith("session_end")`.
- Canonical set in the demo: `task_submitted, ledger_write, constitution_check_request, constitution_verdict, file_read, file_write, llm_call · *, spawn_request, specialist_spawned, specialist_retired, write_attempt · BLOCKED, approval_request, decision · APPROVE/REJECT, critic_review · pass, script_run · *, reconcile, lesson_promoted, lesson_reinforced, memory_query, session_end · report/halted`.

### 4.8 Trigger chains (causality)

- `trigger.parent`: **exactly one** parent id, and the parent must appear **earlier in the same run's ACTIVE order**. Fan-out (one parent, many children) is expected and is what the "outgoing" connectors visualize. Root events (`task_submitted`) have `parent:null`.
- `trigger.rule`: the governing rule token, or null. Vocabulary in the demo: `Kernel R19`, `Kernel R22`, `kernel pre-flight`, `destructive-op rule`, `destructive-op rule → Kernel R19`, `lifecycle: reconcile`, `lifecycle: retire`. Compound `A → B` strings are legal and the glossary resolves them (§8.4).
- Validator enforcement (§17.2): no dangling parents, no forward references.

### 4.9 Run state machine

```
queued ──(first record arrives / demo: never)──► ready
ready ──play──► weaving ──all woven──► complete
weaving ──BLOCKED event with gate:true──► gate (playback pauses, gate bar shows)
gate ──human APPROVE──► weaving (tails.approve spliced)──► complete
gate ──human REJECT──►  weaving (tails.reject spliced)──► halted
any ──step-back across splice──► decision cleared, tails un-spliced, state repaired
```

Rail-card dot semantics: `complete` solid green · `ready` hollow blue ring · `weaving` pulsing green · `gate` pulsing amber · `halted` solid amber · `queued` dashed hollow. Halted is **amber, never red** (§1.4).

---

## 5. Projects and the portfolio layer

### 5.1 PROJECT schema

| Field | Type | Semantics |
|---|---|---|
| `id` | string | `"netcap"`, `"telemetry"` — storage key component |
| `name` | string | Display name (`netcap-redaction`) |
| `desc` | string | Card description: what the project *is*, one honest sentence or two |
| `stage` | enum | SDLC: `planning · design · development · testing · deployment · maintenance` (badge classes `stg-<stage>`, §12.1) |
| `operator` | string | **Last used by whom.** Demo names now; the field exists because the cloud version is multi-user, so identity must be structural, not cosmetic |
| `session` | string | Session id shown in the header chip (`prism-chat-07`) — one per project in the demo (D1) |
| `lastUsed` | string | `YYYY-MM-DD HH:MM` shown on the card |
| `runs` | Run[] | This project's runs; `RUNS` global always aliases the open project's array |
| `cfg` | object | **Only the overrides** (§5.2). Absent keys inherit DEFAULTS. Persisted at `l9:proj:<id>` |
| `lastRun` | string | Runtime-only: last run viewed this session; drives default-run choice (§3.1 rule 4) |

### 5.2 Config inheritance — Model B (locked decision f1)

Account-wide defaults, per-character overrides:

```
DEFAULTS (top level, Home settings)      p.cfg (per-project overrides)
  providers:  ["anthropic","voyage"]       providers?   ─┐
  chains:     {routing:[...], ...}         chains?       ├─ present key = override
  allocUSD:   150                          allocUSD?     │  absent key  = inherit
  budgetTok:  8                            budgetTok?   ─┘
  local:      {critic:true, netblock:true} local?  (per-rule shallow merge)
```

Resolution (`cfgOf(p)`): spread DEFAULTS, overlay `p.cfg`; `chains` and `local` merge **per key** (a project can override one tier or one rule without copying the rest). The resolved object also exposes `_ov` (the raw override set) so the UI can render **override chips**.

**Override chip rules:** wherever a project value differs *because an override exists* (key present in `p.cfg`), render an `overridden` chip; clicking it deletes the override key (and any emptied parent object), persists, re-renders — the value snaps back to the default. Editing a value in a project pane always **writes an override**; editing in Home settings always **writes DEFAULTS**.

**Never in profiles (global, immediate, `l9:` root keys):** font size, panel widths/feed height, Learn toggle, playback speed. Visual comfort is the viewer's, not the project's.

### 5.3 SDLC stages

Fixed enum, one badge per card. Demo assignment: `netcap-redaction → testing`, `telemetry-ingest → development` (deliberately different so the badge visibly varies). Stage is display metadata only in v4 — nothing branches on it yet.

---

## 6. Model policy and economics

### 6.1 Provider catalog and rates (top level)

- `PROVIDERS`: `anthropic, openai, google, voyage, local` (local = self-hosted; never needs a key).
- `MODEL_PROV`: model id → provider id map. Every model in `RATES` must appear here.
- `RATES` (persisted `l9:rates`): `{model: {in, out, cache}}` in **$ per 1M tokens**. Ships with **clearly-labeled example placeholder numbers** and an editable table in Home settings — the UI copy must say "example rates — edit to your negotiated pricing." Editing re-renders every $ surface live.
- **Model-string normalization:** trace records may carry decorated ids (`voyage-3 · embedding`). Cost lookup tries the exact string, then the substring before the first space. Never hard-fail on an unknown model — cost contribution is 0 and the tooltip shows the raw id.

### 6.2 Cost formulas

```
evCost(ev)      = in/1e6·rate.in + out/1e6·rate.out + cache/1e6·rate.cache   (0 if no model/rate)
runCostUSD(r)   = Σ evCost over ACTIVE[0..cursor]          ← "so far", matches token totals
projCostUSD(p)  = Σ runCostUSD over p.runs
fmtUSD(n)       = "$" + (n ≥ 100 ? 0 dp : 2 dp)
```

Dollar surfaces: home insight card, project cards, Tokens tab run-cost line (`#meterusd`), per-model tooltip lines, project budget bars.

### 6.3 Tiers and fallback chains (per project, inheritable)

Four fixed complexity tiers — think of it as picking which raider handles which mechanic by cost:

| Tier | Meant for | Demo default chain |
|---|---|---|
| `routing` | Cheap classification/dispatch | haiku |
| `standard` | Everyday agent turns | sonnet → haiku |
| `generation` | Heavy code/content generation | opus → sonnet |
| `critical` | Must-not-fail steps | opus |

### 6.4 Effective-model resolution (`effModel(chain, cfg, spendPct)`)

1. **Availability filter:** model is available iff its provider is in `cfg.providers` AND (provider is `local` OR the vault is uninitialized OR a key is stored for that provider). Providers without keys are *skipped, not errors*.
2. If nothing survives → `{m:null, why:"no available model"}` — render as a problem, don't guess.
3. `spendPct ≥ 100` (of `allocUSD`): **halt non-critical tiers**; `critical` still resolves (to the last available chain entry). Budget bar shows the red 100% marker crossed.
4. `spendPct ≥ 80`: **downshift one step** along the available chain (clamped). Amber 80% marker.
5. Else: primary (first available).

The per-project pane renders a **resolved-policy preview** — for each tier, the model that would be used *right now* and why ("primary" / "downshifted ≥80% of allocation" / "over allocation — halt non-critical").

**Honesty caveat (must appear in the preview copy):** scripted demo events keep their recorded `model` values; the policy governs *future* runs. The dashboard never rewrites history to match config.

---

## 7. Key vault (dashboard-side, demo-grade by design)

### 7.1 Crypto parameters

| Parameter | Value |
|---|---|
| KDF | PBKDF2, SHA-256, **150,000 iterations**, 16-byte random salt (`l9:vsalt`, b64) |
| Cipher | AES-GCM, 256-bit, 12-byte random IV per encryption |
| Passphrase check | Encrypted check blob `"l9-vault-ok"` at `l9:vchk`; wrong passphrase fails decryption → locked |
| Key blobs | `l9:vk:<provider>` = `{iv, ct}` b64 |
| In-memory | Derived CryptoKey held only for the session; never persisted |

### 7.2 Behavior

- Set-or-unlock is one flow: no salt → create vault; salt exists → derive and verify against check blob.
- Stored keys display **masked, last 4 only** (`…x9Kf`), decrypted on demand while unlocked.
- **No recovery.** Forgotten passphrase = re-enter keys. Say so in the UI, plainly.
- `crypto.subtle` needs a secure context (localhost and file:// qualify in practice); feature-detect and show a graceful "encryption unavailable in this context" note instead of breaking.

### 7.3 Migration commitment (display this, verbatim spirit)

This vault exists so the demo is honest rather than fake. **At live wiring, provider keys move server-side; the dashboard shows key *status* only and never holds secrets.** (§16, §18.) The settings copy must keep saying this so nobody mistakes the demo posture for the production one.

---

## 8. Governance surfaces

### 8.1 Kernel rules (constitutional)

Rendered from `KERNEL_RULES` (R19 human write-gate, R22 trace mandate, DOP destructive-op protection). **There is no switch — not disabled, absent** (locked decision 5). Each row: rule name (glossable) + `KERNEL · <id>` lock badge (glossable) + a **Propose amendment** button.

Propose amendment drafts an amendment card (dashed amber panel): explains that the proposal is written to `update-bus/inbox/` for human review under R19, with Withdraw. This is the product's one write path (§2.3) and it is a *proposal*, never an action.

Kernel note copy must explain *why* there's no switch: these are not switchable from anywhere downstream — the dashboard refusing to render a toggle is the point. (Server-side rules, not client config; an addon can't grant itself permissions.)

### 8.2 Local rules (per-project profile)

Two demo rules — `critic` (critic review on file_write) and `netblock` (specialists get no network at spawn) — plus the per-run token **budget slider** (`budgetTok`, demo default 8M). All three resolve through `cfgOf` (§5.2), render override chips when overridden, and note they write to `constitution/local-rules.md` effective next run. Header names the project: "Local rules — *<project>*'s profile".

### 8.3 Models & budget (per-project pane)

Lives as the third Guardrails section (`#modelcfg`): enabled-provider checkboxes (with ●/○ key-status dots), `allocUSD` input, spend **budget bar** (project spend vs allocation; 80% amber marker, 100% red marker; fill class shifts warn80/over), the four tier-chain editors (selects populated from enabled providers' models), and the resolved-policy preview (§6.4). Every control: override chip + reset per §5.2.

### 8.4 Glossary (system-wide)

**Entry schema:** `{id, kind (kernel rule | local rule | ADR | lifecycle | mechanism), title, src (repo path), body (what + why, 2–4 sentences), related[]}`.

**Coverage (demo):** `R19, R22, DOP, preflight, critic, netblock, budget, ADR-0039, ADR-0051, reconcile, retire`.

**Alias resolution (`resolveGloss`):** longest-match token table maps display strings → entry ids; compound trigger strings (`destructive-op rule → Kernel R19`) resolve to the *first* matched entry, whose `related[]` links carry you to the second. Unknown token → no-op (never a broken overlay).

**Clickable surfaces (all get `.glossable` + `data-gl`):** inspector rule chips, kernel rule names + lock badges, local rule names, budget label, the gate bar's `R19` icon, governance-chart rows on Home. One **document-level delegated click handler** (capture phase) serves all of them — new surfaces only need the class + attribute.

**Overlay:** fixed, z-60, over any view. Contents: kind eyebrow · title · source path · body · related chips (click = navigate within glossary) · **live citations**: events in the *current run* whose `trigger.rule` contains the token or whose `target` contains the ADR id — woven ones are clickable jumps (select + scroll), unwoven ones render disabled with "play further to reach it". On Home (no run): citations section shows "open a project to see live citations." Close: × button, backdrop click, or Esc (which closes the glossary *before* clearing any layer filter — priority order in the keydown handler).

---

## 9. The weave (stage)

### 9.1 Geometry (all values × FSC)

```
FSC      = rootFontSizePx / 16          (font knob rescales the whole loom, §12.2)
LEFT     = 8      left margin
THREAD_W = 64     warp column pitch
TOP      = 64     header band (group labels + thread labels)
ROW      = 27     one event's vertical pitch
W        = LEFT + 17·THREAD_W + 20
H(run)   = TOP + (runMaxLen(run) + 2)·ROW + 30      floor: 420·FSC
xOf(t)   = LEFT + index(t)·THREAD_W + THREAD_W/2
yOf(i)   = TOP + i·ROW + 8                          (i = index in ACTIVE)
```

`runMaxLen` (not current length) sizes H so the weave **never reflows** when a gate decision splices a tail in.

### 9.2 Render pipeline

`renderStatic(H)` wipes the SVG and rebuilds: `<defs>` (three causal arrowhead markers `mk-in`, `mk-out`, `mk-all` — defs die with the wipe, so they are recreated every run), then groups **in paint order** `gThreads → gWeft → gCause → gPulse`, warp lines (dormant = sparse dash, files = fine dash), group labels, thread labels, head glows. `drawWeft(ev, instant)` draws one event: a sagging quadratic weft from `xOf(from)` to `xOf(to)`, node dots at both ends, a 14px-wide invisible hit path, marker decorations (§9.3). Animated draw uses stroke-dash on `getTotalLength()` over `max(240, ev.dur)/speed` ms.

### 9.3 Markers

| Marker | Trigger | Visual |
|---|---|---|
| Gate band | `cls:"block"` + `verdict:"blocked"` | Amber dashed band across the row; `waiting` variant marches (animated dashoffset) while a live gate is open |
| Halt band | `action.startsWith("session_end · halted")` | Solid amber band + `HALTED` tag |
| Fail ✕ | `verdict:"fail"` | Red stroke ✕ at the target node |

### 9.4 Side effects and idempotence

`applySideEffects(ev)`: `specialist_spawned` unhides `smith` (+ label = `RUN.specialist`); `specialist_retired` re-hides. `unapplySideEffects` inverts for step-back. **Invariant:** any full re-render (font change, run switch) resets `T.smith.hidden = true` *before* replaying effects `0..cursor`, so a specialist never ghosts into a run that hasn't spawned one.

### 9.5 Interaction: hover, select, filter

Hover: brightens the weft, shows the tooltip (actor, action, tokens). Select (click weft/feed row/citation): `sel` class + drop-shadow, Inspector + caption update, **never switches the right-rail tab** (invariant). Layer chips: hover pre-highlights that layer's events; click sets `filterLayer` — non-matching events, threads, feed rows, and **causal arcs** dim together; Esc clears (after glossary, §8.4).

### 9.6 Causal connectors (locked decision 2)

- **Modes:** `sel` (default) — arcs for the selected event only; `all` — every parent→child edge up to the cursor. Toggle chip in the layer strip: `causality: selected ⇄ all`.
- **Direction styling:** incoming cause = solid near-white arc + arrowhead (`.cause-in`/`mk-in`); outgoing consequences = dim dashed (`.cause-out`/`mk-out`); all-mode background edges = faint dotted (`.cause-all`/`mk-all`). In all-mode, the selected event's own edges still render in/out styling on top.
- **Depth:** direct parents/children only (decision 2c). Deeper ancestry stays navigable via the Inspector's `caused by` link-walk. (Extension point: a depth-2 "lineage" mode would recurse `woven()` — deliberately not built.)
- **Arc geometry:** child anchor `cx = xOf(child.from)` at `yOf(child)−6`; source anchor `sx` = `cx` clamped into the parent weft's x-span at `yOf(parent)+4`; cubic with midpoint control pull, small lateral bow when `sx == cx` (pure vertical) so the arc reads as an arc.
- **Registry & lifecycle:** every arc pushed to `ARCS` as `{el, parent, child}`. `drawCausal()` always rebuilds from scratch (clear `gCause`, empty `ARCS`) — called at the end of `select()` (which every cursor-moving path funnels through) and after re-renders. `applyHighlight` syncs `cause-dim` from either endpoint's dimmed state. Queued runs / cursor `-1` → no arcs.

### 9.7 Playback engine

`applyNext(user)` weaves the next ACTIVE event (animated), applies side effects, selects it; returns `"gate"` when it lands on `gate:true` (loop pauses, gate bar opens, run state `gate`, amber pulsing dot). Gate buttons record the human decision: set `RUN.decision`, splice `ACTIVE = runActive(RUN)`, resume. `stepBack()` removes the newest event's elements, un-applies effects, decrements cursor, repairs state (`session_end` undone → `ready`), and **un-splices the tail** (clears `decision`) when crossing back over the gate. Speeds cycle `0.5× → 1× → 2× → 4×` (`SPEEDS=[0.5,1,2,4]`); base inter-event delay 340 ms / speed.

### 9.8 Keyboard map (exact, guarded to skip INPUT/SELECT targets)

| Key | Action |
|---|---|
| `Space` | Play / pause (ignored when focus is a button or switch) |
| `→` | Pause + step forward |
| `←` | Step back |
| `R` | Reset run |
| `]` / `[` | Next / previous run in this project |
| `Esc` | Close glossary → else clear layer filter |

A11y: gutters are `role="separator"` with arrow-key nudge (§12.6); switches are `role="switch"` with Space/Enter; `prefers-reduced-motion` kills weave/pulse/march animations and transitions.

---

## 10. Right rail

### 10.1 Inspector (the six questions, §1.1)

Cell map: **Who** (actor chip + `→ to`) · **What** (`action` + verdict badge: PASS green / FAIL red / BLOCKED amber / **IN FLIGHT** blue when verdict null) · **Where** (`target` mono + layer badge) · **When** (ts + dur + event id + run id) · **Why** (intent + rule chip *(glossable)* + `caused by <parent>` link) — plus conditional wide cells: **Justification** (accent-left panel), **LLM reasoning** (violet italic panel, `thought`), **How much** (in/out/cache trio + `model:` note). `caused by` selects the parent **only if already woven**. `xref` renders a memory-colored jump link; if the far event isn't woven yet, the caption explains "play run … further to reach it" instead of jumping. Selecting **never** yanks the active tab (preserved v3 invariant — keep the code comment).

### 10.2 Feed

Mono stream of woven events: `ts · actor action → to · tokens`. Fail actions red, blocked amber. Layer filter dims non-matching rows. Click selects. Autoscrolls to newest; count label `N events · run <id>`.

### 10.3 Tokens (the damage meter)

Aggregation per `from` actor over `ACTIVE[0..cursor]`: bars (in = accent, out = white sliver, min 1.5% visibility), sorted desc, hover tooltip = per-model breakdown lines (`no model · deterministic I/O` bucket for zero-model rows) **each with its $ cost**, plus footer: cache-reads bar (demo denominator 4M), total tokens, and the v4 **run cost line** (`approx. cost (rates table) · $x.xx`, `#meterusd`). Header odometer mirrors run total tokens.

---

## 11. Home page (the portfolio — locked decision f2)

### 11.1 Insight strip (4 cards)

Portfolio spend (sub-note: "example rates — edit in settings") · Total tokens · Runs by state (`c complete · h halted · r ready · q queued`) · Projects count + stages present. All computed live from data + RATES.

### 11.2 Project cards (the spec that drove f2)

Each card (button, hover-lifts, click opens): name · **SDLC stage badge** · description ("what the project is") · **$ spent** · **total tokens** · runs summary · events count · footer `last used <ts> · by <operator>` · `last opened` chip when `l9:lastproj` matches. Card order = PROJECTS order.

### 11.3 Agent-usage chart (hover = per-project breakdown)

Involvement counting: an event counts for a thread if it is `from` **or** `to`; file columns and the human are excluded (this chart answers "which *agents* are used most"). Aggregated across **all projects** up to each run's cursor. Bars in meter style; hover tooltip lists `project: n` lines per agent. Rows with zero activity don't render.

### 11.4 Governance citations

Two grouped counts, one panel: **rules** — token counts over every event's `trigger.rule` (R19 / R22 / DOP / pre-flight / lifecycle:*); **ADRs** — regex `ADR-\d{4}` over every `target`. Rows are glossable (click → glossary entry, §8.4). This answers "which ADR is used frequently" with receipts.

### 11.5 Patterns across projects (computed, honestly labeled)

Three cards, numbers first, editorial second:

1. **R19 gate outcomes** — counts of `decision · APPROVE` vs `decision · REJECT` events portfolio-wide ("every one recorded in update-bus").
2. **Institutional memory** — `lesson_promoted` count, `lesson_reinforced` count, cross-run `xref` reuse count.
3. **Failure classes** — `verdict:"fail"` count, projects affected, hottest layer/target.

Any interpretive sentence is prefixed **`reading (authored):`** — the demo's two failures genuinely rhyme (IPv6 zone-index forms; legacy span-link gaps — both input-format edge cases), and the panel may say so, but it must not pretend an algorithm found the theme. The panel's standing note: free-text theme discovery is an **LLM job for the cloud version** (backlog §18).

### 11.6 Top-level settings (collapsible `details`)

Contents, in order: viewer-prefs note (font/panels are global and drag/knob-controlled, not stored here) · **Providers & key vault** (§7 UI: passphrase set/unlock, per-provider enable checkboxes editing `DEFAULTS.providers`, masked keys, save/remove) · **Rates table** (§6.1, live-edit) · **Default policy** (default tier chains, `allocUSD`, `budgetTok` — the same editors the project pane uses, but writing DEFAULTS). Every edit persists immediately and re-renders dependent surfaces.

---

## 12. Presentation system

### 12.1 Design tokens (CSS custom properties)

| Token | Value / role |
|---|---|
| `--bg` `--panel` `--panel2` `--line` | Charcoal stack: page, cards, chrome, hairlines |
| `--text` | `#eef2f7` (bumped in v4) |
| `--muted` | `#98a3b2` (was `#8b95a4`) |
| `--faint` | `#7a8695` (was `#5b6673` at 2.9:1 — now ≥ 4.5:1 on panels) |
| `--accent` / `--accent-soft` | `#3b82f6` / translucent selection wash |
| `--warn` | Amber — governance (§1.4) |
| `--ok` / `--fail` | Green / red |
| `--c-human --c-sup --c-cs --c-hr --c-eac --c-critic --c-mem --c-rep --c-smith --c-llm --c-script --c-file` | Per-actor thread + weft colors |
| Stage badges | `stg-planning/design/development/testing/deployment/maintenance` tinted chips |

Identifiers, ids, paths, numbers: **mono** (`--mono`). Prose: `--sans`. No emoji anywhere.

### 12.2 Typography — two-part system (locked decision 4)

**Part 1 — one-time remap.** v3's px scale compressed and converted to rem: `new_px = 12 + (old_px − 9) × 0.6` at a 16px root, i.e. the tiny 9–10px mono sizes rise the most, larger sizes barely move. All ~68 declarations are rem; **zero px font sizes may exist** (QA-grepped, §17.5).

| old px | 9 | 10 | 10.5 | 11 | 11.5 | 12 | 12.5 | 13 | 14 | 22 |
|---|---|---|---|---|---|---|---|---|---|---|
| rem | .75 | .7875 | .80625 | .825 | .84375 | .8625 | .88125 | .9 | .9375 | 1.2375 |

**Part 2 — the knob.** Header `A− 16 A+`, range **14–20**, default 16, persisted `l9:fs`. `applyFS()` sets `html{font-size}`, recomputes `FSC` (§9.1) via `applyGeomScale()`, and triggers `rerenderWeave()` so the loom scales with the type instead of drifting out of alignment. The smoke harness pins this: 16→18 must scale `THREAD_W` 64→72 and re-render.

### 12.3 Contrast and legibility standards

Minimum 4.5:1 for any text that carries information (the v4 bumps exist for this). `--faint` is for *de-emphasis*, not for content a user must read to operate the product. Never encode meaning in color alone — verdicts also carry badges/text, halts carry the HALTED tag.

### 12.4 Scrollbars

Thin (9px), themed everywhere: transparent track, `#2a3440` thumb → `#3d4a5a` hover, 2px panel-colored border, `scrollbar-width: thin` for Firefox.

### 12.5 Motion

Weave draw = stroke-dash over `max(240,dur)/speed`; pulses for weaving/gate dots; marching gate band while waiting; 120–200 ms UI transitions. `prefers-reduced-motion` disables all of it (§9.8).

### 12.6 Adjustable panels (locked decision 1)

| Handle | Between | CSS var (on) | Clamp | Default |
|---|---|---|---|---|
| H1 | run rail ↔ stage | `--w-rail` (main) | 180–420 px | 236 |
| H2 | stage ↔ right rail | `--w-right` (main) | 300–560 px | 372 |
| H3 | right-rail panes ↔ feed | `--h-feed` (.rail) | 18–75 % | 34 % |

Behavior: pointer-event drag (capture), hover/drag accent line, **double-click resets** (clears stored value + inline style), keyboard: focus + arrows nudge (±16 px, H3 ±3 %). Persisted `l9:wrail / wright / hfeed`. Grid: `var(--w-rail) 6px minmax(0,1fr) 6px var(--w-right)`; breakpoints hide H1 at ≤1180 px and H1+H2 at ≤940 px (stacked layout).

---

## 13. State and persistence (`l9:` namespace)

| Key | Type | Scope | Written by |
|---|---|---|---|
| `l9:fs` | int (14–20) | global | font knob |
| `l9:wrail` `l9:wright` | px int | global | H1 / H2 drag |
| `l9:hfeed` | percent | global | H3 drag |
| `l9:defaults` | object | top level | Home settings (providers, chains, allocUSD, budgetTok, local) |
| `l9:rates` | object | top level | rates table |
| `l9:proj:<id>` | object | per project | override edits (§5.2) — **overrides only, never resolved values** |
| `l9:lastproj` | string/null | global | `openProject` |
| `l9:vsalt` `l9:vchk` `l9:vk:<provider>` | b64 / blobs | vault | §7 |

All access goes through the `store` wrapper (`get/set/del`, JSON, try/catch). **The app must run correctly with storage unavailable** (private mode, sandboxed preview): every `store.get` has a default, every write is fire-and-forget. Claude.ai artifact preview note: browser-storage APIs may be unavailable there — the wrapper is what makes that a non-event.

---

## 14. Code architecture map (single file)

### 14.1 File layout order

```
<style>   design tokens → chrome → grid+gutters → rail/stage/right-rail → v4 block
          (scrollbars, header ctls, causal, glossary, home, config UI)
<body>    header → #home shell → <main> (runrail | h1 | stage | h2 | rail(+h3)) →
          glossary overlay → tooltip → <script>
<script>  "use strict" → schema header comment → THREADS/T/KIND → R41 →
          R42_MAIN/R42_APPROVE/R42_REJECT → R_NETCAP_RUNS + run helpers → LAYERS →
          svg consts + applyGeomScale → renderStatic/drawWeft/markers/highlight →
          tooltip → gate → caption/inspector/feed/tokens → selectRun/select →
          playback (applyNext/stepBack/play/pause/reset) → KERNEL_RULES →
          tabs/controls/learn/speed → keydown → ═ v4 LAYER ═ → boot
```

### 14.2 v4 layer modules (in-file order; keep it — later modules call earlier ones)

`persistence (store)` → `project-2 demo data (R101, R102)` → `projects (PROJECTS, RUNS aliasing)` → `model catalog/rates/defaults (+cfgOf/saveProjCfg)` → `cost (evCost/runCostUSD/projCostUSD/projTokens/fmtUSD)` → `key vault` → `fallback resolution (effModel)` → `glossary (GLOSS/GL_ALIASES/resolveGloss/open/close + delegated clicks)` → `causal (causeMode/ARCS/arcPath/drawArc/drawCausal)` → `adjustable panels (initPanels)` → `font control (fsBase/applyFS/rerenderWeave)` → `guardrails v4 (renderGuardrails)` → `model policy editor (renderModelCfg)` → `home (renderInsights/ProjectCards/AgentChart/GovChart/Patterns/Settings/renderHome)` → `router (PROJECT/showHome/openProject/initProjectUI)` → boot: `applyFS(true); initPanels(); initProjectUI(); showHome();`

### 14.3 Surgical hooks into the v3 core (the complete list — if porting, these are the diffs)

1. `let gThreads,gWeft,gCause,gPulse` + `gCause` group + `<defs>` arrow markers in `renderStatic`.
2. Geometry consts `const → let` + `applyGeomScale()` (FSC).
3. `selectRun(id, thenSelectEvt, force)` — `force` bypasses the same-run early-return (font re-render path) — and records `PROJECT.lastRun`.
4. `select()` ends with `drawCausal()` (single funnel for arc redraws).
5. `applyHighlight()` syncs `cause-dim` over `ARCS`.
6. Inspector rule chip → `.glossable` with `data-gl`.
7. Gate `R19` icon → glossable.
8. v3 `LOCAL_RULES` + old `renderGuardrails` + its immediate call **deleted** (KERNEL_RULES kept; v4 renderer is called by the router, never at parse time — `PROJECT` doesn't exist yet).
9. `const RUNS=[…]` → `const R_NETCAP_RUNS=[…]`; global `let RUNS` assigned per project.
10. Keydown: glossary-Esc priority; INPUT/SELECT guard.
11. Tokens tab: `#meterusd` line + per-model $ in tooltips.
12. Rail foot label: session total → **project total**; session chip gets `id="sesschip"` (router-owned).
13. Version header comment → v4.

### 14.4 Invariants (violating any of these is a bug, not a style choice)

1. **One write path** (§2.3). No new mutation surfaces without an R19-shaped proposal flow.
2. Selecting an event never switches the right-rail tab.
3. `renderStatic` wipes the SVG — everything per-run (defs included) is recreated; never cache SVG nodes across runs.
4. Full re-render resets `T.smith.hidden = true` before replaying side effects (§9.4).
5. `RUNS` always aliases `PROJECT.runs`; `ACTIVE` always equals `runActive(RUN)` after any decision change.
6. `drawCausal` rebuilds from zero; `ARCS` never contains stale elements.
7. Event ids are immutable (§4.2); the validator (§17.2) is the gatekeeper.
8. `store` failures are silent and non-fatal.
9. No network calls, no CDN, no fonts fetched — the file is the product.
10. Scripted events keep their recorded models; policy edits never rewrite history (§6.4).

---

## 15. Demo dataset specification

### 15.1 Inventory

| Project | Run | Title | State | Events | Decision | Notes |
|---|---|---|---|---|---|---|
| netcap-redaction (testing · nick · prism-chat-07 · 2026-07-31 09:14) | 041 | Scrub device IDs from netcap logs | complete | 23 woven | approve (inline) | promotes the IPv6 zone-index lesson |
| | 042 | Add IPv6 scrubbing to redactor.mjs | **ready** | 30 main + approve/reject tails | *yours to make* | consumes 041's lesson (xref pair); the interactive R19 teaching run |
| | 043 | Awaiting your next prompt | queued | 0 | — | teaches the queued state |
| telemetry-ingest (development · m.osei · prism-chat-11 · 2026-07-29 16:41) | 101 | Parse OTLP resource attrs into ingest schema | complete | 19 | approve (inline) | specialist `schema-wright`; reads ADR-0051; haiku/sonnet/opus spread |
| | 102 | Backfill span links in legacy captures | **halted** | 12 | reject (pre-set) | dry-run FAIL (3,118 of 41,207 captures lack trace ids) → human rejects at R19 |

Portfolio totals: 2 projects · 5 runs · ~97 authored events incl. tails · 2 rhyming failures · 1 cross-run lesson pair.

### 15.2 Authoring rules (for any new events)

1. Every field in §4.2 present; `intent` always; `cap` always (second-person, teaching, honest, `<b>` sparingly).
2. `just` states the rule basis and *why it matters*, not a restatement of the action.
3. Parents earlier in ACTIVE order; ids sequential; timestamps monotonic.
4. Token realism: `in` grows across the run (context accumulation law); kernel/constitution reads carry heavy `cache`; embeddings tiny; deterministic I/O can be zero-model.
5. Every `f_ws` write is preceded by exactly one `write_attempt · BLOCKED` and a human `decision · *` (R19 is not optional, even in fiction).
6. `session_end · *` is always last; halted runs end amber, never red.
7. Failures should *teach*: give them a discoverable cause and, where apt, a lesson event — the patterns strip (§11.5) is fed by discipline here, not by luck.
8. Run the validator (§17.2) after any data edit. No exceptions.

---

## 16. Live wiring plan (post-demo)

```
const es = new EventSource('/events');      // Node 22 · localhost:4040
es.onmessage = m => ingest(JSON.parse(m.data));
```

`ingest(record)` responsibilities: (1) validate against Rule-22 v2 at the boundary — reject loudly, never render garbage; (2) route by project/session/run — creating runs on `task_submitted`; (3) append + weave live if the run is open at the head, else update rails/meters quietly; (4) `gate:true` records pause playback and open the gate bar; (5) human decision events arrive *from the runtime* (the buttons post a proposal; the runtime emits the recorded decision). The SSE aggregator (backlog #1) becomes **multi-project**: fan-in of N project streams plus a registry handshake that replaces the scripted `PROJECTS` array. Key custody moves server-side at this milestone (§7.3); the vault UI degrades to status display.

---

## 17. Validation & QA (all three gates, every change)

### 17.1 Syntax gate
Extract the `<script>` body → `node --check`. (v4 extracted script ≈ 133 KB, passes.)

### 17.2 Data validator (`validate.js`, vm-context)
Asserts over every run incl. tails: no dangling/forward `trigger.parent`; all mandatory fields present and non-empty; `from/to/cls/layer/verdict` values legal; ids well-formed and unique; xref targets exist. Current dataset: **valid** (netcap 3 runs, telemetry 2 runs, R101=19, R102=12, 042 reject tail checked).

### 17.3 Smoke harness (`smoke.js`, jsdom) — coverage checklist
Boot lands on Home · 2 project cards · agent chart rows · governance rows · portfolio spend > $0 · 3 pattern cards · open telemetry → run 101 auto-selected with 19 wefts + last event selected · 1 incoming arc on selection · run cost $ figure · session chip text · causality-all arc count · glossary: compound string resolves (DOP), live citations render, close works · font 16→18 rescales THREAD_W 64→72 with full re-render · netcap defaults to run 042 · fan-out case (evt-041-05: 1 in / 2 out) · kernel rows have **no switches** + 3 Propose buttons + amendment card drafts · local-rule override chip appears and resets · 4 tier rows + resolved-policy preview · stepBack removes a weft · Home round-trip.

**Status: 34 / 35 passing.** Open item: *"last-opened chip marks netcap"* — `.pcard .lastopen` not found after `showHome()` in jsdom. Suspects, in order: `l9:lastproj` write-then-read timing between `openProject` and `renderProjectCards`; selector/markup mismatch (chip is a `<span class="lastopen">` inside the `<button class="pcard">`); jsdom localStorage quirk. **This is the first task when the build resumes.**

### 17.4 Reference-implementation status (2026-07-31)
`/home/claude/l9/loom-observatory.html` — v4 complete through all 20 hooks; gates 17.1–17.2 green; 17.3 at 34/35. Not yet shipped to outputs pending the fix above.

### 17.5 Manual QA list
Zero `font-size:*px` (grep); drag feel + dblclick resets + keyboard nudge on all three handles; ≤1180 / ≤940 breakpoints; reduced-motion pass; Esc priority (glossary before filter); scrollbars themed in every scroll region; amber/red audit of any new surface.

---

## 18. Backlog (ordered)

1. **SSE aggregator — multi-project** (fan-in + project registry handshake) — was #1, scope grew with f2.
2. **Trace-schema v2 ADR** — codify §4.2 in the repo's ADR series.
3. **Mobile support** — pan/pinch weave, stacked shell, glossary as bottom sheet. v4 groundwork already in: pointer events, card grid, font knob.
4. **LLM-derived cross-project theme discovery** (cloud) — replaces the `reading (authored):` lines with generated, labeled analysis.
5. **Server-side key custody** at live wiring (§7.3).
6. **Multi-session per project** (D1 lifts).
7. Deploys / Compliance / Update-bus panels.
8. Cmd+K command palette.
9. Feed virtualization (needed at live event volumes).
10. Multiple concurrent specialist columns.
11. Per-tier spend attribution once live records carry tier tags.

---

## 19. Working conventions (§9 of the old handoff, preserved and binding)

1. **No assumptions.** Ambiguity → ask numbered clarifying questions with lettered options; build only after answers. Nick will answer what's load-bearing; explicitly-restated defaults he doesn't veto are approved.
2. **Answer keys must be fully self-contained** — never "the defaults above." (Learned mid-project, the hard way.)
3. **Verbose-but-explicit beats terse-but-implicit.** Tables > prose walls. Diagrams wherever structure exists. ARPG/WoW analogies land and are welcome when they genuinely map.
4. **Visual-first, pattern-first.** Nick reads structure fluently and long undifferentiated prose poorly. Front-load the shape, then the detail.
5. No emojis — in the product or in documents.
6. When passing data into Claude Code chats, use plain copyable text in fenced blocks, not attachments.
7. Review stance: **building inspector** — assess against this spec (the standard), don't describe. Findings categorized: critical gaps · structural risks · ambiguities · missing connective tissue · must-answer questions.

---

## 20. Decision log (this spec's provenance — do not relitigate silently)

| # | Decision | Rationale |
|---|---|---|
| 1 | All three panel handles (H1/H2/H3), persisted, dblclick reset | Inspector/feed pressure varies by task; comfort is per-viewer (global) |
| 2 | Causality: selected-by-default + all-mode toggle; in=solid/out=dashed; direct depth only | Signal without spaghetti; the Inspector already walks deep chains |
| 3 | Thin themed scrollbars everywhere | OS-default bars broke the instrument feel |
| 4 | Font remap-to-rem + 14–20 knob + contrast bumps; geometry scales with type | 9–10px mono failed legibility; scaling type without scaling the loom breaks alignment |
| 5 | Kernel rules: **no switches at all**; lock + Propose amendment; glossary everywhere | A rendered-but-inert switch teaches the wrong mental model; absence *is* the lesson |
| 6 / f2 | **Home = the portfolio** (rich cards + analytics). No third combined-dashboard view | Nick's correction: the combination he wanted was insight, not a merged weave |
| f1 | Config Model B: top-level defaults + per-project overrides; visual prefs never per-project | Mirrors kernel/local-rules layering; WoW account/character intuition |
| f4 | Top level owns catalog/keys/rates/default policy; projects own enabled providers, $, tier chains; ≥80% downshift, 100% halts non-critical; keyless providers skipped | Money and credentials are org-level; behavior is project-level |
| D1–D4 | One session/project (demo) · distinct second project · always land Home · header switcher | Approved by no-veto after full restatement |
| K1 | Editable example rates table pulled forward into v4 | Cards need $ (f2), $ needs rates; placeholders labeled honestly |
| K2 | Real WebCrypto vault now, server-side custody promised at live wiring | Honest demo > fake lock icon; the caveat ships in the UI copy |
| meta | The 1% not in this spec = verbatim demo narrative text; port from reference implementation | §0 |

---

*End of specification. Companion artifacts: `loom-observatory.html` (reference implementation), `validate.js`, `smoke.js`. This document supersedes `loom-observatory-handoff.md`.*
