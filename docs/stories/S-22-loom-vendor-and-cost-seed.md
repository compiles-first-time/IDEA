# S-22 — Vendor Loom & seed cost rates

> **Scope narrowed.** Since the projects model changed (each project is now a fresh clone
> of `loom-template` that becomes its own repo — see
> [07-amendments.md](../architecture/07-amendments.md)), this story is no longer "vendor
> Loom as project #1." **It is now purely the cost-seeding story.** General project
> provisioning moved to [S-29](S-29-provisioning-engine.md) and
> [S-30](S-30-project-creation-from-template.md). Keep the local `loom-template` checkout
> as the rate source; you do not need to vendor it under `projects/` to read a YAML file.

**Phase:** 2 · **Workstream:** 6 Projects & Loom · **Status:** Not started
**Component:** `06-loom-integration.md` · **Traces to:** FR-4.5, FR-7.2, FR-7.3, E-7.b, AD-5
**Depends on:** S-18 · **Blocks:** re-seeds S-04's `costWeight` (do before tuning S-08)

## Goal

Bring Loom into IDEA as project #1 and use its real cost model to seed IDEA's router.
This is `00-opening-prompt.md` Step 1 — arguably the very first thing to do after the
foundation stories.

## Scope

**1. Vendor the checkout** (from the IDEA repo root):

```bash
git clone https://github.com/compiles-first-time/loom-template.git projects/loom
grep -qxF "projects/" .gitignore || echo "projects/" >> .gitignore
```

Local checkout for reference: `c:\Users\14134\dev\loom-template`

**2. Register it** in `config/projects.json`:

```json
{
  "name": "loom",
  "title": "Loom Observatory",
  "root": "projects/loom",
  "launch": "node observatory/server.mjs",
  "dashboardUrl": "http://127.0.0.1:4040",
  "configPath": "observatory/config.yaml",
  "autostart": false
}
```

> **Corrected path.** `05-data-contracts.md` §8 and `06-loom-integration.md` both specify
> `configPath: "config.yaml"`, which resolves to `projects/loom/config.yaml`. **That file
> does not exist** — verified against the real checkout. The config lives at
> `observatory/config.yaml`.

**3. Seed cost rates:** read **`projects/loom/observatory/config.yaml`** → `cost_rates`
→ map into `ModelRecord.inputWeight` / `outputWeight` in `config/models.json`
(FR-7.3, FR-4.5). The verified contents:

```yaml
cost_rates:                        # USD per 1M tokens
  anthropic:
    claude-opus-4:    { input: 15.00, output: 75.00 }
    claude-sonnet-4:  { input:  3.00, output: 15.00 }
    claude-haiku-3.5: { input:  0.80, output:  4.00 }
  openai:
    gpt-4o:           { input:  2.50, output: 10.00 }
    gpt-4o-mini:      { input:  0.15, output:  0.60 }
  google:
    gemini-2.5-pro:   { input:  1.25, output:  5.00 }
    gemini-2.5-flash: { input:  0.15, output:  0.60 }
```

## Acceptance criteria

- [ ] `projects/loom` exists and `git status` is clean (E-7.b — nothing from Loom is staged)
- [ ] `node observatory/server.mjs` in `projects/loom` serves `http://127.0.0.1:4040`
- [ ] The `loom` record validates against `ProjectRecord` (S-18)
- [ ] `observatory/config.yaml` is parsed and its `cost_rates` map into
      `inputWeight`/`outputWeight` values
- [ ] The **model-id translation is documented** — Loom's `claude-sonnet-4` is not
      IDEA's registry id. Write the mapping table down; it will drift otherwise.
- [ ] A Loom model with no IDEA counterpart (and vice versa) is handled explicitly,
      not silently skipped
- [ ] IDEA commits the registry entry only; **zero** Loom source files enter IDEA's history

## Exceptions honored

- **E-7.b** Vendored source is git-ignored, never committed.
- **AD-5** Loom stays an independent repo. Integration is process control + HTTP +
  config read. **Do not modify anything under `projects/loom`** — changes there are
  invisible to Loom's own repo and will be lost on re-clone.
- **E-7.a** The Observatory runs locally; Vercel only links to it.

## Notes / open questions

- **Do this early.** Seeding `costWeight` from Loom's real rates before tuning the
  router (S-08) avoids inventing numbers you'd only have to replace.
- Needs a YAML parser — none is currently a dependency. Adding `yaml` is fine; note it
  in the story when you do.
- Open: is the cost seeding **one-time** (copy values into `models.json`) or **live**
  (read `config.yaml` at run time)? Live reading won't work on Vercel — `projects/` isn't
  in the deployment. **Recommend one-time seeding with a documented refresh procedure.**
- The reverse direction — IDEA emitting `RoutingDecision` and `ToolTraceEvent` for the
  Observatory to visualize — is the natural follow-on, but it isn't scoped in Phase 2.
  Write a new story when you want it.
