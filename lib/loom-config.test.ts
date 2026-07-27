import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import {
  LOOM_MODEL_MAP,
  LoomConfigError,
  parseLoomConfig,
  planSeed,
  readLoomConfig,
  seedRates,
} from "@/lib/loom-config";
import {
  hfRepoIdFromDir,
  paramsFromName,
  probeEndpoint,
  quantFromName,
  userHardware,
} from "@/lib/local-models";

/** The real shape, copied from a verified checkout. */
const REAL = `
server:
  port: 4040
  open_browser: true

cost_rates:
  anthropic:
    claude-opus-4:     { input: 15.00, output: 75.00 }
    claude-sonnet-4:   { input:  3.00, output: 15.00 }
    claude-haiku-3.5:  { input:  0.80, output:  4.00 }
  openai:
    gpt-4o:            { input:  2.50, output: 10.00 }
`;

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

test("parses Loom's real config shape", () => {
  const config = parseLoomConfig(REAL);
  assert.equal(config.server?.port, 4040);
  assert.equal(config.cost_rates?.anthropic["claude-opus-4"].output, 75);
});

test("rates are asymmetric — which is why the registry carries two weights", () => {
  for (const rate of seedRates(parseLoomConfig(REAL))) {
    assert.ok(
      rate.outputWeight > rate.inputWeight,
      `${rate.loomModelId} output should exceed input`,
    );
  }
});

test("a config with no cost_rates is valid and yields nothing", () => {
  assert.deepEqual(seedRates(parseLoomConfig("server:\n  port: 4040\n")), []);
});

test("malformed YAML errors clearly", () => {
  assert.throws(() => parseLoomConfig("cost_rates: [unclosed"), LoomConfigError);
});

test("a wrongly-shaped rate is rejected, not silently coerced", () => {
  assert.throws(
    () => parseLoomConfig("cost_rates:\n  anthropic:\n    m: { input: cheap, output: 1 }\n"),
    /not shaped as expected/,
  );
});

/* -------------------------------------------------------------------------- */
/* The translation table                                                       */
/* -------------------------------------------------------------------------- */

test("seeding plans rather than blindly applying", () => {
  const plan = planSeed(parseLoomConfig(REAL), [
    "claude-haiku-4-5",
    "claude-sonnet-5",
    "claude-opus-5",
  ]);

  assert.deepEqual(
    plan.applicable.map((a) => a.ideaModelId).sort(),
    ["claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"],
  );
  // gpt-4o has no IDEA registry entry — reported, not applied to the wrong model.
  assert.deepEqual(
    plan.unmapped.map((u) => u.loomModelId),
    ["gpt-4o"],
  );
});

test("registry models Loom has no rate for keep their existing weights", () => {
  const plan = planSeed(parseLoomConfig(REAL), ["claude-opus-5", "claude-fable-5"]);
  assert.deepEqual(plan.unpriced, ["claude-fable-5"]);
});

test("the translation table is documented for every Loom model in the real config", () => {
  for (const rate of seedRates(parseLoomConfig(REAL))) {
    assert.ok(
      rate.loomModelId in LOOM_MODEL_MAP,
      `${rate.loomModelId} has no entry in LOOM_MODEL_MAP — it would drift silently`,
    );
  }
});

/* -------------------------------------------------------------------------- */
/* Against the real checkout                                                   */
/* -------------------------------------------------------------------------- */

const LOOM_CONFIG = "C:/Users/14134/dev/loom-template/observatory/config.yaml";

test("reads the real observatory/config.yaml", async (t) => {
  if (!existsSync(LOOM_CONFIG)) return t.skip("loom-template not present on this machine");

  const config = await readLoomConfig(LOOM_CONFIG);
  const rates = seedRates(config);

  assert.ok(rates.length > 0, "the real config should declare rates");
  for (const r of rates) {
    assert.ok(
      r.loomModelId in LOOM_MODEL_MAP,
      `real config names "${r.loomModelId}" but the translation table has no entry`,
    );
  }
});

test("the documented path is observatory/config.yaml, not config.yaml", async (t) => {
  if (!existsSync("C:/Users/14134/dev/loom-template")) {
    return t.skip("loom-template not present on this machine");
  }
  assert.equal(existsSync(LOOM_CONFIG), true, "observatory/config.yaml should exist");
  assert.equal(
    existsSync("C:/Users/14134/dev/loom-template/config.yaml"),
    false,
    "the path in 05-data-contracts.md §8 does not exist — this test pins the correction",
  );
});

/* -------------------------------------------------------------------------- */
/* Local model discovery helpers                                               */
/* -------------------------------------------------------------------------- */

test("hf cache directory names decode to repo ids", () => {
  assert.equal(hfRepoIdFromDir("models--meta-llama--Llama-3-8B"), "meta-llama/Llama-3-8B");
  assert.equal(hfRepoIdFromDir("plain-name"), "plain-name");
});

test("parameter counts are read from names when stated", () => {
  assert.equal(paramsFromName("Llama-3-8B"), 8);
  assert.equal(paramsFromName("Mixtral-8x7B"), 7);
  assert.equal(paramsFromName("Qwen2.5-1.5B-Instruct"), 1.5);
  assert.equal(paramsFromName("some-model"), null);
});

test("quantisation labels are read from names when stated", () => {
  assert.equal(quantFromName("llama-3-8b-Q4_K_M.gguf"), "Q4_K_M");
  assert.equal(quantFromName("model-fp16"), "fp16");
  assert.equal(quantFromName("plain"), null);
});

test("hardware is always marked user-supplied, never auto-detected (E-6.b)", () => {
  const hw = userHardware({ ramGB: 32, vramGB: 12 });
  assert.equal(hw.source, "user");
  assert.equal(hw.vramGB, 12);
});

test("local-models never probes the machine for hardware (E-6.b)", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./local-models.ts", import.meta.url), "utf8"),
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const banned of ["totalmem", "freemem", "cpus(", "nvidia-smi"]) {
    assert.equal(code.includes(banned), false, `local-models.ts must not call ${banned}`);
  }
});

test("an unreachable endpoint reports why, quickly, instead of hanging", async () => {
  const started = Date.now();
  const probe = await probeEndpoint("http://127.0.0.1:1/v1", 400);

  assert.equal(probe.reachable, false);
  assert.match(probe.detail, /could not reach/);
  assert.match(probe.detail, /Is the server running\?/);
  assert.ok(Date.now() - started < 4000, "must fail fast, not hang the page");
});
