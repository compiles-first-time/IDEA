import test from "node:test";
import assert from "node:assert/strict";

import { CONVERSATION_ROOT, parseTurns, transcriptHash } from "@/lib/conversation";
import {
  ConversationStoreError,
  MAX_APPEND_ATTEMPTS,
  appendConversationTurn,
  createConversation,
  describeRedactions,
  listConversations,
  loadConversation,
  type RepoFile,
  type RepoFileStore,
  type StoreContext,
} from "@/lib/conversation-store";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const LATER = new Date("2026-07-27T12:05:00.000Z");

/* -------------------------------------------------------------------------- */
/* In-memory backend — the seam that makes this testable without a network     */
/* -------------------------------------------------------------------------- */

class FakeStore implements RepoFileStore {
  files = new Map<string, RepoFile>();
  branches = new Set<string>();
  writable = true;
  /** Writes recorded in order, for asserting on paths and messages. */
  writes: Array<{ path: string; message: string; branch: string }> = [];
  /** Inject a failure on the Nth putFile call. */
  failNextPut: { status: number; times: number } | null = null;
  private seq = 0;

  async getFile(path: string) {
    return this.files.get(path) ?? null;
  }

  async putFile(args: { path: string; content: string; message: string; branch: string; sha?: string }) {
    if (this.failNextPut && this.failNextPut.times > 0) {
      this.failNextPut.times -= 1;
      throw Object.assign(new Error("simulated"), { status: this.failNextPut.status });
    }
    const current = this.files.get(args.path);
    if (current && current.sha !== args.sha) {
      throw Object.assign(new Error("sha mismatch"), { status: 409 });
    }
    const sha = `sha-${++this.seq}`;
    this.files.set(args.path, { content: args.content, sha });
    this.writes.push({ path: args.path, message: args.message, branch: args.branch });
    return { sha };
  }

  async listDir(path: string) {
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(`${path}/`)) continue;
      names.add(key.slice(path.length + 1).split("/")[0]);
    }
    return [...names].map((name) => ({ name, type: "dir" as const }));
  }

  async ensureBranch(branch: string) {
    this.branches.add(branch);
  }

  async canWrite() {
    return this.writable;
  }
}

function ctxWith(store = new FakeStore()): StoreContext & { store: FakeStore } {
  return { store, branch: "idea/conversations", projectName: "my-app" };
}

function text(body: string) {
  return { role: "user" as const, content: [{ type: "text" as const, text: body }] };
}

async function seeded() {
  const ctx = ctxWith();
  await createConversation(ctx, { id: "abc123", title: "First" }, NOW);
  return ctx;
}

/* -------------------------------------------------------------------------- */
/* Round trip — the layer-1 guarantee, end to end                              */
/* -------------------------------------------------------------------------- */

test("create → append → load round-trips with a verified hash", async () => {
  const ctx = await seeded();

  const a = await appendConversationTurn(ctx, "abc123", text("hello"), NOW);
  const b = await appendConversationTurn(
    ctx,
    "abc123",
    { role: "assistant", modelId: "claude-sonnet-5", content: [{ type: "text", text: "hi" }] },
    LATER,
  );

  const loaded = await loadConversation(ctx, "abc123");
  assert.equal(loaded.turns.length, 2);
  assert.deepEqual(
    loaded.turns.map((t) => t.seq),
    [0, 1],
  );
  assert.equal(transcriptHash(loaded.turns), b.transcriptHash);
  assert.notEqual(a.transcriptHash, b.transcriptHash, "the hash must move as turns are added");
});

test("meta tracks models used and updatedAt", async () => {
  const ctx = await seeded();
  await appendConversationTurn(
    ctx,
    "abc123",
    { role: "assistant", modelId: "claude-opus-5", content: [{ type: "text", text: "x" }] },
    LATER,
  );
  const { meta } = await loadConversation(ctx, "abc123");
  assert.deepEqual(meta.modelsUsed, ["claude-opus-5"]);
  assert.equal(meta.updatedAt, LATER.toISOString());
  assert.equal(meta.createdAt, NOW.toISOString());
});

test("a conversation with no turns yet loads as empty, not as an error", async () => {
  const ctx = await seeded();
  const loaded = await loadConversation(ctx, "abc123");
  assert.deepEqual(loaded.turns, []);
});

test("listing returns conversations newest-first", async () => {
  const ctx = ctxWith();
  await createConversation(ctx, { id: "old", title: "Old" }, NOW);
  await createConversation(ctx, { id: "new", title: "New" }, LATER);
  const list = await listConversations(ctx);
  assert.deepEqual(
    list.map((m) => m.id),
    ["new", "old"],
  );
});

