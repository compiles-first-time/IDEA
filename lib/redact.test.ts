import test from "node:test";
import assert from "node:assert/strict";

import { appendTurn, type CanonicalTurn } from "@/lib/conversation";
import { describeHits, redactText, redactTurn, redactUnknown } from "@/lib/redact";

const T0 = new Date("2026-07-26T12:00:00.000Z");

/* -------------------------------------------------------------------------- */
/* Positive detection                                                          */
/* -------------------------------------------------------------------------- */

const SECRETS: ReadonlyArray<[string, string, string]> = [
  ["anthropic-key", "sk-ant-api03-" + "A".repeat(40), "anthropic-key"],
  ["openai-key", "sk-" + "B".repeat(40), "openai-key"],
  ["github classic", "ghp_" + "c".repeat(36), "github-token"],
  ["github fine-grained", "github_pat_" + "d".repeat(30), "github-token"],
  ["aws", "AKIAIOSFODNN7EXAMPLE", "aws-access-key"],
  ["huggingface", "hf_" + "e".repeat(34), "huggingface-token"],
  ["google", "AIza" + "f".repeat(35), "google-api-key"],
  ["slack", "xoxb-1234567890-abcdefghij", "slack-token"],
  [
    "jwt",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "jwt",
  ],
];

for (const [label, secret, kind] of SECRETS) {
  test(`redacts ${label}`, () => {
    const r = redactText(`here is the key: ${secret} — use it`);
    assert.equal(r.redacted, true, "should have fired");
    assert.equal(r.value.includes(secret), false, "secret must not survive");
    assert.ok(
      r.hits.some((h) => h.kind === kind),
      `expected a ${kind} hit, got ${JSON.stringify(r.hits)}`,
    );
  });
}

test("redacts a PEM private key block", () => {
  const pem = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "MIIEowIBAAKCAQEAx".repeat(3),
    "-----END RSA PRIVATE KEY-----",
  ].join("\n");
  const r = redactText(`key:\n${pem}\ndone`);
  assert.equal(r.value.includes("MIIEowIBAAKCAQEAx"), false);
  assert.ok(r.value.includes("[REDACTED:private-key]"));
});

test("redacts a bearer token in a header dump", () => {
  const r = redactText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345");
  assert.equal(r.redacted, true);
  assert.equal(r.value.includes("abcdefghijklmnopqrstuvwxyz012345"), false);
});

test("redacts .env-shaped assignments but keeps the key name readable", () => {
  const r = redactText(
    ["ANTHROPIC_API_KEY=super-secret-value-here", "PORT=4040", "DB_PASSWORD=hunter2hunter2"].join(
      "\n",
    ),
  );
  assert.ok(r.value.includes("ANTHROPIC_API_KEY=[REDACTED:env-assignment]"));
  assert.ok(r.value.includes("DB_PASSWORD=[REDACTED:env-assignment]"));
  assert.ok(r.value.includes("PORT=4040"), "non-secret keys are left alone");
});

test("redacts multiple occurrences and counts them", () => {
  const tok = "ghp_" + "a".repeat(36);
  const r = redactText(`${tok} and again ${tok}`);
  assert.equal(r.value.includes(tok), false);
  assert.equal(r.hits.find((h) => h.kind === "github-token")?.count, 2);
});

/* -------------------------------------------------------------------------- */
/* Known values from the environment (NFR-6)                                   */
/* -------------------------------------------------------------------------- */

