import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SkillNotFoundError, discoverSkills, findSkill } from "@/lib/skills";
import {
  TOOL_NAMES,
  executeTool,
  getTool,
  pathsForCall,
  unknownTools,
} from "@/lib/tools";
import type { ScopeContext } from "@/lib/permissions";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "idea-skills-"));
  await mkdir(join(dir, "agents", "critic"), { recursive: true });
  await mkdir(join(dir, "agents", "specialists", "_registry", "auth"), { recursive: true });

  await writeFile(
    join(dir, "agents", "critic", "SKILL.md"),
    "# Critic\n\n> **Role:** Quality gate.\n\nReviews things.\n",
  );
  await writeFile(
    join(dir, "agents", "specialists", "_registry", "auth", "SKILL.md"),
    "---\nname: auth\nsummary: Authentication work.\ntools: [read_file, write_file]\n---\n\n# auth\n\nDoes auth.\n",
  );
  return dir;
}

/**
 * Windows can hold a directory handle briefly after a process tree is killed.
 * Retry rather than failing an otherwise-passing test on a cleanup race.
 */
async function cleanup(dir: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== "EBUSY") return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

function scopeFor(root: string): ScopeContext {
  return { projectRoot: root, ideaRoot: join(root, "..", "idea-not-here") };
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                   */
/* -------------------------------------------------------------------------- */

test("discovers skills at several nesting depths", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  const { skills, skipped } = await discoverSkills(dir);
  assert.deepEqual(
    skills.map((s) => s.definition.name),
    ["auth", "critic"],
    "sorted by name for a stable UI",
  );
  assert.deepEqual(skipped, []);
});

test("a malformed skill is skipped with a reason, not fatal to the listing", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  await mkdir(join(dir, "agents", "broken"), { recursive: true });
  await writeFile(join(dir, "agents", "broken", "SKILL.md"), "---\nname: [unclosed\n---\nbody\n");

  const { skills, skipped } = await discoverSkills(dir);
  assert.equal(skills.length, 2, "the good skills still list");
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].path, /broken/);
  assert.match(skipped[0].reason, /YAML/);
});

test("an empty project discovers nothing rather than throwing", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "idea-empty-"));
  t.after(() => cleanup(dir));
  assert.deepEqual(await discoverSkills(dir), { skills: [], skipped: [] });
});

test("node_modules is not searched", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  await mkdir(join(dir, "agents", "node_modules", "pkg"), { recursive: true });
  await writeFile(join(dir, "agents", "node_modules", "pkg", "SKILL.md"), "---\nname: evil\n---\nx\n");

  const { skills } = await discoverSkills(dir);
  assert.equal(
    skills.some((s) => s.definition.name === "evil"),
    false,
  );
});

test("declared tools this build lacks are reported, not silently dropped", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  await mkdir(join(dir, "skills", "odd"), { recursive: true });
  await writeFile(
    join(dir, "skills", "odd", "SKILL.md"),
    "---\nname: odd\ntools: [read_file, teleport, mind_read]\n---\nbody\n",
  );

  const { skills } = await discoverSkills(dir);
  const odd = skills.find((s) => s.definition.name === "odd")!;
  assert.deepEqual(odd.missingTools, ["teleport", "mind_read"]);
});

/* -------------------------------------------------------------------------- */
/* Lookup by name (no path traversal to defend against)                        */
/* -------------------------------------------------------------------------- */

test("findSkill matches a discovered name", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));
  assert.equal((await findSkill(dir, "auth")).definition.name, "auth");
});

test("a traversing name simply matches nothing", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  for (const bad of ["../../etc/passwd", "../critic", "auth/../../x"]) {
    await assert.rejects(() => findSkill(dir, bad), SkillNotFoundError);
  }
});

test("the not-found error lists what is available", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));
  await assert.rejects(
    () => findSkill(dir, "ghost"),
    (e: Error) => /auth/.test(e.message) && /critic/.test(e.message),
  );
});

/* -------------------------------------------------------------------------- */
/* Tool registry                                                               */
/* -------------------------------------------------------------------------- */

test("the registry is small and enumerable", () => {
  // Pinned on purpose: adding a tool widens what an agent can do, so it should
  // fail here and be updated deliberately rather than slipping in unnoticed.
  assert.deepEqual(
    [...TOOL_NAMES].sort(),
    ["bash", "list_files", "read_file", "search_files", "write_file"],
  );
});