test("a corrupt conversation does not hide the others", async () => {
  const ctx = await seeded();
  ctx.store.files.set(`${CONVERSATION_ROOT}/broken/meta.json`, { content: "{not json", sha: "s" });
  const list = await listConversations(ctx);
  assert.deepEqual(list.map((m) => m.id), ["abc123"]);
});

test("an empty store lists nothing rather than throwing", async () => {
  assert.deepEqual(await listConversations(ctxWith()), []);
});

/* -------------------------------------------------------------------------- */
/* Redaction cannot be bypassed (E-9.c)                                        */
/* -------------------------------------------------------------------------- */

test("a secret in a turn never reaches storage", async () => {
  const ctx = await seeded();
  const token = "ghp_" + "a".repeat(36);

  const r = await appendConversationTurn(ctx, "abc123", text(`my token is ${token}`), NOW);

  assert.equal(r.redactions.length > 0, true);
  const stored = ctx.store.files.get(`${CONVERSATION_ROOT}/abc123/turns.jsonl`)!;
  assert.equal(stored.content.includes(token), false, "the raw token must not be in the commit");
  assert.equal(JSON.stringify(r.turn).includes(token), false);
});

test("the session token can be passed as an extra secret and is redacted", async () => {
  const ctx = await seeded();
  const sessionToken = "gho_sessionvalue000000000000000000000";
  const r = await appendConversationTurn(
    ctx,
    "abc123",
    { role: "tool", content: [{ type: "tool_result", callId: "c1", ok: true, result: sessionToken }] },
    NOW,
    [sessionToken],
  );
  const stored = ctx.store.files.get(`${CONVERSATION_ROOT}/abc123/turns.jsonl`)!;
  assert.equal(stored.content.includes(sessionToken), false);
  assert.equal(r.redactions.length > 0, true);
});

test("redaction is surfaced to the caller, not applied silently", async () => {
  const ctx = await seeded();
  const r = await appendConversationTurn(ctx, "abc123", text("sk-ant-" + "q".repeat(30)), NOW);
  assert.match(describeRedactions(r) ?? "", /Redacted before saving/);
  assert.equal(r.turn.redacted, true);
});

test("a clean turn reports no redaction", async () => {
  const ctx = await seeded();
  const r = await appendConversationTurn(ctx, "abc123", text("just a normal message"), NOW);
  assert.equal(describeRedactions(r), null);
});

test("the commit message flags a redacted turn", async () => {
  const ctx = await seeded();
  await appendConversationTurn(ctx, "abc123", text("ghp_" + "z".repeat(36)), NOW);
  const turnWrite = ctx.store.writes.find((w) => w.path.endsWith("turns.jsonl"))!;
  assert.match(turnWrite.message, /redacted/);
});

