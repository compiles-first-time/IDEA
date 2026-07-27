import test from "node:test";
import assert from "node:assert/strict";

import {
  CanonicalTurn,
  ConversationError,
  SCHEMA_VERSION,
  appendTurn,
  conversationPaths,
  newMeta,
  parseMeta,
  parseTurns,
  serializeMeta,
  serializeTurns,
  touchMeta,
  transcriptHash,
  validatePairing,
  type NewTurn,
} from "@/lib/conversation";

const T0 = new Date("2026-07-26T12:00:00.000Z");
const T1 = new Date("2026-07-26T12:00:05.000Z");

function userText(text: string): NewTurn {
  return { role: "user", content: [{ type: "text", text }] };
}

/* -------------------------------------------------------------------------- */
/* Layer 1 — transcript integrity                                              */
/* -------------------------------------------------------------------------- */

test("round-trips through serialize/parse with an unchanged hash", () => {
  let turns = appendTurn([], userText("explain this repo"), T0);
  turns = appendTurn(
    turns,
    {
      role: "assistant",
      modelId: "claude-sonnet-4-5",
      content: [
        { type: "text", text: "Sure." },
        {
          type: "repo_context",
          owner: "o",
          repo: "r",
          path: "auth.ts",
          sha: "abc123",
          bytes: 42,
          contentHash: "sha256:deadbeef",
        },
      ],
    },
    T1,
  );

  const before = transcriptHash(turns);
  const reparsed = parseTurns(serializeTurns(turns));

  assert.deepEqual(reparsed, turns);
  assert.equal(transcriptHash(reparsed), before);
});

test("empty transcript serializes to an empty string", () => {
  assert.equal(serializeTurns([]), "");
  assert.deepEqual(parseTurns(""), []);
});

test("parseTurns tolerates a trailing newline but not corrupt lines", () => {
  const turns = appendTurn([], userText("hi"), T0);
  assert.deepEqual(parseTurns(serializeTurns(turns) + "\n"), turns);

  assert.throws(() => parseTurns("{not json}"), ConversationError);
  assert.throws(() => parseTurns('{"seq":0}'), /not a valid turn/);
});

/* -------------------------------------------------------------------------- */
/* Append-only surface                                                          */
/* -------------------------------------------------------------------------- */

test("appendTurn assigns sequential seq and stamps ts server-side", () => {
  let turns = appendTurn([], userText("one"), T0);
  turns = appendTurn(turns, userText("two"), T1);

  assert.deepEqual(
    turns.map((t) => t.seq),
    [0, 1],
  );
  assert.equal(turns[0].ts, T0.toISOString());
  assert.equal(turns[1].ts, T1.toISOString());
});

test("appendTurn ignores a caller-supplied ts and seq", () => {
  const smuggled = {
    ...userText("hi"),
    ts: "1999-01-01T00:00:00.000Z",
    seq: 99,
  } as unknown as NewTurn;

  const [turn] = appendTurn([], smuggled, T0);
  assert.equal(turn.ts, T0.toISOString());
  assert.equal(turn.seq, 0);
});

test("appendTurn does not mutate the input array", () => {
  const original = appendTurn([], userText("one"), T0);
  const next = appendTurn(original, userText("two"), T1);
  assert.equal(original.length, 1);
  assert.equal(next.length, 2);
});

test("there is no exported mutation path for a stored turn", async () => {
  const mod = await import("@/lib/conversation");
  for (const banned of ["updateTurn", "deleteTurn", "replaceTurn", "editTurn"]) {
    assert.equal(banned in mod, false, `${banned} must not exist — the archive is append-only`);
  }
});

/* -------------------------------------------------------------------------- */
/* Pinning is mandatory                                                        */
/* -------------------------------------------------------------------------- */

test("repo_context without a sha is rejected", () => {
  const result = CanonicalTurn.safeParse({
    seq: 0,
    role: "user",
    ts: T0.toISOString(),
    content: [
      { type: "repo_context", owner: "o", repo: "r", path: "a.ts", bytes: 1, contentHash: "h" },
    ],
  });
  assert.equal(result.success, false);
});

test("repo_context with an empty sha is rejected", () => {
  const result = CanonicalTurn.safeParse({
    seq: 0,
    role: "user",
    ts: T0.toISOString(),
    content: [
      {
        type: "repo_context",
        owner: "o",
        repo: "r",
        path: "a.ts",
        sha: "",
        bytes: 1,
        contentHash: "h",
      },
    ],
  });
  assert.equal(result.success, false);
});

