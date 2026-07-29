import test from "node:test";
import assert from "node:assert/strict";

import { buildTree } from "@/components/file-tree";

/** Flatten for assertions: every directory path in the built tree. */
function dirPaths(dir: ReturnType<typeof buildTree>, into: string[] = []): string[] {
  for (const child of dir.dirs.values()) {
    into.push(child.path);
    dirPaths(child, into);
  }
  return into;
}

test("nested paths become nested directories", () => {
  const root = buildTree([
    { path: "lib/observatory.ts" },
    { path: "lib/contracts/routing.ts" },
    { path: "README.md" },
  ]);

  assert.deepEqual(dirPaths(root).sort(), ["lib", "lib/contracts"]);
  assert.deepEqual(
    root.files.map((f) => f.path),
    ["README.md"],
    "a root-level file stays at the root",
  );
});

test("directory paths are full paths, not just names", () => {
  // The path is the collapse key — names alone would make `lib/contracts` and
  // `app/contracts` share one open/closed state.
  const root = buildTree([{ path: "a/contracts/x.ts" }, { path: "b/contracts/y.ts" }]);
  const paths = dirPaths(root).sort();
  assert.deepEqual(paths, ["a", "a/contracts", "b", "b/contracts"]);
});

test("files land in their own directory, not a parent", () => {
  const root = buildTree([{ path: "lib/contracts/routing.ts" }]);
  const lib = root.dirs.get("lib")!;
  assert.equal(lib.files.length, 0);
  assert.equal(lib.dirs.get("contracts")!.files[0].path, "lib/contracts/routing.ts");
});

test("an empty list builds an empty tree rather than throwing", () => {
  const root = buildTree([]);
  assert.equal(root.dirs.size, 0);
  assert.equal(root.files.length, 0);
});

test("a trailing-slash or empty path is skipped, not turned into a blank row", () => {
  const root = buildTree([{ path: "lib/" }, { path: "" }, { path: "ok.ts" }]);
  assert.deepEqual(
    root.files.map((f) => f.path),
    ["ok.ts"],
  );
});

test("deep nesting does not lose files", () => {
  const root = buildTree([{ path: "a/b/c/d/e/f.ts" }]);
  let node = root;
  for (const part of ["a", "b", "c", "d", "e"]) node = node.dirs.get(part)!;
  assert.equal(node.files[0].path, "a/b/c/d/e/f.ts");
});
