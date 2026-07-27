# S-10 — Local provider adapter

**Phase:** 2 · **Workstream:** 3 Provider adapters · **Status:** Not started
**Component:** C-15 · **Traces to:** FR-6.1, AD-2, NFR-3, E-6.a
**Depends on:** S-04 · **Blocks:** nothing

## Goal

Let a user-supplied **OpenAI-compatible** endpoint (Ollama, llama.cpp server, LM Studio,
vLLM) appear in IDEA as just another model in the registry — same routing, same skills,
same chat surface as a cloud model. That's AD-2 paying off.

## Scope

- `lib/providers/local.ts` — build an AI SDK provider instance from a `ModelRecord`
  where `provider === "local"`, using its `endpoint`
- Default base URL from `IDEA_LOCAL_ENDPOINT`
- A `resolveModel(modelRecord)` seam so `/api/chat` picks cloud vs local from registry
  data alone, with no per-provider branching in the route
- Graceful failure when the endpoint is unreachable (it's on the user's machine and
  usually *not* reachable from a Vercel function — see below)

## Acceptance criteria

- [ ] A `provider: "local"` registry record is selectable and usable in manual mode
- [ ] The router treats local models identically to cloud models — tier and `costWeight`
      only (a local model's `costWeight` is plausibly `0`; make sure `0` doesn't break
      the cost ranking in S-07)
- [ ] Endpoint unreachable → a clear, actionable user-facing error, not a 500 stack trace
- [ ] `/api/chat` has no `if (provider === ...)` branching — resolution is table-driven (§C)
- [ ] Adding a second local endpoint requires only a `config/models.json` edit (NFR-3)

## Exceptions honored

- **E-6.a** IDEA never runs a local model itself. This adapter only *talks to* an
  endpoint the user runs. No spawning, no model loading, no weights.
- **NFR-6** If the endpoint needs a token, it comes from env server-side — never from
  the client, never embedded in a registry URL committed to git.

## Notes / open questions

- **Reality check:** a Vercel function **cannot reach the user's `127.0.0.1`**. A local
  model is usable when IDEA runs locally (`npm run dev`), or via a tunnel, or by having
  the browser talk to localhost directly. Pick one and document it:
  - **Local dev only** — simplest, honest, matches how S-19 process control already
    degrades on Vercel. Recommended for Phase 2.
  - **Browser-direct** — the page calls `127.0.0.1` itself, bypassing Vercel. Works
    deployed, but streaming and CORS get messy and the server never sees the tokens.
  This is the same serverless boundary as E-7.a. Solve it once, apply to both.
