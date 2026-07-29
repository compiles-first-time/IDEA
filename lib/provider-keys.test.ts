import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KeyInput, keyStatuses, saveKey } from "@/lib/provider-keys";

async function workspace(env = ""): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "idea-keys-"));
  if (env) await writeFile(join(dir, ".env.local"), env, "utf8");
  return dir;
}

const KEY = "sk-ant-api03-REALSECRETVALUE9999";

test("a key round-trips into .env.local under the right variable", async (t) => {
  const dir = await workspace("AUTH_SECRET=abc\n");
  t.after(() => rm(dir, { recursive: true, force: true }));

  await saveKey({ provider: "anthropic", key: KEY }, dir);
  const text = await readFile(join(dir, ".env.local"), "utf8");
  assert.match(text, new RegExp(`^ANTHROPIC_API_KEY=${KEY}$`, "m"));
});

test("existing lines survive — the file holds the session secret and allowlist", async (t) => {
  const dir = await workspace("AUTH_SECRET=abc\nALLOWED_LOGINS=someone\n");
  t.after(() => rm(dir, { recursive: true, force: true }));

  await saveKey({ provider: "anthropic", key: KEY }, dir);
  const text = await readFile(join(dir, ".env.local"), "utf8");
  assert.match(text, /^AUTH_SECRET=abc$/m, "losing this signs everyone out");
  assert.match(text, /^ALLOWED_LOGINS=someone$/m, "losing this locks everyone out");
});

test("saving twice replaces rather than appends a second line", async (t) => {
  const dir = await workspace();
  t.after(() => rm(dir, { recursive: true, force: true }));

  await saveKey({ provider: "anthropic", key: "sk-ant-first000000" }, dir);
  await saveKey({ provider: "anthropic", key: "sk-ant-second00000" }, dir);

  const text = await readFile(join(dir, ".env.local"), "utf8");
  const hits = text.split("\n").filter((l) => l.startsWith("ANTHROPIC_API_KEY="));
  assert.equal(hits.length, 1, "a duplicate line makes which-one-wins ambiguous");
  assert.match(hits[0], /second/);
});

test("status reports only the last four characters — never the key", async (t) => {
  const dir = await workspace();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const statuses = await saveKey({ provider: "anthropic", key: KEY }, dir);
  const anthropic = statuses.find((s) => s.provider === "anthropic")!;

  assert.equal(anthropic.configured, true);
  assert.equal(anthropic.hint, "9999");
  assert.doesNotMatch(
    JSON.stringify(statuses),
    /REALSECRETVALUE/,
    "the key must never appear in anything a route can return (NFR-6)",
  );
});

test("an unset provider reports not configured, with no hint", async (t) => {
  const dir = await workspace();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const statuses = await keyStatuses(dir, {});
  for (const s of statuses) {
    assert.equal(s.configured, false);
    assert.equal(s.hint, null);
  }
});

test("a pasted key's trailing whitespace is trimmed", () => {
  // Pasted keys routinely carry a newline; failing only because of whitespace is
  // the worst kind of wrong, because the key looks correct on screen.
  const parsed = KeyInput.parse({ provider: "anthropic", key: `  ${KEY}\n` });
  assert.equal(parsed.key, KEY);
});

test("an obviously-too-short value is rejected before it is written", () => {
  const result = KeyInput.safeParse({ provider: "anthropic", key: "abc" });
  assert.equal(result.success, false);
});

test("an unknown provider is refused rather than writing a stray variable", () => {
  assert.equal(KeyInput.safeParse({ provider: "acme", key: KEY }).success, false);
});
