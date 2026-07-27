# S-11 — Skill manifest parser

**Phase:** 2 · **Workstream:** 4 Skills & agents · **Status:** ✅ **Done** (2026-07-27)
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

---

## Outcome (2026-07-27)

`lib/manifest.ts`, 19 tests — including one that parses **every real `SKILL.md` in
`loom-template`**.

### Loom's skills come in two shapes, and only one has frontmatter

Surveying the real files found something the story assumed away:

| Shape | Count | Example |
|---|---|---|
| YAML frontmatter (`name`, `summary`, `tools`, `context_budget`, `credential_scope`, `verifier_type`) | 14 | `agents/specialists/_registry/auth/SKILL.md` |
| **No frontmatter at all** — `# H1` plus a `> **Role:**` blockquote | 6 | `agents/critic/SKILL.md` |

A parser that required frontmatter would have silently dropped every base agent — the
Critic, Constitution Service, Memory-Keeper, HR, EAC, Human-Replica. Those are the ones
that matter most.

So the parser handles both: name falls back to the containing directory, description
falls back to the `Role:` blockquote and then the first paragraph, and `inferred: true`
tells callers which fields were guessed rather than declared.

### Fields preserved for the Critic

`credential_scope` (LR-07 scope-at-each-hop auditing), `context_budget` (ADR-0004),
`tier`, and `verifier_type` are carried through rather than dropped, so Loom's own audit
tooling still has what it needs.

### Tool names are carried, not judged

A manifest naming `rm_rf_everything` parses cleanly. Refusal happens at execution in
`lib/permissions.ts`, so the error a user sees is "tool not allowed" rather than the
misleading "parse failed".

### Added `yaml` as a dependency

Needed here and by S-22 (Loom's `observatory/config.yaml` has nested maps). One
well-maintained parser beats two hand-rolled ones.
