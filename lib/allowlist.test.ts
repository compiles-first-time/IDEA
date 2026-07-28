import test from "node:test";
import assert from "node:assert/strict";

import { denialReason, isAllowed, parseAllowlist } from "@/lib/allowlist";

/* -------------------------------------------------------------------------- */
/* Fail closed (NFR-4)                                                         */
/* -------------------------------------------------------------------------- */

test("an unset allowlist denies everyone", () => {
  assert.equal(isAllowed("anyone", parseAllowlist(undefined)), false);
  assert.equal(isAllowed("anyone", parseAllowlist(null)), false);
  assert.equal(isAllowed("anyone", parseAllowlist("")), false);
});

test("an allowlist of only separators is still empty", () => {
  assert.deepEqual(parseAllowlist(" , ,, "), []);
  assert.equal(isAllowed("anyone", parseAllowlist(" , ,, ")), false);
});

test("a missing login is denied rather than treated as a match", () => {
  const list = parseAllowlist("someone");
  assert.equal(isAllowed(undefined, list), false);
  assert.equal(isAllowed(null, list), false);
  assert.equal(isAllowed("", list), false);
  assert.equal(isAllowed("   ", list), false);
});

test("an unlisted login is denied", () => {
  assert.equal(isAllowed("stranger", parseAllowlist("someone,teammate")), false);
});

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

test("a listed login is allowed", () => {
  assert.equal(isAllowed("someone", parseAllowlist("someone,teammate")), true);
  assert.equal(isAllowed("teammate", parseAllowlist("someone,teammate")), true);
});

test("case does not matter — GitHub logins are case-insensitive", () => {
  // Locking someone out of their own machine over capitalization would be a
  // bug, not security.
  assert.equal(isAllowed("SomeOne", parseAllowlist("someone")), true);
  assert.equal(isAllowed("someone", parseAllowlist("SOMEONE")), true);
});

test("surrounding whitespace is tolerated on both sides", () => {
  assert.equal(isAllowed("  someone  ", parseAllowlist(" someone , teammate ")), true);
});

test("a partial match is not a match", () => {
  // "some" must not open the door for "someone".
  assert.equal(isAllowed("someone", parseAllowlist("some")), false);
  assert.equal(isAllowed("some", parseAllowlist("someone")), false);
});

/* -------------------------------------------------------------------------- */
/* Explaining the refusal                                                      */
/* -------------------------------------------------------------------------- */

test("an empty allowlist explains that it is empty, and how to fix it", () => {
  const reason = denialReason("someone", []);
  assert.match(reason, /ALLOWED_LOGINS is empty/);
  assert.match(reason, /\.env\.local/);
});

test("a rejected login is named, so the operator can see which account was used", () => {
  // The whole point: the browser may be signed into a different GitHub account
  // than the one you expect, and nothing on screen tells you which.
  const reason = denialReason("Stranger", parseAllowlist("someone,teammate"));
  assert.match(reason, /"stranger"/);
  assert.match(reason, /someone, teammate/);
});

test("a missing username is reported as such rather than as a mismatch", () => {
  const reason = denialReason(undefined, parseAllowlist("someone"));
  assert.match(reason, /did not return a username/);
});
