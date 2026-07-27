import test from "node:test";
import assert from "node:assert/strict";

import { contentHash, matchesHash } from "@/lib/hash";

test("contentHash is stable across calls", () => {
  const a = contentHash("export const x = 1;\n");
  const b = contentHash("export const x = 1;\n");
  assert.equal(a, b);
});

test("contentHash is sensitive to any change", () => {
  const base = contentHash("hello");
  assert.notEqual(base, contentHash("hello "));
  assert.notEqual(base, contentHash("Hello"));
  assert.notEqual(base, contentHash("hell"));
});

test("contentHash is prefixed and hex", () => {
  const h = contentHash("anything");
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
});

test("contentHash handles empty and unicode content", () => {
  assert.match(contentHash(""), /^sha256:[0-9a-f]{64}$/);
  // Distinct multi-byte input must not collide with its ascii-ish neighbour.
  assert.notEqual(contentHash("café"), contentHash("cafe"));
});

test("contentHash distinguishes line endings", () => {
  // Matters for pinning: a CRLF checkout and an LF blob are not the same bytes.
  assert.notEqual(contentHash("a\nb"), contentHash("a\r\nb"));
});

test("matchesHash confirms and rejects", () => {
  const content = "const answer = 42;";
  assert.equal(matchesHash(content, contentHash(content)), true);
  assert.equal(matchesHash("const answer = 43;", contentHash(content)), false);
});

test("matchesHash never throws on malformed expectations", () => {
  assert.equal(matchesHash("x", ""), false);
  assert.equal(matchesHash("x", "not-a-hash"), false);
});
