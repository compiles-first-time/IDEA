import assert from "node:assert/strict";
import { test } from "node:test";

import { BYOK_PROVIDERS, byokHeaderName, keysFromHeaders } from "@/lib/byok";
import { isHosted } from "@/lib/hosted";
import { hasKeyFor } from "@/lib/providers";
import { ModelRecord } from "@/lib/registry";

/* ---------------------------------------------------------------------------
 * Hosted-mode flag
 * ------------------------------------------------------------------------- */

test("hosted mode is off for a plain environment", () => {
  assert.equal(isHosted({}), false);
});

test("hosted mode turns on for Vercel and for the explicit flag", () => {
  assert.equal(isHosted({ VERCEL: "1" }), true);
  assert.equal(isHosted({ IDEA_HOSTED: "1" }), true);
});

test("hosted mode is not fooled by falsy-looking values", () => {
  assert.equal(isHosted({ IDEA_HOSTED: "0" }), false);
  assert.equal(isHosted({ IDEA_HOSTED: "" }), false);
  assert.equal(isHosted({ VERCEL: "" }), false);
});

/* ---------------------------------------------------------------------------
 * BYOK headers
 * ------------------------------------------------------------------------- */

test("keys are read from their headers, trimmed", () => {
  const headers = new Headers({
    [byokHeaderName("anthropic")]: "  sk-ant-test1234  ",
    [byokHeaderName("moonshot")]: "sk-moon-5678",
  });
  const keys = keysFromHeaders(headers);
  assert.equal(keys.anthropic, "sk-ant-test1234");
  assert.equal(keys.moonshot, "sk-moon-5678");
  assert.equal(keys.openai, undefined);
});

test("absent, empty, and oversized headers yield no key", () => {
  const headers = new Headers({
    [byokHeaderName("openai")]: "   ",
    [byokHeaderName("google")]: "x".repeat(513),
  });
  const keys = keysFromHeaders(headers);
  assert.deepEqual(keys, {});
});

test("a header not in the provider table is ignored", () => {
  const headers = new Headers({ "x-idea-key-madeup": "sk-nope" });
  const keys = keysFromHeaders(headers) as Record<string, string>;
  assert.equal(keys["madeup"], undefined);
});

test("every BYOK provider has a distinct header name", () => {
  const names = BYOK_PROVIDERS.map((p) => byokHeaderName(p.id));
  assert.equal(new Set(names).size, names.length);
});

/* ---------------------------------------------------------------------------
 * Key pre-flight (hasKeyFor)
 * ------------------------------------------------------------------------- */

function model(provider: ModelRecord["provider"], endpoint?: string): ModelRecord {
  return ModelRecord.parse({
    id: `test-${provider}`,
    provider,
    label: `Test ${provider}`,
    tier: "standard",
    inputWeight: 1,
    outputWeight: 5,
    contextWindow: 100_000,
    enabled: true,
    ...(endpoint ? { endpoint } : {}),
  });
}

/** Run `fn` with the named env vars removed, restoring them after. */
function withoutEnv(names: string[], fn: () => void): void {
  const saved = names.map((n) => [n, process.env[n]] as const);
  for (const n of names) delete process.env[n];
  try {
    fn();
  } finally {
    for (const [n, v] of saved) if (v !== undefined) process.env[n] = v;
  }
}

test("a per-request key satisfies the pre-flight without any env", () => {
  withoutEnv(["ANTHROPIC_API_KEY"], () => {
    const m = model("anthropic");
    assert.equal(hasKeyFor(m), false);
    assert.equal(hasKeyFor(m, { anthropic: "sk-ant-user" }), true);
  });
});

test("an env key satisfies the pre-flight when no request key exists", () => {
  withoutEnv(["MOONSHOT_API_KEY"], () => {
    const m = model("moonshot", "https://api.moonshot.ai/v1");
    assert.equal(hasKeyFor(m, {}), false);
    process.env.MOONSHOT_API_KEY = "sk-moon-env";
    try {
      assert.equal(hasKeyFor(m, {}), true);
    } finally {
      delete process.env.MOONSHOT_API_KEY;
    }
  });
});

test("google accepts either of its two documented env names", () => {
  withoutEnv(["GEMINI_API_KEY", "GOOGLE_API_KEY"], () => {
    const m = model("google", "https://generativelanguage.googleapis.com/v1beta/openai");
    assert.equal(hasKeyFor(m, {}), false);
    process.env.GOOGLE_API_KEY = "AIza-env";
    try {
      assert.equal(hasKeyFor(m, {}), true);
    } finally {
      delete process.env.GOOGLE_API_KEY;
    }
  });
});

test("a local model needs no key — most local servers are anonymous", () => {
  withoutEnv(["IDEA_LOCAL_API_KEY"], () => {
    assert.equal(hasKeyFor(model("local", "http://127.0.0.1:11434/v1"), {}), true);
  });
});

test("a key for one provider does not satisfy another", () => {
  withoutEnv(["OPENAI_API_KEY"], () => {
    const m = model("openai", "https://api.openai.com/v1");
    assert.equal(hasKeyFor(m, { anthropic: "sk-ant-user" }), false);
  });
});
