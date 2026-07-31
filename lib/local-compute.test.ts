import test from "node:test";
import assert from "node:assert/strict";

import { tryCompute } from "@/lib/local-compute";

const answer = (s: string) => tryCompute(s)?.answer ?? null;

/* ── What it will answer ─────────────────────────────────────────────────── */

test("plain arithmetic is answered without a model", () => {
  assert.equal(answer("1 + 1"), "2");
  assert.equal(answer("12*4"), "48");
  assert.equal(answer("100 / 8"), "12.5");
  assert.equal(answer("10 - 3 - 2"), "5", "left-associative");
});

test("precedence and parentheses are respected", () => {
  assert.equal(answer("2 + 3 * 4"), "14");
  assert.equal(answer("(2 + 3) * 4"), "20");
  assert.equal(answer("(3 + 4) / 2"), "3.5");
});

test("exponentiation is right-associative", () => {
  assert.equal(answer("2 ^ 3"), "8");
  assert.equal(answer("2 ** 3"), "8");
  assert.equal(answer("2 ^ 3 ^ 2"), "512", "not 64");
});

test("negatives and decimals work", () => {
  assert.equal(answer("-5 + 3"), "-2");
  assert.equal(answer("0.1 + 0.2"), "0.3", "floating-point noise is trimmed, not misreported");
});

test("common framing is stripped", () => {
  assert.equal(answer("what is 2+2"), "4");
  assert.equal(answer("What's 2+2?"), "4");
  assert.equal(answer("calculate 7 * 6"), "42");
});

test("thousands separators and typed symbols are understood", () => {
  assert.equal(answer("1,000 + 1"), "1001");
  assert.equal(answer("6 × 7"), "42");
  assert.equal(answer("84 ÷ 2"), "42");
});

/* ── What it refuses, and why each refusal matters ───────────────────────── */

test("anything with words in it goes to a model", () => {
  // The arithmetic is the easy half; the request is not arithmetic.
  assert.equal(answer("1 + 1 and then explain why"), null);
  assert.equal(answer("add one and one"), null);
});

test("a percentage of something we do not have is refused", () => {
  assert.equal(answer("15% of my invoice total"), null);
});

test("unit conversion is refused — the unit is ambiguous", () => {
  // Short ton, long ton, or metric tonne: three different right answers.
  assert.equal(answer("convert 5 tons to kg"), null);
  assert.equal(answer("5 miles in km"), null);
});

test("anything depending on today is refused", () => {
  assert.equal(answer("how many days until Friday"), null);
});

test("a comparison is a claim, not a calculation", () => {
  assert.equal(answer("is 7 > 3"), null);
  assert.equal(answer("7 > 3"), null);
});

test("a bare number is not a question", () => {
  assert.equal(answer("42"), null);
  assert.equal(answer("  7  "), null);
});

test("division by zero is undefined, not Infinity", () => {
  assert.equal(answer("1/0"), null);
  assert.equal(answer("5 % 0"), null);
});

test("a malformed expression is refused rather than half-evaluated", () => {
  assert.equal(answer("2 +"), null);
  assert.equal(answer("(2 + 3"), null);
  assert.equal(answer("2 + 3)"), null);
  assert.equal(answer("* 5"), null);
});

test("currency and units attached to numbers are refused", () => {
  assert.equal(answer("$5 + $3"), null);
  assert.equal(answer("5kg + 3kg"), null);
});

/* ── Safety ──────────────────────────────────────────────────────────────── */

test("a huge exponent is refused rather than computed", () => {
  // 9 ** 9 ** 9 is a denial of service written in three characters.
  assert.equal(answer("9 ^ 9 ^ 9"), null);
  assert.equal(answer("2 ^ 1000"), null);
});

test("an overlong input is refused before parsing", () => {
  assert.equal(answer("1+".repeat(200) + "1"), null);
});

test("non-string input does not throw", () => {
  assert.doesNotThrow(() => tryCompute(undefined as never));
  assert.equal(tryCompute(undefined as never), null);
  assert.equal(tryCompute(123 as never), null);
});

test("nothing resembling code is executed", () => {
  // The evaluator is written out rather than using eval/Function precisely so
  // that a string like this can never become a code path.
  assert.equal(answer("process.exit(1)"), null);
  assert.equal(answer("1;process.exit(1)"), null);
  assert.equal(answer("constructor"), null);
});

test("the expression that was evaluated is reported back", () => {
  const r = tryCompute("what is (2 + 3) * 4?");
  assert.equal(r?.expression, "(2 + 3) * 4");
  assert.equal(r?.value, 20);
});
