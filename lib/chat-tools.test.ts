import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHAT_TOOL_NAMES, chatTools } from "@/lib/chat-tools";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "idea-chat-tools-"));
  await mkdir(join(root, "lib"), { recursive: true });
  await writeFile(join(root, "lib", "router.ts"), "export function selectModel() {}\n");
  await writeFile(join(root, "README.md"), "demo\n");
  const tools = chatTools({ scope: { projectRoot: root, ideaRoot: process.cwd() } });
  return { root, tools };
}

/** Call a tool the way the AI SDK would. */
function run(tools: ReturnType<typeof chatTools>, name: string, args: Record<string, unknown>) {
  const t = tools[name] as { execute: (a: unknown, o: unknown) => Promise<unknown> };
  return t.execute(args, {});
}

test("chat gets read-only tools, not write or shell", () => {
  // 09-agent-authority permits writes; a chat turn has nowhere to surface a
  // Rule 20 confirmation, and a surface that cannot ask must not act.
  assert.deepEqual([...CHAT_TOOL_NAMES].sort(), ["list_files", "read_file", "search_files"]);
});

test("only those tools are built", async (t) => {
  const { root, tools } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(Object.keys(tools).sort(), ["list_files", "read_file", "search_files"]);
  assert.equal(tools.write_file, undefined);
  assert.equal(tools.bash, undefined);
});

test("search finds project code", async (t) => {
  const { root, tools } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = (await run(tools, "search_files", { pattern: "selectModel" })) as {
    matches: Array<{ path: string }>;
  };
  assert.ok(r.matches.some((m) => m.path === "lib/router.ts"));
});

test("reading a file inside the project works", async (t) => {
  const { root, tools } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await run(tools, "read_file", { path: "README.md" });
  assert.match(String(r), /demo/);
});

test("a path outside the project is refused, and says why", async (t) => {
  const { root, tools } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = (await run(tools, "read_file", { path: "../../../etc/hosts" })) as {
    ok: boolean;
    error: string;
  };
  assert.equal(r.ok, false);
  assert.match(r.error, /Refused/i);
});

test("a refusal is returned to the model, not thrown", async (t) => {
  // The model should read the refusal and pick a different path — more useful
  // than a dead turn the user has to restart.
  const { root, tools } = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.doesNotReject(() => run(tools, "read_file", { path: "../escape" }));
});

test("every executed call is reported to the caller", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "idea-chat-tools-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "a.md"), "x\n");

  const seen: Array<{ tool: string; ok: boolean }> = [];
  const tools = chatTools({
    scope: { projectRoot: root, ideaRoot: process.cwd() },
    onCall: (e) => seen.push({ tool: e.tool, ok: e.ok }),
  });

  await run(tools, "read_file", { path: "a.md" });
  await run(tools, "read_file", { path: "../nope" });

  assert.deepEqual(seen, [
    { tool: "read_file", ok: true },
    { tool: "read_file", ok: false },
  ]);
});
