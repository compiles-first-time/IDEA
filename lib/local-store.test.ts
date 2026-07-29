import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendConversationTurn,
  createConversation,
  listConversations,
  loadConversation,
  type StoreContext,
} from "@/lib/conversation-store";
import { localStore } from "@/lib/local-store";

const NOW = new Date("2026-07-29T10:00:00Z");

async function project(): Promise<{ root: string; ctx: StoreContext }> {
  const root = await mkdtemp(join(tmpdir(), "idea-local-store-"));
  return {
    root,
    ctx: {
      store: localStore({ projectRoot: root }),
      branch: "idea/conversations",
      projectName: "demo",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The case the store exists for: a brand-new project                          */
/* -------------------------------------------------------------------------- */

test("a project with no conversations directory can still be written to", async (t) => {
  // loom-template ships no conversations folder, so a store that assumes one
  // fails on exactly the case it exists for.
  const { root, ctx } = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.equal(await ctx.store.canWrite(), true, "an empty project is writable");
  const meta = await createConversation(ctx, { id: "c1", title: "First" }, NOW);
  assert.equal(meta.id, "c1");

  const listed = await listConversations(ctx);
  assert.deepEqual(
    listed.map((c) => c.id),
    ["c1"],
  );
});

test("listing a project that has never chatted returns empty, not an error", async (t) => {
  const { root, ctx } = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await listConversations(ctx), []);
});

/* -------------------------------------------------------------------------- */
/* Round-trip                                                                  */
/* -------------------------------------------------------------------------- */

test("a turn survives being written and read back", async (t) => {
  const { root, ctx } = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  await createConversation(ctx, { id: "c1", title: "First" }, NOW);
  await appendConversationTurn(
    ctx,
    "c1",
    { role: "user", content: [{ type: "text", text: "hello there" }] },
    NOW,
  );

  const loaded = await loadConversation(ctx, "c1");
  assert.equal(loaded.turns.length, 1);
  assert.equal(loaded.turns[0].role, "user");
});

test("conversations land under .idea/conversations in the project itself", async (t) => {
  const { root, ctx } = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  await createConversation(ctx, { id: "c1", title: "First" }, NOW);
  const meta = await readFile(join(root, ".idea", "conversations", "c1", "meta.json"), "utf8");
  assert.match(meta, /"id": ?"c1"/);
});

test("several conversations coexist in one project", async (t) => {
  const { root, ctx } = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  await createConversation(ctx, { id: "a", title: "A" }, NOW);
  await createConversation(ctx, { id: "b", title: "B" }, NOW);

  const ids = (await listConversations(ctx)).map((c) => c.id).sort();
  assert.deepEqual(ids, ["a", "b"]);
});

/* -------------------------------------------------------------------------- */
/* Safety                                                                      */
/* -------------------------------------------------------------------------- */

test("a stale sha is a conflict, so two tabs cannot silently lose a turn", async (t) => {
  const { root, ctx } = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  await ctx.store.putFile({
    path: ".idea/conversations/x/turns.jsonl",
    content: "one\n",
    message: "m",
    branch: "b",
  });
  const current = await ctx.store.getFile(".idea/conversations/x/turns.jsonl", "b");

  await ctx.store.putFile({
    path: ".idea/conversations/x/turns.jsonl",
    content: "two\n",
    message: "m",
    branch: "b",
    sha: current!.sha,
  });

  await assert.rejects(
    ctx.store.putFile({
      path: ".idea/conversations/x/turns.jsonl",
      content: "three\n",
      message: "m",
      branch: "b",
      sha: current!.sha, // the sha we read is no longer current
    }),
    /sha mismatch/,
  );
});

test("a path escaping the project root is refused", async (t) => {
  const { root, ctx } = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    ctx.store.putFile({
      path: "../../escape.txt",
      content: "x",
      message: "m",
      branch: "b",
    }),
    /outside the project/,
  );
});

test("secrets are redacted before they are written (E-9.c)", async (t) => {
  const { root, ctx } = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  await createConversation(ctx, { id: "c1", title: "First" }, NOW);
  await appendConversationTurn(
    ctx,
    "c1",
    {
      role: "user",
      content: [{ type: "text", text: "my key is ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ok" }],
    },
    NOW,
  );

  const onDisk = await readFile(
    join(root, ".idea", "conversations", "c1", "turns.jsonl"),
    "utf8",
  );
  assert.doesNotMatch(
    onDisk,
    /ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/,
    "a secret on disk means rotating the credential — redaction is unconditional",
  );
});
