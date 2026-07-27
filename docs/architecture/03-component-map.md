# IDEA — Component Map & Requirements Traceability

## A. Component → file/route → responsibility → depends on

| # | Component | Path (existing or planned) | Responsibility | Depends on | Phase |
|---|---|---|---|---|---|
| C-1 | Auth config | `auth.ts` | NextAuth GitHub provider, allowlist, JWT/session mapping | GitHub OAuth | 1 ✅ |
| C-2 | Auth route | `app/api/auth/[...nextauth]/route.ts` | NextAuth handlers | C-1 | 1 ✅ |
| C-3 | Middleware | `middleware.ts` | Gate protected routes/pages | C-1 | 1 ✅ |
| C-4 | GitHub lib | `lib/github.ts` | `authedOctokit()`, `unauthorized()` | C-1, Octokit | 1 ✅ |
| C-5 | Repos list | `app/api/repos/route.ts` | List user repos | C-4 | 1 ✅ |
| C-6 | Repo tree | `app/api/repos/tree/route.ts` | List a branch's blobs | C-4 | 1 ✅ |
| C-7 | Repo file | `app/api/repos/file/route.ts` | Fetch one file (≤512 KB) | C-4 | 1 ✅ |
| C-8 | Chat route | `app/api/chat/route.ts` | Stream model output; inject repo context | C-1, AI SDK, **C-12** | 1 ✅ → extend |
| C-9 | Chat workspace UI | `components/chat-workspace.tsx` | Chat + repo browser + (Phase 2) model picker | C-5..C-8, C-12 | 1 ✅ → extend |
| C-10 | Home / login | `app/page.tsx`, `app/login/` | Entry + sign-in | C-1 | 1 ✅ |
| C-11 | Model registry | `lib/registry.ts` + `config/models.json` | Declarative model list: id, provider, tier, cost weight | Zod | 2 |
| C-12 | Router | `lib/router.ts` | `scoreComplexity()`, `selectModel()` (deterministic) | C-11, C-13 | 2 |
| C-13 | Cost | `lib/cost.ts` | Weighted-cost math; budget cap check | C-11, Loom cfg | 2 |
| C-14 | Models API | `app/api/models/route.ts` | Serve registry + current selection | C-11 | 2 |
| C-15 | Local provider | `lib/providers/local.ts` | OpenAI-compatible adapter to user's endpoint | AI SDK | 2 |
| C-16 | Manifest | `lib/manifest.ts` | Parse `SKILL.md`/agent defs → portable manifest | Zod | 2 |
| C-17 | Agent loop | `lib/agent.ts` | Provider-agnostic tool-calling loop | AI SDK, C-16 | 2 |
| C-18 | Skills API | `app/api/skills/route.ts` | List/run skills; tool allowlist | C-16, C-17 | 2 |
| C-19 | Local control API | `app/api/local/*` | Proxy to local helper (HF search/install, discover) | C-15 | 2 |
| C-20 | Fit recommender | `lib/fit.ts` | size↔memory → too large / good fit / overkill | (pure) | 2 |
| C-21 | Project registry | `lib/projects.ts` + `config/projects.json` | Projects: name, dashboard URL, launch cmd | Zod | 2 |
| C-22 | Projects API | `app/api/projects/*` | Start/stop + proxy project dashboards | C-21 | 2 |
| C-23 | Project pane UI | `components/project-pane.tsx` | Embed/link a project dashboard (Loom :4040) | C-21, C-22 | 2 |
| C-24 | Local helper (external) | *user's machine* | Runs local models, HF ops, hardware report | — | 2 |

## B. Requirement → component traceability

| Requirement | Satisfied by |
|---|---|
| FR-1 Auth & allowlist | C-1, C-2, C-3, C-10 |
| FR-2 Repo pull | C-4, C-5, C-6, C-7, C-9 |
| FR-3 Chat | C-8, C-9 |
| FR-4 Model routing | C-11, C-12, C-13, C-14, C-8 (auto mode), C-9 (picker) |
| FR-5 Skills & agents | C-16, C-17, C-18 |
| FR-6 Local models | C-15, C-19, C-20, C-24 |
| FR-7 Projects & Observatory | C-21, C-22, C-23, + `06-loom-integration.md` |
| NFR-1 Determinism | C-12, C-13, C-16, C-20 (pure, tested) |
| NFR-2 Serverless-safe | C-19, C-22, C-24 (local work off-Vercel) |
| NFR-3 Provider-agnostic | C-8, C-15, C-17 (AI SDK uniform iface) |
| NFR-4 Fail-closed | C-1 (allowlist), C-13 (budget), C-18 (tool allowlist) |
| NFR-5 Observability | C-12/C-17 emit trace events → Loom Observatory |
| NFR-6 Secrets | env/secret store; C-4, C-15 read keys server-side only |

## C. Dependency direction (must not be violated)

```
UI ─▶ API routes ─▶ lib (pure) ─▶ providers/adapters
                       ▲
        registries (data: models.json / skills / projects.json)
```
- UI never imports provider SDKs directly — it calls API routes.
- API routes never embed business logic — they call `lib/`.
- `lib/` pure functions never import Next.js request objects.
- Local/project work never runs *in* a Vercel function — only proxied (C-19, C-22).
