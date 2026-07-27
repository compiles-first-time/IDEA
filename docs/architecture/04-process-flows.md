# IDEA — Process Maps & Flows

## PF-1 Authentication (Phase 1 — shipped)

```mermaid
sequenceDiagram
  participant U as User
  participant I as IDEA (/login)
  participant G as GitHub OAuth
  U->>I: Click "Sign in with GitHub"
  I->>G: Authorize (scope: read:user user:email repo)
  G-->>I: code → access_token + profile.login
  I->>I: signIn(): allowed.length>0 && allowed.includes(login)?
  alt login in ALLOWED_LOGINS
    I->>I: jwt: store accessToken + login
    I-->>U: Session established → app
  else not allowed / empty allowlist
    I-->>U: Denied (fail closed)
  end
```

## PF-2 Repo pull → context (Phase 1 — shipped)

```mermaid
sequenceDiagram
  participant U as User
  participant W as Chat workspace
  participant R as /api/repos*
  participant O as Octokit (GitHub)
  U->>W: Open repo browser
  W->>R: GET /api/repos
  R->>O: listForAuthenticatedUser(sort=updated)
  O-->>W: repos[]
  U->>W: Pick repo/branch
  W->>R: GET /api/repos/tree?owner&repo&branch
  R->>O: getRef → getTree(recursive)
  O-->>W: files[] (blobs, size)
  U->>W: Select file(s)
  W->>R: GET /api/repos/file?owner&repo&path&branch
  R->>O: getContent (≤512KB else 413)
  O-->>W: {path, content}
  W->>W: Concatenate selected files → context string
```

## PF-3 Chat turn (Phase 1 shipped; Phase 2 adds routing)

```mermaid
flowchart TD
  A[User sends message + optional context + mode] --> B{auth session?}
  B -- no --> B401[401 Unauthorized]
  B -- yes --> C{mode?}
  C -- manual --> D[model = user selection]
  C -- auto --> E[scoreComplexity: message + context]
  E --> F[selectModel: cheapest tier ≥ score, min weighted cost, within budget]
  D --> G[streamText model, system+context, messages]
  F --> G
  G --> H[UI message stream to client]
  F --> R[(record routing decision)]
```

## PF-4 Automatic model routing (Phase 2, deterministic)

```mermaid
flowchart LR
  In[prompt + context] --> S1[signals:<br/>token length, code fences,<br/>#files, imperative verbs,<br/>reasoning keywords, tool need]
  S1 --> Sc[score = weighted sum → tier: light | standard | heavy]
  Sc --> Cand[candidate models where model.tier >= required tier]
  Cand --> Cost[rank by cost_weight * est_tokens]
  Cost --> Cap{within session budget?}
  Cap -- yes --> Pick[pick cheapest]
  Cap -- no --> Deg[degrade to cheapest capable + warn]
  Pick --> Dec[emit RoutingDecision]
  Deg --> Dec
```
*All steps are pure functions (`lib/router.ts`, `lib/cost.ts`) — unit-tested, no model call.*

## PF-5 Skill / agent execution (Phase 2)

```mermaid
sequenceDiagram
  participant U as User
  participant S as /api/skills
  participant M as manifest.ts
  participant L as agent loop
  participant P as provider (AI SDK)
  U->>S: Run skill X with input
  S->>M: parse SKILL.md → manifest (system, tools[], model policy)
  S->>L: start loop (model per policy/router)
  loop until stop
    L->>P: generate (messages, tools=allowlisted)
    P-->>L: text or tool_call
    alt tool_call
      L->>L: validate tool ∈ allowlist → run tool → observation
      L->>L: emit trace event (tool, args, result)
    else final
      L-->>U: result
    end
  end
```

## PF-6 Local model registration & fit (Phase 2)

```mermaid
sequenceDiagram
  participant U as User
  participant I as IDEA (/api/local/*)
  participant H as Local helper (user machine)
  participant HF as Hugging Face
  U->>I: Add local endpoint (base URL) OR search HF
  I->>H: proxy: search/install/discover/hardware
  H->>HF: search / download (install-side)
  H-->>I: models[], hardware{ram,vram}
  I->>I: fit.ts: classify(size, memory) → too large|good fit|overkill
  I-->>U: recommendation + register model in registry
```
*IDEA on Vercel only proxies + classifies; the helper does all local/HF work (E-6.a/E-6.b).*

## PF-7 Project registration — Loom Observatory (Phase 2)

```mermaid
sequenceDiagram
  participant U as User
  participant I as IDEA (/api/projects/*)
  participant P as project process (local)
  participant L as Loom Observatory
  U->>I: Open "loom" project
  I->>I: read config/projects.json → {launch, dashboardUrl}
  I->>P: start: node observatory/server.mjs (cwd projects/loom)
  P->>L: bind 127.0.0.1:4040
  I->>L: read config.yaml (cost_rates / Models & Budget) → seed cost.ts
  I-->>U: project pane linking/proxying http://127.0.0.1:4040
  U->>I: Close project → stop process
```