test("there is no code path that writes an unredacted turn", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./conversation-store.ts", import.meta.url), "utf8"),
  );
  // The only serializeTurns call must be downstream of redactTurn.
  assert.equal((src.match(/serializeTurns\(/g) ?? []).length, 1);
  assert.ok(src.indexOf("redactTurn(") < src.indexOf("serializeTurns("));
  for (const bypass of ["skipRedaction", "raw: true", "noRedact"]) {
    assert.equal(src.includes(bypass), false, `no bypass named ${bypass}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Write-path confinement (E-9.a)                                              */
/* -------------------------------------------------------------------------- */

test("every write lands under .idea/conversations/", async () => {
  const ctx = await seeded();
  await appendConversationTurn(ctx, "abc123", text("hi"), NOW);
  assert.ok(ctx.store.writes.length >= 3);
  for (const w of ctx.store.writes) {
    assert.ok(w.path.startsWith(`${CONVERSATION_ROOT}/`), `wrote outside the carve-out: ${w.path}`);
  }
});

test("every write targets the conversations branch, never the default", async () => {
  const ctx = await seeded();
  await appendConversationTurn(ctx, "abc123", text("hi"), NOW);
  for (const w of ctx.store.writes) {
    assert.equal(w.branch, "idea/conversations");
    assert.notEqual(w.branch, "main");
  }
});

test("a traversing conversation id is rejected before any write", async () => {
  const ctx = ctxWith();
  await assert.rejects(() => createConversation(ctx, { id: "../escape", title: "x" }, NOW));
  assert.equal(ctx.store.writes.length, 0);
});

test("the branch is created before the first write", async () => {
  const ctx = ctxWith();
  await createConversation(ctx, { id: "abc", title: "T" }, NOW);
  assert.ok(ctx.store.branches.has("idea/conversations"));
});

/* -------------------------------------------------------------------------- */
/* Failures surface (E-9.d)                                                    */
/* -------------------------------------------------------------------------- */

test("no write access fails loudly rather than dropping the conversation", async () => {
  const ctx = ctxWith();
  ctx.store.writable = false;
  await assert.rejects(
    () => createConversation(ctx, { id: "abc", title: "T" }, NOW),
    (e: ConversationStoreError) => e.code === "no_write_access",
  );
});

test("a 403 on append surfaces as no_write_access, and the turn is not lost silently", async () => {
  const ctx = await seeded();
  ctx.store.failNextPut = { status: 403, times: 1 };
  await assert.rejects(
    () => appendConversationTurn(ctx, "abc123", text("hi"), NOW),
    (e: ConversationStoreError) => e.code === "no_write_access",
  );
});

test("appending to a missing conversation is a clear not_found", async () => {
  const ctx = ctxWith();
  await assert.rejects(
    () => appendConversationTurn(ctx, "ghost", text("hi"), NOW),
    (e: ConversationStoreError) => e.code === "not_found",
  );
});

test("loading a missing conversation is a clear not_found", async () => {
  await assert.rejects(
    () => loadConversation(ctxWith(), "ghost"),
    (e: ConversationStoreError) => e.code === "not_found",
  );
});

test("creating a duplicate conversation is a conflict, not an overwrite", async () => {
  const ctx = await seeded();
  await assert.rejects(
    () => createConversation(ctx, { id: "abc123", title: "Again" }, LATER),
    (e: ConversationStoreError) => e.code === "conflict",
  );
});

/* -------------------------------------------------------------------------- */
/* Concurrent appends                                                          */
/* -------------------------------------------------------------------------- */

test("a concurrent append conflict is retried and succeeds", async () => {
  const ctx = await seeded();
  await appendConversationTurn(ctx, "abc123", text("first"), NOW);

  ctx.store.failNextPut = { status: 409, times: 1 };
  const r = await appendConversationTurn(ctx, "abc123", text("second"), LATER);

  assert.equal(r.turn.seq, 1);
  const loaded = await loadConversation(ctx, "abc123");
  assert.equal(loaded.turns.length, 2, "the retry must not duplicate or drop the turn");
});

test("persistent conflict gives up with a message saying the turn was not saved", async () => {
  const ctx = await seeded();
  ctx.store.failNextPut = { status: 409, times: MAX_APPEND_ATTEMPTS };
  await assert.rejects(
    () => appendConversationTurn(ctx, "abc123", text("x"), NOW),
    (e: ConversationStoreError) => e.code === "conflict" && /was not saved/.test(e.message),
  );
});

test("sequence numbers stay contiguous across many appends", async () => {
  const ctx = await seeded();
  for (let i = 0; i < 12; i++) {
    await appendConversationTurn(ctx, "abc123", text(`turn ${i}`), NOW);
  }
  const loaded = await loadConversation(ctx, "abc123");
  assert.deepEqual(
    loaded.turns.map((t) => t.seq),
    Array.from({ length: 12 }, (_, i) => i),
  );
});

/* -------------------------------------------------------------------------- */
/* Storage shape                                                               */
/* -------------------------------------------------------------------------- */

test("turns are stored as append-only JSONL", async () => {
  const ctx = await seeded();
  await appendConversationTurn(ctx, "abc123", text("one"), NOW);
  await appendConversationTurn(ctx, "abc123", text("two"), LATER);

  const raw = ctx.store.files.get(`${CONVERSATION_ROOT}/abc123/turns.jsonl`)!.content;
  const lines = raw.trim().split("\n");
  assert.equal(lines.length, 2, "one line per turn keeps git diffs clean");
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  assert.equal(parseTurns(raw).length, 2);
});

test("an earlier turn's line is unchanged when a later one is appended", async () => {
  const ctx = await seeded();
  await appendConversationTurn(ctx, "abc123", text("one"), NOW);
  const afterFirst = ctx.store.files.get(`${CONVERSATION_ROOT}/abc123/turns.jsonl`)!.content;

  await appendConversationTurn(ctx, "abc123", text("two"), LATER);
  const afterSecond = ctx.store.files.get(`${CONVERSATION_ROOT}/abc123/turns.jsonl`)!.content;

  assert.ok(afterSecond.startsWith(afterFirst), "appends must not rewrite prior lines");
});
