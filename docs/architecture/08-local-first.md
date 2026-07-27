# IDEA — Local-First (supersedes the serverless split)

> **Status:** Adopted 2026-07-27. Supersedes parts of `02`, `06`, and `07`.
> Where this document and any earlier file disagree, **this document wins.**

IDEA runs **on the user's own machine**, served to their browser, and is distributed
as a one-command package. It is no longer a Vercel-hosted control plane.

```
Before:  browser → Vercel (control plane) → HTTP → local companion → git/npm/processes
After:   browser → IDEA on localhost ────────────────────────────→ git/npm/processes
```

## Why

The Vercel constraint was being designed around six separate times: no repo clone, no
Observatory, no local models, a read-only filesystem, function timeouts capping agent
runs, and spend tracking with nowhere to write. The **local companion (C-24) existed
purely to work around a limitation we were choosing on purpose.** Removing the
limitation removes the workaround.

It remains a web app — same Next.js code, same browser UI, same GitHub sign-in. Only the
place it is served from changed.

## What we gave up

Access from a phone or a second device. Conversations are still committed to each
project's GitHub repo, so they remain readable there.

---

## 1. Superseded and amended decisions

| Ref | Was | Now |
|---|---|---|
| **AD-1** Serverless control plane, local data plane | The defining split | **Superseded.** One process. There is no control/data plane boundary. |
| **C-24 / S-16** Local companion | Phase-0, load-bearing | **Deleted.** Its work is ordinary server-side code in the app. |
| **E-2.a** No local `git clone` — REST API only | Absolute | **Lifted.** Cloning is a normal server-side operation. The REST API remains right for reading repo *context* (no checkout needed) and for the conversation store. |
| **NFR-2** Serverless-safe: no process or filesystem assumptions | Applied to every route | **Superseded.** Routes may read and write the filesystem and spawn processes. |
| **E-6.a** IDEA never runs a local model itself | Absolute | **Narrowed.** IDEA still does not host inference in-process — it talks to an OpenAI-compatible endpoint — but it may now start, stop, and manage that endpoint. |
| **E-7.a** Dashboards are local; Vercel only links | Workaround | **Simplified.** The Observatory is on the same host; embedding and proxying are now trivial and mixed-content is no longer an issue. |
| **E-8.a** IDEA never clones, installs, or spawns | Absolute | **Superseded.** Provisioning runs in the app. |
| **§6** Local endpoints bound to `127.0.0.1` behind a token | Cross-process security | **Retained and still important.** IDEA itself now binds `127.0.0.1` by default. |

**Unchanged and still binding:** the fail-closed auth allowlist (**FR-1.3**), the tool
allowlist (**E-5.a**), no eval of untrusted code (**E-5.b**), the narrowed repo-write
carve-outs (**GE-4**), SHA pinning (**FR-9.4**), redaction before persistence (**E-9.c**),
and determinism-first (**NFR-1**).

> ⚠️ **Losing the sandbox raises the stakes on the tool allowlist.** On Vercel, a
> prompt-injection attack that reached a tool was bounded by a read-only serverless
> function. It is now bounded only by **E-5.a**. Model-invoked tools still get no
> filesystem access, no shell, and no repo writes — and that rule is now the *primary*
> protection rather than a secondary one.

## 2. FR-10 Distribution *(new)*

- **FR-10.1** IDEA is distributed as a package run with a single command; a browser opens
  to the local instance.
- **FR-10.2** One codebase serves Windows, macOS, and Linux — no per-platform build.
- **FR-10.3** The server binds **`127.0.0.1` by default**, so it is not reachable from
  the local network without an explicit opt-in.
- **FR-10.4** First run detects missing configuration and prints actionable setup steps
  rather than failing with a stack trace.
- **Exception E-10.a** No native executable, no code signing, no auto-updater. Those cost
  three platform builds, an annual certificate, and an update mechanism, and buy nothing
  for a developer audience.
- **Exception E-10.b** No public network binding by default. Serving IDEA to a LAN or the
  internet is the user's explicit choice, never a default.

## 3. Amended component map

| # | Component | Status |
|---|---|---|
| C-24 | Local companion | **Deleted** |
| C-30 | Provisioning engine | Moves in-process: `lib/provision.ts` |
| C-19 | Local control API | Simplified — no proxy hop |
| C-37 | **CLI entrypoint** (`bin/idea.mjs`) | New |

## 4. Dependency direction (simplified)

```
UI ─▶ API routes ─▶ lib (pure) ─▶ adapters ─▶ git · npm · processes · providers
```

The rules that survive: UI never imports provider SDKs, routes hold no business logic,
and `lib/` pure functions never import Next.js request objects. The rule that goes away
is "routes never touch the filesystem" — that was a hosting constraint, not a design one.

## 5. Story impact

| Story | Change |
|---|---|
| [S-16](../stories/S-16-local-helper-contract.md) | **Won't do** — the companion no longer exists |
| [S-29](../stories/S-29-provisioning-engine.md) | In-process; no worker, no polling, no token |
| [S-30](../stories/S-30-project-creation-from-template.md) | Unblocked; clone locally after creating the repo |
| [S-31](../stories/S-31-projects-page.md) | Unblocked; no "companion not running" state |
| [S-10](../stories/S-10-local-provider-adapter.md) | Unblocked; reach `127.0.0.1` directly |
| [S-17](../stories/S-17-local-control-api.md) | Simplified; direct calls, and config writes now work |
| [S-19](../stories/S-19-projects-process-api.md) | Restored — routes may spawn again |
| [S-13](../stories/S-13-agent-loop.md) | Function-timeout constraint gone |
| [S-07](../stories/S-07-cost-and-budget.md), [S-34](../stories/S-34-spend-ledger-and-allocation.md) | A local ledger file is now an option alongside the archive |
| [S-20](../stories/S-20-dashboard-proxy.md) | Reconsider — same-origin embedding is now cheap and safe |

Nothing already built is discarded. The router, conversation format, render adapters,
redaction, compaction, and ledger are plain functions that never cared where they ran.
