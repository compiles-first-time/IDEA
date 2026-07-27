# S-11 — Skill manifest parser

**Phase:** 2 · **Workstream:** 4 Skills & agents · **Status:** Not started
**Component:** C-16 · **Traces to:** FR-5.1, FR-5.2, E-5.b, NFR-1, AD-4
**Depends on:** S-02 · **Blocks:** S-13

## Goal

Turn a Loom-style `SKILL.md` into a validated, portable manifest — the thing that makes
skills provider-independent. Pure parsing, unit-tested, no model calls.

## Scope

`lib/manifest.ts`:

```ts
SkillManifest = z.object({
  name: z.string(),
  description: z.string(),
  system: z.string(),                        // system prompt body from SKILL.md
  tools: z.array(z.string()).default([]),    // names, must be in the server allowlist
  modelPolicy: z.object({
    mode: z.enum(["manual","auto"]).default("auto"),
    preferredTier: Tier.optional(),
    pinnedModelId: z.string().optional(),
  }).default({ mode: "auto" }),
  source: z.string(),                        // path/URL of SKILL.md
});

AgentDefinition = SkillManifest.extend({
  maxSteps: z.number().int().positive().default(12),
});
```

- `parseSkillMd(raw, source) → SkillManifest` — frontmatter (name, description, tools,
  model policy) + markdown body as `system`
- Clear, located errors on malformed input

## Acceptance criteria

- [ ] Parses a real Loom `SKILL.md` from `projects/loom` (grab one after S-22)
- [ ] Missing frontmatter, bad YAML, or unknown fields produce a **useful** error naming
      the file and the problem — not a `TypeError`
- [ ] Defaults applied correctly: no `tools` → `[]`, no `modelPolicy` → `{ mode: "auto" }`
- [ ] Pure — no fs reads inside the parser. Callers pass in the raw string.
- [ ] Unit tests: minimal valid skill, full skill, each malformed case
- [ ] Round-trips: parse → validate → serialize without loss

## Exceptions honored

- **E-5.b** Skills are **declarative and tool-bound**. The parser produces data; it never
  evaluates code from a `SKILL.md`. No `eval`, no dynamic `import()` of skill content.
- **NFR-1** Pure and tested.

## Notes

- `tools` here are just **names**. Validating them against the real allowlist is S-12's
  job, enforced at run time in S-13 — a manifest naming a forbidden tool must parse
  fine and then be **refused at execution**, so we get a clear "tool not allowed" error
  instead of a confusing parse failure.
