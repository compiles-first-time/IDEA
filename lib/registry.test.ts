import test from "node:test";
import assert from "node:assert/strict";

import {
  RegistryError,
  allModels,
  defaultModelId,
  enabledModels,
  getModel,
  loadRegistry,
  modelsAtOrAboveTier,
  parseRegistry,
  type Registry,
} from "@/lib/registry";

function fixture(overrides: Partial<Registry> = {}): Registry {
  return parseRegistry({
    defaultId: "mid",
    models: [
      {
        id: "cheap",
        provider: "anthropic",
        label: "Cheap",
        tier: "light",
        inputWeight: 1,
        outputWeight: 5,
        contextWindow: 200000,
      },
      {
        id: "mid",
        provider: "anthropic",
        label: "Mid",
        tier: "standard",
        inputWeight: 3,
        outputWeight: 15,
        contextWindow: 1000000,
      },
      {
        id: "top",
        provider: "anthropic",
        label: "Top",
        tier: "heavy",
        inputWeight: 5,
        outputWeight: 25,
        contextWindow: 1000000,
      },
      {
        id: "off",
        provider: "anthropic",
        label: "Disabled",
        tier: "heavy",
        inputWeight: 0.1,
        outputWeight: 0.1,
        contextWindow: 1000,
        enabled: false,
      },
      ...(overrides.models ?? []),
    ],
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* The bundled registry                                                        */
/* -------------------------------------------------------------------------- */

test("the bundled config/models.json is valid", () => {
  const registry = loadRegistry();
  assert.ok(registry.models.length > 0);
  assert.ok(getModel(registry.defaultId), "defaultId must name an enabled model");
});

test("the bundled registry covers every tier", () => {
  for (const tier of ["light", "standard", "heavy"] as const) {
    assert.ok(
      modelsAtOrAboveTier(tier).length > 0,
      `no enabled model satisfies tier ${tier} — auto routing would have no candidate`,
    );
  }
});

test("bundled rates are asymmetric and output costs more than input", () => {
  for (const m of allModels()) {
    assert.ok(m.outputWeight > m.inputWeight, `${m.id} output should cost more than input`);
  }
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

test("rejects a malformed record with a located message", () => {
  assert.throws(
    () =>
      parseRegistry({
        defaultId: "a",
        models: [{ id: "a", provider: "anthropic", label: "A", tier: "light" }],
      }),
    /invalid model registry.*inputWeight/,
  );
});

test("rejects an unknown tier and an unknown provider", () => {
  const base = {
    id: "a",
    label: "A",
    inputWeight: 1,
    outputWeight: 2,
    contextWindow: 100,
  };
  assert.throws(
    () => parseRegistry({ defaultId: "a", models: [{ ...base, provider: "anthropic", tier: "epic" }] }),
    RegistryError,
  );
  assert.throws(
    () => parseRegistry({ defaultId: "a", models: [{ ...base, provider: "skynet", tier: "light" }] }),
    RegistryError,
  );
});

test("a local model without an endpoint is a validation error", () => {
  assert.throws(
    () =>
      parseRegistry({
        defaultId: "l",
        models: [
          {
            id: "l",
            provider: "local",
            label: "Local",
            tier: "light",
            inputWeight: 0,
            outputWeight: 0,
            contextWindow: 8192,
          },
        ],
      }),
    /must declare an endpoint/,
  );
});

test("a local model with an endpoint is accepted", () => {
  const r = parseRegistry({
    defaultId: "l",
    models: [
      {
        id: "l",
        provider: "local",
        label: "Local",
        tier: "light",
        inputWeight: 0,
        outputWeight: 0,
        contextWindow: 8192,
        endpoint: "http://127.0.0.1:11434/v1",
      },
    ],
  });
  assert.equal(r.models[0].endpoint, "http://127.0.0.1:11434/v1");
});

test("rejects duplicate ids", () => {
  const one = {
    id: "dup",
    provider: "anthropic",
    label: "A",
    tier: "light",
    inputWeight: 1,
    outputWeight: 2,
    contextWindow: 100,
  };
  assert.throws(() => parseRegistry({ defaultId: "dup", models: [one, one] }), /duplicate model id/);
});

test("rejects a defaultId that names no model", () => {
  assert.throws(
    () =>
      parseRegistry({
        defaultId: "ghost",
        models: [
          {
            id: "real",
            provider: "anthropic",
            label: "R",
            tier: "light",
            inputWeight: 1,
            outputWeight: 2,
            contextWindow: 100,
          },
        ],
      }),
    /is not in the registry/,
  );
});

test("rejects an empty model list", () => {
  assert.throws(() => parseRegistry({ defaultId: "x", models: [] }), RegistryError);
});

test("negative rates are rejected", () => {
  assert.throws(
    () =>
      parseRegistry({
        defaultId: "a",
        models: [
          {
            id: "a",
            provider: "anthropic",
            label: "A",
            tier: "light",
            inputWeight: -1,
            outputWeight: 2,
            contextWindow: 100,
          },
        ],
      }),
    RegistryError,
  );
});

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

test("disabled models are excluded everywhere", () => {
  const r = fixture();
  assert.equal(getModel("off", r), undefined);
  assert.equal(
    enabledModels(r).some((m) => m.id === "off"),
    false,
  );
  assert.equal(
    modelsAtOrAboveTier("light", r).some((m) => m.id === "off"),
    false,
  );
  // ...but allModels() still sees it, so the UI can show why it's unavailable.
  assert.ok(allModels(r).some((m) => m.id === "off"));
});

test("modelsAtOrAboveTier applies a floor, not an exact match", () => {
  const r = fixture();
  assert.deepEqual(
    modelsAtOrAboveTier("light", r).map((m) => m.id),
    ["cheap", "mid", "top"],
  );
  assert.deepEqual(
    modelsAtOrAboveTier("standard", r).map((m) => m.id),
    ["mid", "top"],
  );
  assert.deepEqual(
    modelsAtOrAboveTier("heavy", r).map((m) => m.id),
    ["top"],
  );
});

/* -------------------------------------------------------------------------- */
/* Default resolution                                                          */
/* -------------------------------------------------------------------------- */

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env.IDEA_CHAT_MODEL;
  if (value === undefined) delete process.env.IDEA_CHAT_MODEL;
  else process.env.IDEA_CHAT_MODEL = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.IDEA_CHAT_MODEL;
    else process.env.IDEA_CHAT_MODEL = prev;
  }
}

test("defaultModelId honors IDEA_CHAT_MODEL", () => {
  withEnv("top", () => assert.equal(defaultModelId(fixture()), "top"));
});

test("defaultModelId falls back to the registry default without the env var", () => {
  withEnv(undefined, () => assert.equal(defaultModelId(fixture()), "mid"));
});

test("an env override naming a disabled or unknown model is ignored", () => {
  // A typo in an env var must not take chat down.
  withEnv("off", () => assert.equal(defaultModelId(fixture()), "mid"));
  withEnv("does-not-exist", () => assert.equal(defaultModelId(fixture()), "mid"));
});

test("defaultModelId falls through to the first enabled model", () => {
  const r = parseRegistry({
    defaultId: "off",
    models: [
      {
        id: "off",
        provider: "anthropic",
        label: "Off",
        tier: "light",
        inputWeight: 1,
        outputWeight: 2,
        contextWindow: 100,
        enabled: false,
      },
      {
        id: "on",
        provider: "anthropic",
        label: "On",
        tier: "light",
        inputWeight: 1,
        outputWeight: 2,
        contextWindow: 100,
      },
    ],
  });
  withEnv(undefined, () => assert.equal(defaultModelId(r), "on"));
});

test("defaultModelId throws when nothing is enabled", () => {
  const r = parseRegistry({
    defaultId: "off",
    models: [
      {
        id: "off",
        provider: "anthropic",
        label: "Off",
        tier: "light",
        inputWeight: 1,
        outputWeight: 2,
        contextWindow: 100,
        enabled: false,
      },
    ],
  });
  withEnv(undefined, () => assert.throws(() => defaultModelId(r), /no enabled models/));
});
