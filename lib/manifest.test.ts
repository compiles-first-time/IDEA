import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import {
  ManifestError,
  nameFromSource,
  parseAgentDefinition,
  parseSkillMd,
  serializeSkillMd,
} from "@/lib/manifest";

/* -------------------------------------------------------------------------- */
/* Shape 1 — specialists, with frontmatter                                     */
/* -------------------------------------------------------------------------- */

const SPECIALIST = `---
name: auth
summary: Application authentication — session cookies, password hashing, MFA.
tier: bundled
context_budget: 24000
tools: [Read, Glob, Grep, Edit, Write]
credential_scope: keyring:idea/github#repo
verifier_type: test_suite
---

# auth specialist

## Role + scope

Application-level authentication for a new project.
`;

test("parses a specialist SKILL.md with frontmatter", () => {
  const m = parseSkillMd(SPECIALIST, "agents/specialists/_registry/auth/SKILL.md");

  assert.equal(m.name, "auth");
  assert.match(m.description, /session cookies/);
  assert.deepEqual(m.tools, ["Read", "Glob", "Grep", "Edit", "Write"]);
  assert.equal(m.tier, "bundled");
  assert.equal(m.contextBudget, 24000);
  assert.equal(m.credentialScope, "keyring:idea/github#repo");
  assert.equal(m.verifierType, "test_suite");
  assert.equal(m.inferred, false);
});

test("the body becomes the system prompt, frontmatter stripped", () => {
  const m = parseSkillMd(SPECIALIST, "x/SKILL.md");
  assert.ok(m.system.startsWith("# auth specialist"));
  assert.equal(m.system.includes("context_budget"), false, "frontmatter must not leak in");
});

/* -------------------------------------------------------------------------- */
/* Shape 2 — base agents, no frontmatter at all                                */
/* -------------------------------------------------------------------------- */

const BASE_AGENT = `# Critic / Auditor

> **Role:** Quality gate. Reviews outputs before commitment; enforces confidence calibration.
> **Origin:** Base PRISM spec.

## Responsibilities

1. Pre-dispatch context admission check.
`;

test("parses a base agent with no frontmatter — 6 of Loom's 20 have none", () => {
  const m = parseSkillMd(BASE_AGENT, "agents/critic/SKILL.md");

  assert.equal(m.name, "critic", "name is inferred from the directory");
  assert.match(m.description, /Quality gate/, "description comes from the Role blockquote");
  assert.equal(m.inferred, true, "callers should know fields were inferred");
  assert.deepEqual(m.tools, []);
});

test("a frontmatter-less skill with no Role line falls back to the first paragraph", () => {
  const m = parseSkillMd("# Thing\n\nDoes a useful job.\n", "agents/thing/SKILL.md");
  assert.equal(m.description, "Does a useful job.");
});

test("a skill with only a heading parses with an empty description rather than failing", () => {
  const m = parseSkillMd("# Bare\n", "agents/bare/SKILL.md");
  assert.equal(m.description, "");
  assert.equal(m.name, "bare");
});

test("nameFromSource handles both directory and filename conventions", () => {
  assert.equal(nameFromSource("agents/critic/SKILL.md"), "critic");
  assert.equal(nameFromSource("agents\\critic\\SKILL.md"), "critic");
  assert.equal(nameFromSource("skills/deploy.md"), "deploy");
  assert.equal(nameFromSource("SKILL.md"), "SKILL");
});

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

test("defaults are applied: no tools, auto model policy", () => {
  const m = parseSkillMd("---\nname: x\n---\nbody\n", "x/SKILL.md");
  assert.deepEqual(m.tools, []);
  assert.equal(m.modelPolicy.mode, "auto");
  assert.equal(m.modelPolicy.preferredTier, undefined);
  assert.equal(m.modelPolicy.pinnedModelId, undefined);
});

test("a pinned model and preferred tier are read when present", () => {
  const m = parseSkillMd(
    "---\nname: x\nmodel: claude-opus-5\npreferred_tier: heavy\nmodel_mode: manual\n---\nbody\n",
    "x/SKILL.md",
  );
  assert.equal(m.modelPolicy.pinnedModelId, "claude-opus-5");
  assert.equal(m.modelPolicy.preferredTier, "heavy");
  assert.equal(m.modelPolicy.mode, "manual");
});

test("agent definitions default to 12 steps and honor an override", () => {
  assert.equal(parseAgentDefinition("---\nname: a\n---\nb\n", "a/SKILL.md").maxSteps, 12);
  assert.equal(
    parseAgentDefinition("---\nname: a\nmax_steps: 4\n---\nb\n", "a/SKILL.md").maxSteps,
    4,
  );
});

