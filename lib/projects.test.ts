import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ProjectRegistryError,
  getProject,
  hasDependencies,
  isProvisioned,
  parseProjects,
  projectFor,
  projectRoot,
  type ProjectRecord,
} from "@/lib/projects";
import { provision, type RunCommand, type StepOutcome } from "@/lib/provision";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function record(over: Partial<ProjectRecord> = {}): ProjectRecord {
  return parseProjects({
    projects: [
      {
        name: "my-app",
        title: "My App",
        gitUrl: "https://github.com/me/my-app.git",
        owner: "me",
        repo: "my-app",
        root: "projects/my-app",
        ...over,
      },
    ],
  }).projects[0];
}

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "idea-proj-"));
}

/* -------------------------------------------------------------------------- */
/* Registry validation — this is security, not cosmetics                       */
/* -------------------------------------------------------------------------- */

test("a valid project parses with sensible defaults", () => {
  const p = record();
  assert.equal(p.configPath, "observatory/config.yaml");
  assert.equal(p.conversationBranch, "idea/conversations");
  assert.equal(p.autostart, false);
});

test("path traversal in root is rejected", () => {
  for (const root of ["../../etc", "projects/../../..", "/absolute/path"]) {
    assert.throws(() => record({ root }), ProjectRegistryError, `should reject root "${root}"`);
  }
});

test("there is no launch command or dashboard URL — a project is not a process", () => {
  // 10-observatory-merged: IDEA renders the Observatory itself, so there is
  // nothing to launch and nothing to link out to.
  const p = record() as Record<string, unknown>;
  assert.equal("launch" in p, false);
  assert.equal("dashboardUrl" in p, false);
});

test("gitUrl must agree with owner/repo", () => {
  assert.throws(
    () => record({ gitUrl: "https://github.com/someone-else/other.git" }),
    /must match owner\/repo/,
  );
});

test("the conversation branch may never be the default branch", () => {
  for (const branch of ["main", "master"]) {
    assert.throws(() => record({ conversationBranch: branch }), /must not be the default branch/);
  }
});

test("an unsafe project name is rejected", () => {
  for (const name of ["../evil", "has space", "", "a/b"]) {
    assert.throws(() => record({ name }), ProjectRegistryError, `should reject name "${name}"`);
  }
});

test("duplicate project names are rejected", () => {
  const one = {
    name: "dup",
    title: "D",
    gitUrl: "https://github.com/me/dup.git",
    owner: "me",
    repo: "dup",
    root: "projects/dup",
  };
  assert.throws(() => parseProjects({ projects: [one, one] }), /duplicate project name/);
});

test("an empty registry is valid", () => {
  assert.deepEqual(parseProjects({ projects: [] }).projects, []);
  assert.deepEqual(parseProjects({}).projects, []);
});

test("getProject finds by name", () => {
  const file = parseProjects({ projects: [record()] });
  assert.equal(getProject(file, "my-app")?.title, "My App");
  assert.equal(getProject(file, "ghost"), undefined);
});

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

test("projectRoot resolves inside the workspace", () => {
  const root = projectRoot("/work/idea", record());
  assert.match(root.replace(/\\/g, "/"), /work\/idea\/projects\/my-app$/);
});

test("projectFor builds a valid record from a new repo", () => {
  const p = projectFor({ name: "fresh", owner: "me", repo: "fresh", seededFrom: "loom-template" });
  assert.equal(p.root, "projects/fresh");
  assert.equal(p.gitUrl, "https://github.com/me/fresh.git");
  assert.equal(p.seededFrom, "loom-template");
});

/* -------------------------------------------------------------------------- */
/* State is derived from disk, not remembered                                  */
/* -------------------------------------------------------------------------- */

test("provisioned state is read from disk so it survives a restart", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  const p = record();

  assert.equal(isProvisioned(ws, p), false);
  await mkdir(join(ws, "projects", "my-app", ".git"), { recursive: true });
  assert.equal(isProvisioned(ws, p), true);
});

test("a project with no package.json vacuously has its dependencies", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  await mkdir(join(ws, "projects", "my-app"), { recursive: true });

  assert.equal(hasDependencies(ws, record()), true);
  await writeFile(join(ws, "projects", "my-app", "package.json"), "{}");
  assert.equal(hasDependencies(ws, record()), false);
});

/* -------------------------------------------------------------------------- */
/* Provisioning                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Records the argv of every command, and can be told which ones fail.
 *
 * A successful `git clone` actually creates `.git` and the launch target, so
 * the `verify` step sees what a real clone would leave behind. A fake that
 * skipped that would make `verify` untestable — and `verify` exists precisely
 * to catch an incomplete checkout.
 */
function fakeRunner(ws: string, fail: string[] = []) {
  const calls: string[][] = [];
  const run: RunCommand = async (argv) => {
    calls.push([...argv]);
    const joined = argv.join(" ");
    if (fail.some((f) => joined.includes(f))) {
      return { ok: false, output: `simulated failure: ${joined}` };
    }
    if (argv[0] === "git" && argv[1] === "clone") {
      const target = argv[3];
      await mkdir(join(target, ".git"), { recursive: true });
      await mkdir(join(target, "observatory"), { recursive: true });
      await writeFile(join(target, "observatory", "server.mjs"), "// dashboard\n");
    }
    if (joined.includes("npm install")) {
      await mkdir(join(ws, "projects", "my-app", "node_modules"), { recursive: true });
    }
    return { ok: true, output: "ok" };
  };
  return { run, calls };
}

