import test from "node:test";
import assert from "node:assert/strict";

import { unauthorized } from "@/lib/github";

// Smoke tests for the test harness itself (S-02). If these fail, no other test
// in the repo can be trusted — check tsx/tsconfig before debugging anything else.

test("harness executes TypeScript", () => {
  const typed: ReadonlyArray<number> = [1, 2, 3];
  assert.equal(
    typed.reduce((a, b) => a + b, 0),
    6,
  );
});

test("harness resolves the @/ path alias", () => {
  // Proves tsconfig `paths` work under the runner — lib/ code relies on this.
  assert.equal(typeof unauthorized, "function");
});

test("unauthorized() returns a 401 JSON Response", async () => {
  const res = unauthorized();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "unauthorized" });
});
