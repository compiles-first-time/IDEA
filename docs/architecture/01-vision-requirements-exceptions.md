# IDEA — Vision, Requirements & Exceptions

> Format mirrors the author's "requirements and exceptions" convention:
> numbered, testable **requirements** paired with explicit **exceptions**
> (out-of-scope carve-outs and boundary conditions) so scope can't quietly creep.

## Vision

IDEA is a **gated cloud web app** (hosted on Vercel) that acts as a
**provider-agnostic multi-LLM chat and agent console**. A signed-in user can:

- Chat with any configured model (Claude first; other providers pluggable).
- Pull a GitHub repo's files into the conversation as context.
- Let IDEA **route automatically** to a cost-appropriate model based on prompt
  complexity, or pick a model manually.
- Run **portable skills/agents** (Loom-style `SKILL.md` + agent definitions) on
  whichever model is selected.
- Manage **local models** (via a user-controlled endpoint) alongside cloud models.
- Open **projects** — self-contained workspaces that can spin up their own local
  dashboards. **Loom's Observatory (`:4040`) is the first project.**

**Why it exists:** one authenticated surface to work across LLMs and repos, with
deterministic cost/complexity routing and reusable, provider-independent skills —
instead of being locked to a single vendor's app.

**Success looks like:** the author signs in, opens the Loom project, chats about a
pulled repo, and IDEA routes each turn to the right model at a predictable cost —
with skills/agents portable across providers.

---

## Functional requirements

### FR-1 Authentication & access control  *(Phase 1 — shipped)*
- **FR-1.1** Sign-in via GitHub OAuth only.
- **FR-1.2** Access restricted to an allowlist (`ALLOWED_LOGINS`, comma-separated).
- **FR-1.3** Fail closed: an empty/unset allowlist admits nobody.
- **FR-1.4** The session carries the GitHub `accessToken` and `login` for repo calls.
- **Exception E-1.a** No password, magic-link, or non-GitHub identity providers.
- **Exception E-1.b** No org/team-based auto-allow; membership is an explicit login list.
- **Exception E-1.c** No role hierarchy in Phase 1/2 — every allowed user is a full user.

### FR-2 Repo pull as context  *(Phase 1 — shipped)*
- **FR-2.1** List the signed-in user's repos (most-recently-updated first).
- **FR-2.2** List a repo's file tree for a branch (default branch if unspecified).
- **FR-2.3** Fetch a single file's UTF-8 content, capped at 512 KB.
- **FR-2.4** Selected files are injected into the chat system prompt as context.
- **Exception E-2.a** No local `git clone` — GitHub REST API only (serverless-safe).
- **Exception E-2.b** No binary files, no files > 512 KB pulled into context.
- **Exception E-2.c** No write-back to repos (no commits/PRs) from IDEA in Phase 1/2.

### FR-3 Chat  *(Phase 1 — shipped)*
- **FR-3.1** Streaming responses via the Vercel AI SDK UI message stream.
- **FR-3.2** Auth-gated: unauthenticated `POST /api/chat` returns 401.
- **FR-3.3** Default model configurable via `IDEA_CHAT_MODEL`.
- **Exception E-3.a** No server-side chat persistence in Phase 1 (client-held history).

### FR-4 Model routing  *(Phase 2)*
- **FR-4.1** Manual mode: user selects a model from the registry; that model is used.
- **FR-4.2** Auto mode: a **deterministic** scorer estimates prompt complexity and
  selects the cheapest model whose capability tier meets the estimate.
- **FR-4.3** Each model has a **cost weight / "monetary adjustment"** in the registry;
  routing minimizes weighted cost subject to the capability floor.
- **FR-4.4** Every routed turn records a **routing decision** (model, tier, score,
  reason) surfaced to the user and available to the Observatory.
- **FR-4.5** Cost rates seed from the Loom Observatory `config.yaml` where available.
- **Exception E-4.a** No trained ML classifier in Phase 2 — heuristics/rules only.
- **Exception E-4.b** Auto mode never silently exceeds a per-session budget cap; it
  degrades to the cheapest capable model and warns.

### FR-5 Portable skills & agents  *(Phase 2)*
- **FR-5.1** A skill is a `SKILL.md` (+ optional tools) parsed into a portable manifest.
- **FR-5.2** An agent is a definition (system prompt, allowed tools, model policy)
  runnable through a provider-agnostic agent loop.
- **FR-5.3** Skills/agents run against **any** configured provider via AI SDK tool-calling.
- **FR-5.4** Tool calls are logged as trace events (provenance, Rule-22 style).
- **Exception E-5.a** No arbitrary shell/filesystem tools exposed to models on Vercel;
  tools are an explicit, reviewed allowlist.
- **Exception E-5.b** Skills are declarative + tool-bound; no eval of untrusted code.

### FR-6 Local models  *(Phase 2)*
- **FR-6.1** Register a **local endpoint** (OpenAI-compatible base URL) as a provider.
- **FR-6.2** Hugging Face model **search** and **install** (to the user's machine).
- **FR-6.3** Discover installed models by local path or default HF cache.
- **FR-6.4** A deterministic **fit recommender**: given model size (params/quant) and
  reported RAM/VRAM, classify **too large / good fit / overkill**.
- **Exception E-6.a** IDEA (on Vercel) **never** runs a local model itself. FR-6.1–6.4
  execute on a machine the user controls (local agent/CLI or the browser talking to
  `localhost`). Vercel only stores config and displays results.
- **Exception E-6.b** No automatic hardware detection on the server — hardware facts
  are user-provided or reported by a local helper the user runs.

### FR-7 Projects & Observatory  *(Phase 2)*
- **FR-7.1** IDEA hosts **projects**; each project may expose a local dashboard URL.
- **FR-7.2** **Loom** is project #1: launch `node observatory/server.mjs`, surface
  `http://127.0.0.1:4040` as a project pane.
- **FR-7.3** IDEA reads Loom's `config.yaml` (Models & Budget / `cost_rates`).
- **FR-7.4** IDEA can start/stop a project's local dashboard process.
- **Exception E-7.a** Project dashboards are **local** (127.0.0.1); Vercel does not host
  them. IDEA links/proxies to a locally-running instance.
- **Exception E-7.b** Vendored project source (e.g. `projects/loom`) is git-ignored,
  never committed into IDEA.

---

## Non-functional requirements

- **NFR-1 Determinism first.** Routing, cost math, fit classification, and manifest
  parsing are plain code with unit tests — not model calls.
- **NFR-2 Serverless-safe.** No process/filesystem assumptions in Vercel routes;
  anything stateful/local runs out-of-process.
- **NFR-3 Provider-agnostic.** No route hard-codes a single vendor beyond a default;
  swapping providers is config, not rewrites.
- **NFR-4 Fail-closed security.** Auth allowlist, tool allowlist, budget caps all
  default to the safe/denied state.
- **NFR-5 Observability.** Routing decisions and tool calls emit trace events with
  provenance, consumable by the Observatory.
- **NFR-6 Secrets discipline.** Provider keys via env/secret store only; never in
  client bundles, chat input, or tool args.

## Global exceptions (whole product)

- **GE-1** Not a hosting platform for local inference — Vercel is control-plane + cloud
  models; local inference is always the user's own runtime.
- **GE-2** No multi-tenant billing/orgs in Phase 1/2 — single-author allowlist.
- **GE-3** No mobile-native app — responsive web only.
- **GE-4** No repo write operations (commits/PRs/issues) in Phase 1/2.