/* -------------------------------------------------------------------------- */
/* Tolerant where humans are involved                                          */
/* -------------------------------------------------------------------------- */

test("a comma-separated tools string is accepted, not just a YAML list", () => {
  const m = parseSkillMd("---\nname: x\ntools: Read, Glob, Grep\n---\nb\n", "x/SKILL.md");
  assert.deepEqual(m.tools, ["Read", "Glob", "Grep"]);
});

test("CRLF line endings parse the same as LF", () => {
  const lf = parseSkillMd("---\nname: x\ntier: t\n---\nbody\n", "x/SKILL.md");
  const crlf = parseSkillMd("---\r\nname: x\r\ntier: t\r\n---\r\nbody\r\n", "x/SKILL.md");
  assert.equal(crlf.name, lf.name);
  assert.equal(crlf.tier, lf.tier);
});

/* -------------------------------------------------------------------------- */
/* Errors name the file and the problem                                        */
/* -------------------------------------------------------------------------- */

test("an empty file errors with the source named", () => {
  assert.throws(() => parseSkillMd("", "agents/x/SKILL.md"), (e: ManifestError) => {
    assert.ok(e instanceof ManifestError);
    assert.match(e.message, /agents\/x\/SKILL\.md/);
    assert.match(e.message, /empty/);
    return true;
  });
});

test("malformed YAML frontmatter errors with a located message, not a TypeError", () => {
  const bad = "---\nname: [unclosed\n---\nbody\n";
  assert.throws(() => parseSkillMd(bad, "agents/x/SKILL.md"), (e: Error) => {
    assert.ok(e instanceof ManifestError);
    assert.match(e.message, /not valid YAML/);
    return true;
  });
});

test("non-mapping frontmatter is rejected clearly", () => {
  assert.throws(
    () => parseSkillMd("---\n- a\n- b\n---\nbody\n", "x/SKILL.md"),
    /must be a mapping/,
  );
});

test("a non-integer context_budget names the offending key", () => {
  assert.throws(
    () => parseSkillMd("---\nname: x\ncontext_budget: lots\n---\nb\n", "x/SKILL.md"),
    /context_budget/,
  );
});

test("a tools value of the wrong type names the offending key", () => {
  assert.throws(() => parseSkillMd("---\nname: x\ntools: 42\n---\nb\n", "x/SKILL.md"), /tools/);
});

/* -------------------------------------------------------------------------- */
/* Tool names are carried, not judged (S-12 decides at run time)               */
/* -------------------------------------------------------------------------- */

test("a manifest naming a forbidden tool parses fine — refusal happens at execution", () => {
  const m = parseSkillMd("---\nname: x\ntools: [rm_rf_everything]\n---\nb\n", "x/SKILL.md");
  assert.deepEqual(m.tools, ["rm_rf_everything"]);
  // Parsing must not be where this fails, or the error says "parse failed"
  // instead of the truthful "tool not allowed".
});

/* -------------------------------------------------------------------------- */
/* Round trip                                                                  */
/* -------------------------------------------------------------------------- */

test("serialize → parse preserves the manifest", () => {
  const original = parseSkillMd(SPECIALIST, "agents/auth/SKILL.md");
  const round = parseSkillMd(serializeSkillMd(original), "agents/auth/SKILL.md");

  assert.equal(round.name, original.name);
  assert.equal(round.description, original.description);
  assert.deepEqual(round.tools, original.tools);
  assert.equal(round.tier, original.tier);
  assert.equal(round.contextBudget, original.contextBudget);
  assert.equal(round.credentialScope, original.credentialScope);
  assert.equal(round.system, original.system);
});

/* -------------------------------------------------------------------------- */
/* Against the real Loom skills                                                */
/* -------------------------------------------------------------------------- */

const LOOM = "C:/Users/14134/dev/loom-template";

test("parses every real SKILL.md in loom-template", async (t) => {
  if (!existsSync(LOOM)) return t.skip("loom-template not present on this machine");

  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(`${LOOM}/agents`, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name === "SKILL.md")
    .map((e) => `${e.parentPath ?? e.path}/${e.name}`);

  assert.ok(files.length >= 10, `expected Loom's skills, found ${files.length}`);

  let withFrontmatter = 0;
  for (const rel of files) {
    const raw = await readFile(rel, "utf8");
    const m = parseSkillMd(raw, rel);

    assert.ok(m.name.length > 0, `${rel} produced no name`);
    assert.ok(m.system.length > 0, `${rel} produced an empty system prompt`);
    if (!m.inferred) withFrontmatter++;
  }

  // Both shapes must actually be represented, or this test proves nothing.
  assert.ok(withFrontmatter > 0, "expected some skills with frontmatter");
  assert.ok(withFrontmatter < files.length, "expected some skills without frontmatter");
});
