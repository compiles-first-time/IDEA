# S-16 — Local companion contract & protocol

> # ❌ Won't do — the companion no longer exists
>
> **Superseded by [08-local-first.md](../architecture/08-local-first.md) (2026-07-27).**
>
> IDEA now runs on the user's own machine. The companion existed for exactly one
> reason: a Vercel-hosted app cannot reach `127.0.0.1`. Removing that constraint
> removes the entire component — its protocol, its `IDEA_HELPER_TOKEN`, its Host
> allowlist, its polling, and the transport question that blocked five other stories.
> Everything it was going to do is now ordinary server-side code in the app.
>
> **Kept for the reasoning**, not to build. Two things in it still matter and have
> moved: the `HardwareReport` / `LocalModelInfo` shapes live in
> [`lib/fit.ts`](../../lib/fit.ts), and binding to `127.0.0.1` by default is now
> IDEA's own behavior (FR-10.3).
>
> *Original content below.*
>
> ---

**Phase:** **0** · **Workstream:** 5 Local models / 8 Provisioning · **Status:** Not started
**Component:** C-24 (external — runs on the user's machine) · **Traces to:** FR-6.2, FR-6.3, FR-8.4, E-6.a, E-6.b, E-8.a, AD-1
**Depends on:** S-02 · **Blocks:** S-17, **S-29**, S-30, S-31

## Goal

IDEA on Vercel can't search Hugging Face on the user's behalf, download weights, read
the HF cache, or know how much RAM the machine has. A **small local helper the user
runs** does all of that. This story defines the contract between them — and builds it.

This is AD-1 made concrete: control plane on Vercel, data plane on the user's machine.

## Scope

**The contract** (document in `docs/architecture/` or alongside the helper):

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /health` | liveness + version | `{ ok, version }` |
| `GET /hardware` | reported memory | `HardwareReport` |
| `GET /models` | discovered local models | `LocalModelInfo[]` |
| `GET /hf/search?q=` | HF model search | search results |
| `POST /hf/install` | download a model | job/progress |

Shapes per `05-data-contracts.md` §7:

```ts
HardwareReport  = { ramGB, vramGB: number|null, source: "helper"|"user" }
LocalModelInfo  = { id, paramsB: number|null, quant: string|null, sizeGB,
                    location: "hf-cache"|"path"|"endpoint" }
```

**The helper itself:** a small Node CLI binding `127.0.0.1`, requiring
`IDEA_HELPER_TOKEN` on every request, with a Host header allowlist — mirroring the
Loom/ripple security pattern (§6).

## Acceptance criteria

- [ ] Contract documented with request/response shapes for every endpoint
- [ ] Helper binds **`127.0.0.1` only** — never `0.0.0.0`
- [ ] Every endpoint requires a valid `IDEA_HELPER_TOKEN`; missing/wrong → 401
- [ ] Host header allowlist enforced (DNS-rebinding defense)
- [ ] `HardwareReport.source` is always `"helper"` when the helper reports it
- [ ] `GET /models` discovers both the default HF cache and user-specified paths (FR-6.3)
- [ ] `HF_TOKEN` is read **helper-side only** and never sent to IDEA (§9 env contract)
- [ ] Helper runs standalone and is documented well enough for the user to start it

## Exceptions honored

- **E-6.a** All local and HF work happens here, never in a Vercel function.
- **E-6.b** Hardware facts come from the helper or the user — the *server* never
  auto-detects. The helper reading its own machine's specs is fine and expected;
  that's the point of the boundary.
- **NFR-6** `HF_TOKEN` stays on the user's machine. It is explicitly **not** a Vercel env var.

## Notes / open questions

- **Open: where does the companion's code live?** Options: a `companion/` directory in
  the IDEA repo (shipped together, versioned together — recommended, and now that it's
  load-bearing the version-coupling argument is stronger), a separate repo, or a
  subcommand of an existing local tool. Decide before writing it.
- **Open — and now the single most important unresolved question: how does a
  Vercel-hosted IDEA reach a `127.0.0.1` companion?** It cannot, directly. Options:
  browser-mediated calls (the page talks to localhost, Vercel never does), a tunnel, or
  accepting that companion-backed features are local/self-hosted only. **This one
  decision governs S-10, S-17, S-29, S-30, and S-31** — solve it once, here, before
  building any of them.
- The provisioning endpoints live in [S-29](S-29-provisioning-engine.md); this story
  covers the base contract, transport, and security they all share.
