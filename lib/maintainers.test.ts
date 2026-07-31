import test from "node:test";
import assert from "node:assert/strict";

import { can, denialReason, isLoomMaintainer } from "@/lib/maintainers";

const EMPTY: Record<string, string | undefined> = {};

/* ── The owner's accounts ────────────────────────────────────────────────── */

test("both of the owner's accounts maintain loom-template", () => {
  // They browse as one and use the CLI as the other; treating only one as the
  // owner is what made a sign-in failure take several rounds to diagnose.
  assert.equal(isLoomMaintainer("compiles-first-time", EMPTY), true);
  assert.equal(isLoomMaintainer("compiles-first-try", EMPTY), true);
});

test("case does not decide ownership", () => {
  assert.equal(isLoomMaintainer("Compiles-First-Time", EMPTY), true);
  assert.equal(isLoomMaintainer("  compiles-first-try  ", EMPTY), true);
});

test("anyone else is refused", () => {
  assert.equal(isLoomMaintainer("someone-else", EMPTY), false);
  assert.equal(isLoomMaintainer("compiles-first", EMPTY), false, "a prefix is not a match");
});

/* ── Fail closed ─────────────────────────────────────────────────────────── */

test("no login is not a maintainer", () => {
  assert.equal(isLoomMaintainer(undefined, EMPTY), false);
  assert.equal(isLoomMaintainer(null, EMPTY), false);
  assert.equal(isLoomMaintainer("", EMPTY), false);
  assert.equal(isLoomMaintainer("   ", EMPTY), false);
});

test("an unknown capability is refused rather than defaulting to allow", () => {
  assert.equal(can("compiles-first-time", "admin:everything" as never, EMPTY), false);
});

test("an explicitly empty LOOM_MAINTAINERS means nobody — including the owner", () => {
  // Setting it to "" is a deliberate lockout. Restoring the defaults would
  // silently ignore what the operator asked for.
  const env = { LOOM_MAINTAINERS: "" };
  assert.equal(isLoomMaintainer("compiles-first-time", env), false);
});

/* ── Configuration ───────────────────────────────────────────────────────── */

test("the maintainer list can be overridden by env", () => {
  const env = { LOOM_MAINTAINERS: "someone-else, another " };
  assert.equal(isLoomMaintainer("someone-else", env), true);
  assert.equal(isLoomMaintainer("another", env), true);
  assert.equal(isLoomMaintainer("compiles-first-time", env), false, "the override replaces, not extends");
});

/* ── Refusals explain themselves ─────────────────────────────────────────── */

test("a refusal names the login and the maintainers", () => {
  const reason = denialReason("stranger", "write:loom-template", EMPTY);
  assert.match(reason, /"stranger"/);
  assert.match(reason, /compiles-first-time/);
  assert.match(reason, /seeded from it/, "it should say what to do instead");
});

test("a lockout says it is a lockout rather than blaming the user", () => {
  const reason = denialReason("compiles-first-time", "write:loom-template", { LOOM_MAINTAINERS: "" });
  assert.match(reason, /LOOM_MAINTAINERS is empty/);
});

test("not being signed in says so", () => {
  assert.match(denialReason(null, "write:loom-template", EMPTY), /Not signed in/);
});
