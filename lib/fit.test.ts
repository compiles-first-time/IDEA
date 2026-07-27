import test from "node:test";
import assert from "node:assert/strict";

import {
  OVERHEAD_MULTIPLIER,
  OVERKILL_MULTIPLIER,
  classify,
  fit,
  requiredMemoryGB,
  usableMemoryGB,
  type HardwareReport,
  type LocalModelInfo,
} from "@/lib/fit";

function hw(ramGB: number, vramGB: number | null = null): HardwareReport {
  return { ramGB, vramGB, source: "helper" };
}

function model(sizeGB: number): LocalModelInfo {
  return { id: "m", paramsB: null, quant: null, sizeGB, location: "hf-cache" };
}

test("uses VRAM when reported and RAM when not", () => {
  assert.equal(usableMemoryGB(hw(64, 24)), 24);
  assert.equal(usableMemoryGB(hw(64, null)), 64);
});

test("required memory applies the overhead multiplier", () => {
  assert.equal(requiredMemoryGB(model(10)), 10 * OVERHEAD_MULTIPLIER);
});

test("a model larger than memory is too_large", () => {
  // 30 GB * 1.2 = 36 needed, 24 available
  assert.equal(classify(model(30), hw(64, 24)), "too_large");
});

test("a well-matched model is a good_fit", () => {
  // 16 * 1.2 = 19.2 needed, 24 available → ratio 1.25, below overkill
  assert.equal(classify(model(16), hw(64, 24)), "good_fit");
});

test("far more memory than needed is overkill", () => {
  // 4 * 1.2 = 4.8 needed, 80 available
  assert.equal(classify(model(4), hw(128, 80)), "overkill");
});

/* Boundaries — the cases the rule is actually specified at. ----------------- */

test("need exactly equal to memory is a good_fit, not too_large", () => {
  const need = 20;
  const size = need / OVERHEAD_MULTIPLIER;
  assert.equal(classify(model(size), hw(need, need)), "good_fit");
});

test("one hair over memory tips to too_large", () => {
  const mem = 20;
  const size = (mem + 0.001) / OVERHEAD_MULTIPLIER;
  assert.equal(classify(model(size), hw(mem, mem)), "too_large");
});

test("memory exactly at the overkill multiple is overkill", () => {
  const size = 10;
  const need = size * OVERHEAD_MULTIPLIER;
  assert.equal(classify(model(size), hw(999, need * OVERKILL_MULTIPLIER)), "overkill");
});

test("one hair under the overkill multiple is still a good_fit", () => {
  const size = 10;
  const need = size * OVERHEAD_MULTIPLIER;
  assert.equal(classify(model(size), hw(999, need * OVERKILL_MULTIPLIER - 0.001)), "good_fit");
});

/* Degenerate input ---------------------------------------------------------- */

test("a zero-size model is overkill on any real machine, and never throws", () => {
  assert.equal(classify(model(0), hw(16)), "overkill");
});

test("negative and non-finite sizes never crash", () => {
  assert.doesNotThrow(() => fit(model(-5), hw(16)));
  assert.doesNotThrow(() => fit(model(NaN), hw(16)));
  assert.doesNotThrow(() => fit(model(10), hw(NaN)));
});

test("an unknown size fails closed as too_large, never overkill (NFR-4)", () => {
  // Treating an unknown size as 0 would report "overkill" and invite the user
  // to load something that may not fit at all.
  const r = fit(model(NaN), hw(128, 80));
  assert.equal(r.verdict, "too_large");
  assert.match(r.note, /size is unknown/);
});

test("unknown memory also fails closed", () => {
  const r = fit(model(1), hw(NaN));
  assert.equal(r.verdict, "too_large");
  assert.match(r.note, /unknown/);
});

test("a result with unknown inputs is still JSON-serializable", () => {
  // Zod rejects NaN and JSON can't represent it — the echoed figures must be normalized.
  const r = fit(model(NaN), hw(NaN));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(r)));
  assert.equal(Number.isFinite(r.headroomGB), true);
  assert.equal(Number.isFinite(r.model.sizeGB), true);
});

test("an absurdly large model is too_large", () => {
  assert.equal(classify(model(100_000), hw(64, 24)), "too_large");
});

test("zero memory makes any real model too_large", () => {
  assert.equal(classify(model(1), hw(0, 0)), "too_large");
});

/* Result shape -------------------------------------------------------------- */

test("headroom is memory minus need, and negative when too large", () => {
  const good = fit(model(16), hw(64, 24));
  // Rounded for display; compare against the rounded expectation.
  assert.equal(good.headroomGB, Math.round((24 - 16 * OVERHEAD_MULTIPLIER) * 100) / 100);
  assert.ok(good.headroomGB > 0);

  const bad = fit(model(30), hw(64, 24));
  assert.ok(bad.headroomGB < 0, "too_large must report negative headroom");
});

test("the note explains the verdict in a usable sentence", () => {
  const r = fit(model(30), hw(64, 24));
  assert.match(r.note, /won't load/);
  assert.match(r.note, /VRAM/);
  assert.ok(r.note.length > 40);
});

test("the note names RAM when no GPU is reported", () => {
  assert.match(fit(model(4), hw(64, null)).note, /RAM/);
});

test("fit is pure — same inputs, same output", () => {
  assert.deepEqual(fit(model(12), hw(32, 16)), fit(model(12), hw(32, 16)));
});

test("fit never probes hardware — the module reads no system state (E-6.b)", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./fit.ts", import.meta.url), "utf8"),
  );
  for (const banned of ["node:os", "require(", "process.", "fetch(", "child_process"]) {
    assert.equal(src.includes(banned), false, `fit.ts must not reference ${banned}`);
  }
});
