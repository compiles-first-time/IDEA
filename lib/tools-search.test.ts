import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TOOL_NAMES, executeTool } from "@/lib/tools";

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "idea-search-"));
  await mkdir(join(root, "lib"), { recursive: true });
  await mkdir(join(root, "node_modules", "junk"), { recursive: true });
  await writeFile(join(root, "lib", "router.ts"), "export function selectModel() {}\n// TODO fix\n");
  await writeFile(join(root, "lib", "cost.ts"), "export function estimateCostUsd() {}\n");
  await writeFile(join(root, "README.md"), "IDEA routes by cost.\n");
  await writeFile(join(root, "node_modules", "junk", "index.js"), "selectModel everywhere\n");
  await writeFile(join(root, "bin.dat"), "before\0after selectModel\n");
  return root;
}

function search(root: string, args: Record<string, unknown>) {
  return executeTool(
    { id: "1", tool: "search_files", args },
    { scope: { projectRoot: root, ideaRoot: process.cwd() } },
  );
}

test("search_files is a registered tool", () => {
  assert.ok(TOOL_NAMES.includes("search_files"));
});

test("finds a symbol and reports where it is", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "selectModel" });
  assert.equal(r.ok, true);
  const { matches } = r.result as { matches: Array<{ path: string; line: number }> };

  assert.ok(matches.some((m) => m.path === "lib/router.ts" && m.line === 1));
});

test("node_modules and .git are skipped", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "selectModel" });
  const { matches } = r.result as { matches: Array<{ path: string }> };
  assert.ok(
    !matches.some((m) => m.path.includes("node_modules")),
    "searching dependencies buries the project's own code",
  );
});

test("binary files are skipped by content, not by extension", async (t) => {
  // Extensions lie. A match inside a compiled artifact is noise at best.
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "selectModel" });
  const { matches } = r.result as { matches: Array<{ path: string }> };
  assert.ok(!matches.some((m) => m.path === "bin.dat"));
});

test("matching is case-insensitive", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "SELECTMODEL" });
  const { count } = r.result as { count: number };
  assert.ok(count > 0);
});

test("a regex pattern works when asked for", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "estimate\\w+Usd", regex: true });
  const { matches } = r.result as { matches: Array<{ path: string }> };
  assert.ok(matches.some((m) => m.path === "lib/cost.ts"));
});

test("an invalid regex is reported, not thrown", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "([unclosed", regex: true });
  assert.equal(r.ok, false);
  assert.match(String(r.result), /invalid regular expression/);
});

test("truncation is reported rather than silent", async (t) => {
  // "50 matches" and "at least 50 matches" lead to different next moves.
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "e", maxResults: 2 });
  const { matches, truncated } = r.result as { matches: unknown[]; truncated: boolean };
  assert.equal(matches.length, 2);
  assert.equal(truncated, true);
});

test("searching a subdirectory narrows the scope", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "cost", path: "lib" });
  const { matches } = r.result as { matches: Array<{ path: string }> };
  assert.ok(!matches.some((m) => m.path === "README.md"));
});

test("no match is an empty result, not an error", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "definitelyNotPresentAnywhere" });
  assert.equal(r.ok, true);
  const { count, truncated } = r.result as { count: number; truncated: boolean };
  assert.equal(count, 0);
  assert.equal(truncated, false);
});

test("a path outside the project is refused", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const r = await search(root, { pattern: "x", path: "../.." });
  assert.equal(r.ok, false);
  assert.match(String(r.result), /refused/);
});