test("unknownTools names what a build cannot provide", () => {
  assert.deepEqual(unknownTools(["read_file", "nope"]), ["nope"]);
  assert.deepEqual(unknownTools([]), []);
});

test("pathsFor lets the gate scope-check before approval", () => {
  assert.deepEqual(pathsForCall({ tool: "write_file", args: { path: "a.ts" } }), ["a.ts"]);
  assert.deepEqual(pathsForCall({ tool: "bash", command: "ls" }), [], "a command's paths aren't static");
  assert.deepEqual(pathsForCall({ tool: "nonexistent" }), []);
});

test("every tool declares a description and a schema", () => {
  for (const name of TOOL_NAMES) {
    const def = getTool(name)!;
    assert.ok(def.description.length > 20, `${name} needs a real description`);
    assert.ok(def.parameters, `${name} needs a schema`);
  }
});

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

test("read and write round-trip inside the project", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));
  const opts = { scope: scopeFor(dir) };

  const w = await executeTool(
    { id: "1", tool: "write_file", args: { path: "src/new.ts", content: "export const x = 1;" } },
    opts,
  );
  assert.equal(w.ok, true);
  assert.ok(existsSync(join(dir, "src", "new.ts")), "parent directories are created");

  const r = await executeTool({ id: "2", tool: "read_file", args: { path: "src/new.ts" } }, opts);
  assert.equal(r.result, "export const x = 1;");
});

test("list_files returns sorted names with directories marked", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  const r = await executeTool({ id: "1", tool: "list_files", args: { path: "agents" } }, { scope: scopeFor(dir) });
  assert.deepEqual(r.result, ["critic/", "specialists/"]);
});

test("a path outside the project is refused even at the execution layer", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  const r = await executeTool(
    { id: "1", tool: "read_file", args: { path: "../../../etc/passwd" } },
    { scope: scopeFor(dir) },
  );
  assert.equal(r.ok, false);
  assert.match(String(r.result), /refused/);
});

test("bad arguments produce a useful message rather than a crash", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  const r = await executeTool({ id: "1", tool: "write_file", args: { path: "a.ts" } }, { scope: scopeFor(dir) });
  assert.equal(r.ok, false);
  assert.match(String(r.result), /invalid arguments/);
  assert.match(String(r.result), /content/);
});

test("an unknown tool is reported, not thrown", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  const r = await executeTool({ id: "1", tool: "teleport", args: {} }, { scope: scopeFor(dir) });
  assert.equal(r.ok, false);
  assert.match(String(r.result), /not available/);
});

test("bash runs in the project directory and reports its exit code", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  const r = await executeTool(
    { id: "1", tool: "bash", args: { command: "node -e \"console.log('hi')\"" } },
    { scope: scopeFor(dir) },
  );
  assert.equal(r.ok, true);
  assert.match(String(r.result), /exit 0/);
  assert.match(String(r.result), /hi/);
});

test("a failing command returns its output rather than swallowing it", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  const r = await executeTool(
    { id: "1", tool: "bash", args: { command: "node -e \"console.error('boom'); process.exit(3)\"" } },
    { scope: scopeFor(dir) },
  );
  assert.equal(r.ok, false);
  assert.match(String(r.result), /exit 3/);
  assert.match(String(r.result), /boom/, "a failing command's output is usually the useful part");
});

test("a hung command is killed at the timeout rather than wedging the run", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  const r = await executeTool(
    { id: "1", tool: "bash", args: { command: "node -e \"setTimeout(function(){}, 60000)\"" } },
    { scope: scopeFor(dir), timeoutMs: 800 },
  );
  assert.equal(r.ok, false);
  assert.match(String(r.result), /timed out/);
});

test("oversized output is truncated with a marker", async (t) => {
  const dir = await project();
  t.after(() => cleanup(dir));

  await writeFile(join(dir, "big.txt"), "x".repeat(5000));
  const r = await executeTool(
    { id: "1", tool: "read_file", args: { path: "big.txt" } },
    { scope: scopeFor(dir), maxOutputBytes: 500 },
  );
  assert.match(String(r.result), /truncated at 500 bytes/);
});