/* -------------------------------------------------------------------------- */
/* Tool-call pairing                                                            */
/* -------------------------------------------------------------------------- */

function withToolCall(): ReturnType<typeof appendTurn> {
  let turns = appendTurn(
    [],
    {
      role: "assistant",
      content: [{ type: "tool_call", id: "c1", tool: "read_repo_file", args: { path: "a.ts" } }],
    },
    T0,
  );
  turns = appendTurn(
    turns,
    { role: "tool", content: [{ type: "tool_result", callId: "c1", ok: true, result: "ok" }] },
    T1,
  );
  return turns;
}

test("validatePairing accepts a matched call/result", () => {
  assert.doesNotThrow(() => validatePairing(withToolCall()));
});

test("validatePairing rejects a dangling call", () => {
  const turns = appendTurn(
    [],
    { role: "assistant", content: [{ type: "tool_call", id: "c1", tool: "t", args: {} }] },
    T0,
  );
  assert.throws(() => validatePairing(turns), /has no tool_result/);
});

test("validatePairing rejects an orphan result", () => {
  const turns = appendTurn(
    [],
    { role: "tool", content: [{ type: "tool_result", callId: "nope", ok: true, result: 1 }] },
    T0,
  );
  assert.throws(() => validatePairing(turns), /unknown call/);
});

test("validatePairing rejects duplicate call ids and double answers", () => {
  const dupCall = appendTurn(
    [],
    {
      role: "assistant",
      content: [
        { type: "tool_call", id: "c1", tool: "t", args: {} },
        { type: "tool_call", id: "c1", tool: "t", args: {} },
      ],
    },
    T0,
  );
  assert.throws(() => validatePairing(dupCall), /duplicate tool_call/);

  const doubleAnswer = appendTurn(
    withToolCall(),
    { role: "tool", content: [{ type: "tool_result", callId: "c1", ok: true, result: 2 }] },
    T1,
  );
  assert.throws(() => validatePairing(doubleAnswer), /more than once/);
});

/* -------------------------------------------------------------------------- */
/* Meta                                                                        */
/* -------------------------------------------------------------------------- */

test("newMeta stamps the schema version and both timestamps", () => {
  const meta = newMeta({ id: "abc", projectName: "p", title: "T" }, T0);
  assert.equal(meta.schemaVersion, SCHEMA_VERSION);
  assert.equal(meta.createdAt, T0.toISOString());
  assert.equal(meta.updatedAt, T0.toISOString());
  assert.deepEqual(meta.modelsUsed, []);
});

test("touchMeta accumulates models used and bumps updatedAt", () => {
  const meta = newMeta({ id: "abc", projectName: "p", title: "T" }, T0);
  const turns = appendTurn(
    [],
    { role: "assistant", modelId: "claude-haiku-3.5", content: [{ type: "text", text: "hi" }] },
    T1,
  );
  const next = touchMeta(meta, turns, T1);

  assert.deepEqual(next.modelsUsed, ["claude-haiku-3.5"]);
  assert.equal(next.updatedAt, T1.toISOString());
  assert.equal(next.createdAt, T0.toISOString());
});

test("meta round-trips and rejects a malformed document", () => {
  const meta = newMeta({ id: "abc", projectName: "p", title: "T" }, T0);
  assert.deepEqual(parseMeta(serializeMeta(meta)), meta);
  assert.throws(() => parseMeta("{"), /not valid JSON/);
  assert.throws(() => parseMeta('{"id":"x"}'), /invalid/);
});

/* -------------------------------------------------------------------------- */
/* Write-path confinement (E-9.a)                                              */
/* -------------------------------------------------------------------------- */

test("conversationPaths stay under .idea/conversations", () => {
  const p = conversationPaths("abc123");
  for (const value of Object.values(p)) {
    assert.ok(value.startsWith(".idea/conversations/"), value);
  }
});

test("conversationPaths rejects traversal and unsafe ids", () => {
  for (const bad of ["../escape", "a/b", ".hidden", "", "a b", "-leading"]) {
    assert.throws(() => conversationPaths(bad), ConversationError, `should reject "${bad}"`);
  }
});