/** A complete checkout, as a successful clone would leave it. */
async function provisioned(ws: string) {
  const root = join(ws, "projects", "my-app");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "observatory"), { recursive: true });
  await writeFile(join(root, "observatory", "server.mjs"), "// dashboard\n");
}

/** A checkout that has `.git` but is missing its launch target. */
async function partiallyCloned(ws: string) {
  await mkdir(join(ws, "projects", "my-app", ".git"), { recursive: true });
}

test("a full provision runs clone then install, and reports each step", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  const { run, calls } = fakeRunner(ws);
  const seen: StepOutcome[] = [];

  const r = await provision({
    ideaRoot: ws,
    project: record(),
    run,
    
    onStep: (o) => seen.push(o),
  });

  assert.equal(r.ok, true);
  assert.equal(r.failedAt, null);
  assert.deepEqual(calls[0].slice(0, 2), ["git", "clone"]);
  assert.deepEqual(
    seen.map((s) => s.step),
    ["clone", "install", "bootstrap", "verify"],
    "progress is reported per step (FR-8.3)",
  );
});

test("provisioning is idempotent — an existing checkout skips clone (FR-8.6)", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  await provisioned(ws);
  const { run, calls } = fakeRunner(ws);

  const r = await provision({ ideaRoot: ws, project: record(), run });

  assert.equal(r.ok, true);
  assert.equal(
    calls.some((c) => c[1] === "clone"),
    false,
    "must not re-clone over an existing checkout",
  );
  assert.equal(r.log.find((s) => s.step === "clone")?.skipped, true);
});

test("existing dependencies skip install", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  await provisioned(ws);
  await writeFile(join(ws, "projects", "my-app", "package.json"), "{}");
  await mkdir(join(ws, "projects", "my-app", "node_modules"), { recursive: true });

  const { run, calls } = fakeRunner(ws);
  await provision({ ideaRoot: ws, project: record(), run });

  assert.equal(
    calls.some((c) => c.join(" ").includes("npm install")),
    false,
  );
});

test("a failed step stops the pipeline and names where it failed", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  const { run, calls } = fakeRunner(ws, ["git clone"]);

  const r = await provision({ ideaRoot: ws, project: record(), run });

  assert.equal(r.ok, false);
  assert.equal(r.failedAt, "clone");
  assert.equal(calls.length, 1, "later steps must not run");
  assert.match(r.log[0].detail, /simulated failure/, "the real command output is surfaced");
});

test("a partial failure can be resumed rather than requiring a wipe", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));

  // First attempt: clone succeeds, install fails.
  const first = fakeRunner(ws, ["npm install"]);
  await mkdir(join(ws, "projects", "my-app"), { recursive: true });
  await writeFile(join(ws, "projects", "my-app", "package.json"), "{}");
  await provisioned(ws);

  const a = await provision({ ideaRoot: ws, project: record(), run: first.run });
  assert.equal(a.failedAt, "install");

  // Second attempt: install now succeeds; clone is skipped, not repeated.
  const second = fakeRunner(ws);
  const b = await provision({ ideaRoot: ws, project: record(), run: second.run });
  assert.equal(b.ok, true);
  assert.equal(
    second.calls.some((c) => c[1] === "clone"),
    false,
  );
});

test("verify reports a fresh checkout with no event log as normal, not a failure", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  await partiallyCloned(ws);

  const { run } = fakeRunner(ws);
  const r = await provision({ ideaRoot: ws, project: record(), run });

  assert.equal(r.ok, true, "a project that has not run yet is fine");
  assert.match(r.log.find((s) => s.step === "verify")!.detail, /no event log yet/);
});

test("verify notes an event log when the project has already run", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  await partiallyCloned(ws);
  await mkdir(join(ws, "projects", "my-app", "memory", "event-log"), { recursive: true });

  const { run } = fakeRunner(ws);
  const r = await provision({ ideaRoot: ws, project: record(), run });

  assert.equal(r.ok, true);
  assert.match(r.log.find((s) => s.step === "verify")!.detail, /event log present/);
});

test("provisioning ends at verify — there is nothing to start", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));

  const { run } = fakeRunner(ws);
  const r = await provision({ ideaRoot: ws, project: record(), run });

  // 10-observatory-merged: a project is not a process. IDEA renders its
  // Observatory itself, so there is no server to launch afterwards.
  assert.deepEqual(
    r.log.map((s) => s.step),
    ["clone", "install", "bootstrap", "verify"],
  );
});

test("bootstrap is skipped when the project has no bootstrap script", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  await provisioned(ws);

  const { run } = fakeRunner(ws);
  const r = await provision({ ideaRoot: ws, project: record(), run });
  assert.equal(r.log.find((s) => s.step === "bootstrap")?.skipped, true);
});

test("commands are argv arrays, never shell strings (E-8.c)", async (t) => {
  const ws = await workspace();
  t.after(() => rm(ws, { recursive: true, force: true }));
  const { run, calls } = fakeRunner(ws);

  await provision({ ideaRoot: ws, project: record(), run });

  for (const argv of calls) {
    assert.ok(Array.isArray(argv), "every command is an argv array");
    assert.ok(argv.length >= 2, "argv is split, not concatenated");
    for (const part of argv) {
      assert.equal(/[;&|`$]/.test(part), false, `shell metacharacter in argv: ${part}`);
    }
  }
});

test("provisioning reads no script list out of the cloned repo (E-8.c)", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./provision.ts", import.meta.url), "utf8"),
  );
  // Steps are literals in this module; nothing is loaded from project content.
  assert.equal(src.includes("JSON.parse"), false, "no reading a manifest from the repo");
  assert.equal(src.includes("shell: true"), false, "provisioning never uses a shell");
});
