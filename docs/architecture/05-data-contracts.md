# IDEA — Data Schema & Data Contracts

Contracts are expressed as **Zod** schemas (Zod 4 is already a dependency) so they
are simultaneously the validation code and the documentation. Route handlers should
`parse()` inputs and outputs against these.

## 1. Session (Phase 1 — shipped)

```ts
// Augmented NextAuth session (see auth.ts callbacks)
Session = {
  user?: { name?, email?, image? },
  accessToken?: string,   // GitHub token, server-side use only
  login?: string,         // GitHub login (allowlisted)
}
```
> **Contract:** `accessToken` is never sent to the browser in Phase 2 code paths that
> don't already expose it; treat it as server-only.

## 2. Repos API (Phase 1 — shipped)

```ts
// GET /api/repos
ReposResponse = z.object({
  repos: z.array(z.object({
    full_name: z.string(),
    private: z.boolean(),
    default_branch: z.string(),
    updated_at: z.string().nullable(),
  })),
});

// GET /api/repos/tree?owner&repo&branch?
TreeResponse = z.object({
  branch: z.string(),
  truncated: z.boolean(),
  files: z.array(z.object({ path: z.string(), size: z.number() })),
});

// GET /api/repos/file?owner&repo&path&branch?
FileResponse = z.object({
  path: z.string(),
  size: z.number(),
  content: z.string(),          // UTF-8, ≤ 512 KB (else 413)
});
```

## 3. Chat API (Phase 1 shipped; `mode`/`model` added in Phase 2)

```ts
// POST /api/chat  (request)
ChatRequest = z.object({
  messages: z.array(UIMessage),           // AI SDK UI messages
  context: z.string().optional(),         // concatenated repo files
  mode: z.enum(["manual", "auto"]).default("manual"), // Phase 2
  model: z.string().optional(),           // Phase 2, manual mode
});
// Response: AI SDK UI message stream (toUIMessageStreamResponse)
// Also emits a RoutingDecision header/event when mode="auto".
```

## 4. Model registry (Phase 2)  — `config/models.json`

```ts
Tier = z.enum(["light", "standard", "heavy"]);

ModelRecord = z.object({
  id: z.string(),                 // e.g. "claude-sonnet-4-5"
  provider: z.enum(["anthropic", "openai", "local", "google", "other"]),
  label: z.string(),
  tier: Tier,                     // capability tier
  costWeight: z.number().min(0),  // "monetary adjustment" — relative $ per token unit
  contextWindow: z.number().int().positive(),
  enabled: z.boolean().default(true),
  endpoint: z.string().url().optional(), // for provider="local"
});

ModelsResponse = z.object({
  models: z.array(ModelRecord),
  defaultId: z.string(),
});
```

## 5. Routing decision (Phase 2)

```ts
ComplexitySignals = z.object({
  tokens: z.number().int(),
  codeFences: z.number().int(),
  fileCount: z.number().int(),
  reasoningKeywords: z.number().int(),
  needsTools: z.boolean(),
});

RoutingDecision = z.object({
  mode: z.enum(["manual", "auto"]),
  chosenModelId: z.string(),
  requiredTier: Tier,
  score: z.number(),              // deterministic complexity score
  signals: ComplexitySignals,
  estCostUnits: z.number(),       // costWeight * est tokens
  budgetRemaining: z.number().nullable(),
  degraded: z.boolean(),          // true if budget forced a cheaper model
  reason: z.string(),             // human-readable explanation
});
```

## 6. Skill / agent manifest (Phase 2)

```ts
SkillManifest = z.object({
  name: z.string(),
  description: z.string(),
  system: z.string(),                    // system prompt body from SKILL.md
  tools: z.array(z.string()).default([]),// names, must be in server tool allowlist
  modelPolicy: z.object({
    mode: z.enum(["manual", "auto"]).default("auto"),
    preferredTier: Tier.optional(),
    pinnedModelId: z.string().optional(),
  }).default({ mode: "auto" }),
  source: z.string(),                    // path/URL of SKILL.md
});

AgentDefinition = SkillManifest.extend({
  maxSteps: z.number().int().positive().default(12),
});

ToolTraceEvent = z.object({
  ts: z.string(),                        // ISO (server-stamped)
  skill: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  ok: z.boolean(),
  result_summary: z.string(),
});
```

## 7. Local models (Phase 2)  — helper contracts

```ts
HardwareReport = z.object({
  ramGB: z.number(),
  vramGB: z.number().nullable(),         // null if no discrete GPU reported
  source: z.enum(["helper", "user"]),    // never server-auto-detected
});

LocalModelInfo = z.object({
  id: z.string(),                        // HF repo id or local path
  paramsB: z.number().nullable(),        // billions of params if known
  quant: z.string().nullable(),          // e.g. "Q4_K_M", "fp16"
  sizeGB: z.number(),                    // on-disk / estimated load size
  location: z.enum(["hf-cache", "path", "endpoint"]),
});

FitVerdict = z.enum(["too_large", "good_fit", "overkill"]);
FitResult = z.object({
  model: LocalModelInfo,
  hardware: HardwareReport,
  verdict: FitVerdict,
  headroomGB: z.number(),                // memory - required
  note: z.string(),
});
```

**Fit rule (deterministic, `lib/fit.ts`):** let `mem = vramGB ?? ramGB`,
`need = sizeGB * 1.2` (runtime overhead). `verdict = need > mem ? "too_large"
: mem >= need * 2.5 ? "overkill" : "good_fit"`. (Thresholds tunable; keep pure + tested.)

## 8. Project registry (Phase 2)  — `config/projects.json`

```ts
ProjectRecord = z.object({
  name: z.string(),                      // "loom"
  title: z.string(),                     // "Loom Observatory"
  root: z.string(),                      // "projects/loom" (git-ignored)
  launch: z.string(),                    // "node observatory/server.mjs"
  dashboardUrl: z.string().url(),        // "http://127.0.0.1:4040"
  configPath: z.string().optional(),     // "config.yaml" (for cost seeding)
  autostart: z.boolean().default(false),
});

ProjectsResponse = z.object({ projects: z.array(ProjectRecord) });
ProjectStatus = z.object({
  name: z.string(),
  running: z.boolean(),
  pid: z.number().nullable(),
  dashboardUrl: z.string().url(),
});
```

## 9. Config / env contract

| Key | Purpose | Phase |
|---|---|---|
| `AUTH_SECRET` | NextAuth session secret | 1 |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth app | 1 |
| `ALLOWED_LOGINS` | Comma-separated allowlist (fail closed) | 1 |
| `ANTHROPIC_API_KEY` | Claude provider | 1 |
| `IDEA_CHAT_MODEL` | Default chat model id | 1 |
| `IDEA_LOCAL_ENDPOINT` | Default local OpenAI-compatible base URL | 2 |
| `IDEA_HELPER_TOKEN` | Per-session token for local helper/proxy | 2 |
| `HF_TOKEN` | Hugging Face (helper-side; not on Vercel) | 2 |