test("redacts the literal value of a server env secret", () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "totally-unique-env-secret-1234";
  try {
    const r = redactText("the configured key is totally-unique-env-secret-1234 ok");
    assert.equal(r.value.includes("totally-unique-env-secret-1234"), false);
    assert.ok(r.hits.some((h) => h.kind === "known-secret"));
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("the session GitHub accessToken can never survive a turn", () => {
  const token = "gho_sessiontokenvalue0000000000000000";
  const turn = appendTurn(
    [],
    {
      role: "tool",
      content: [
        { type: "tool_call", id: "c1", tool: "read_repo_file", args: { auth: token } },
        { type: "tool_result", callId: "c1", ok: true, result: { echoed: token } },
      ],
    },
    T0,
  )[0];

  const r = redactTurn(turn, [token]);
  const serialized = JSON.stringify(r.value);
  assert.equal(serialized.includes(token), false, "token leaked through a turn");
  assert.equal(r.redacted, true);
});

/* -------------------------------------------------------------------------- */
/* False positives — these must survive untouched                              */
/* -------------------------------------------------------------------------- */

const MUST_SURVIVE: ReadonlyArray<[string, string]> = [
  ["git sha", "7e48ed3a9c1f4b2d8e6a0c5f3b7d9e1a2c4f6b8d"],
  ["uuid", "c49d5e6e-57a5-43c2-ac07-96726c5465b2"],
  [
    "base64 image blob",
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" + "QPz/HwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  ],
  ["long hex hash", "sha256:" + "a1b2c3d4".repeat(8)],
  ["normal prose", "The secret to good code is naming things well."],
  ["a code snippet", "const token = getToken(); // reads from env"],
];

for (const [label, text] of MUST_SURVIVE) {
  test(`leaves ${label} untouched`, () => {
    const r = redactText(text);
    assert.equal(r.redacted, false, `false positive on ${label}: ${JSON.stringify(r.hits)}`);
    assert.equal(r.value, text);
  });
}

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

test("redactUnknown walks nested objects and arrays", () => {
  const tok = "ghp_" + "z".repeat(36);
  const r = redactUnknown({ a: [{ b: { c: tok } }], d: "clean", e: 42, f: null });
  assert.equal(JSON.stringify(r.value).includes(tok), false);
  assert.equal((r.value as { d: string }).d, "clean");
  assert.equal((r.value as { e: number }).e, 42);
  assert.equal((r.value as { f: null }).f, null);
});

test("redactTurn marks the turn and leaves clean turns unmarked", () => {
  const clean = appendTurn([], { role: "user", content: [{ type: "text", text: "hello" }] }, T0)[0];
  const cleanResult = redactTurn(clean);
  assert.equal(cleanResult.redacted, false);
  assert.equal(cleanResult.value.redacted, undefined);

  const dirty = appendTurn(
    [],
    { role: "user", content: [{ type: "text", text: "key sk-ant-" + "q".repeat(30) }] },
    T0,
  )[0];
  const dirtyResult = redactTurn(dirty);
  assert.equal(dirtyResult.redacted, true);
  assert.equal(dirtyResult.value.redacted, true);
});

test("redactTurn never touches repo_context identifiers", () => {
  const turn: CanonicalTurn = appendTurn(
    [],
    {
      role: "user",
      content: [
        {
          type: "repo_context",
          owner: "o",
          repo: "r",
          path: "auth.ts",
          sha: "7e48ed3a9c1f4b2d8e6a0c5f3b7d9e1a2c4f6b8d",
          bytes: 10,
          contentHash: "sha256:" + "0".repeat(64),
        },
      ],
    },
    T0,
  )[0];

  const r = redactTurn(turn);
  assert.deepEqual(r.value.content, turn.content);
  assert.equal(r.redacted, false);
});

test("redaction is not reversible — no original is retained", () => {
  const tok = "ghp_" + "y".repeat(36);
  const r = redactText(`token ${tok}`);
  assert.equal(JSON.stringify(r).includes(tok), false, "the original must not ride along");
});

test("redaction is idempotent", () => {
  const once = redactText("key sk-ant-" + "m".repeat(30));
  const twice = redactText(once.value);
  assert.equal(twice.value, once.value);
  assert.equal(twice.redacted, false);
});

test("describeHits renders a readable summary", () => {
  assert.equal(
    describeHits([
      { kind: "github-token", count: 1 },
      { kind: "env-assignment", count: 2 },
    ]),
    "1 github-token, 2 env-assignment",
  );
});
