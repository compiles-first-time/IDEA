import test from "node:test";
import assert from "node:assert/strict";

import { appendTurn, type CanonicalTurn, type NewTurn } from "@/lib/conversation";
import { contentHash } from "@/lib/hash";
import {
  ADAPTERS,
  adapterFor,
  familyForProvider,
  renderFor,
  unavailableContextNote,
  type Adapter,
  type ProviderMessage,
  type ProviderPart,
} from "@/lib/render";

/**
 * The conformance suite (S-24). Every adapter runs every fixture and must
 * satisfy the same invariants. Adding a provider means adding an adapter — not
 * a new test file.
 */

const T = new Date("2026-07-26T12:00:00.000Z");

function build(...turns: NewTurn[]): CanonicalTurn[] {
  let acc: CanonicalTurn[] = [];
  for (const t of turns) acc = appendTurn(acc, t, T);
  return acc;
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const FIXTURES: ReadonlyArray<{ name: string; turns: CanonicalTurn[] }> = [
  {
    name: "text only",
    turns: build(
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ),
  },
  {
    name: "multi tool",
    turns: build(
      { role: "user", content: [{ type: "text", text: "read two files" }] },
      {
        role: "assistant",
        content: [
          { type: "tool_call", id: "c1", tool: "read_repo_file", args: { path: "a.ts" } },
          { type: "tool_call", id: "c2", tool: "read_repo_file", args: { path: "b.ts" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool_result", callId: "c1", ok: true, result: "contents of a" },
          { type: "tool_result", callId: "c2", ok: true, result: "contents of b" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ),
  },
  {
    name: "interleaved tool and text",
    turns: build(
      { role: "user", content: [{ type: "text", text: "investigate" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool_call", id: "c1", tool: "list_repo_tree", args: {} },
        ],
      },
      { role: "tool", content: [{ type: "tool_result", callId: "c1", ok: true, result: ["a.ts"] }] },
    ),
  },
  {
    name: "repo context",
    turns: build({
      role: "user",
      content: [
        { type: "text", text: "explain this" },
        {
          type: "repo_context",
          owner: "o",
          repo: "r",
          path: "auth.ts",
          sha: "sha-present",
          bytes: 12,
          contentHash: "sha256:x",
        },
      ],
    }),
  },
  {
    name: "thinking blocks",
    turns: build(
      { role: "user", content: [{ type: "text", text: "think hard" }] },
      {
        role: "assistant",
        content: [
          { type: "provider_artifact", provider: "anthropic", kind: "thinking", data: { text: "hmm" } },
          { type: "provider_artifact", provider: "openai", kind: "refusal", data: { text: "no" } },
          { type: "text", text: "the answer" },
        ],
      },
    ),
  },
  {
    name: "200 turns",
    turns: build(
      ...Array.from({ length: 200 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: [{ type: "text" as const, text: `turn ${i}` }],
      })),
    ),
  },
];

const CONTEXT = new Map([["sha-present", "export const auth = 1;"]]);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function allParts(messages: readonly ProviderMessage[]): ProviderPart[] {
  return messages.flatMap((m) => m.content);
}

function allText(messages: readonly ProviderMessage[]): string {
  return allParts(messages)
    .filter((p): p is Extract<ProviderPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function canonicalTexts(turns: readonly CanonicalTurn[]): string[] {
  return turns.flatMap((t) =>
    t.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text),
  );
}

function toolCalls(turns: readonly CanonicalTurn[]) {
  return turns.flatMap((t) =>
    t.content.filter((p) => p.type === "tool_call").map((p) => p as { id: string; tool: string }),
  );
}

function toolResults(turns: readonly CanonicalTurn[]) {
  return turns.flatMap((t) =>
    t.content.filter((p) => p.type === "tool_result").map((p) => p as { callId: string }),
  );
}

/* -------------------------------------------------------------------------- */
/* The suite — every adapter × every fixture                                   */
/* -------------------------------------------------------------------------- */

for (const adapter of Object.values(ADAPTERS) as Adapter[]) {
  for (const fixture of FIXTURES) {
    const label = `[${adapter.id}] ${fixture.name}`;

    test(`${label}: every message maps to a declared role`, () => {
      const { messages } = adapter.render(fixture.turns, { system: "sys", contextBySha: CONTEXT });
      const declared = new Set<string>([...Object.values(adapter.roleMap), "system"]);
      for (const m of messages) {
        assert.ok(declared.has(m.role), `undeclared role "${m.role}"`);
      }
    });

    test(`${label}: role sequence follows the declared mapping`, () => {
      const { messages } = adapter.render(fixture.turns, { contextBySha: CONTEXT });
      const expected = fixture.turns.map((t) => adapter.roleMap[t.role]);
      const actual = messages.filter((m) => m.role !== "system").map((m) => m.role);
      assert.deepEqual(actual, expected);
    });

    test(`${label}: message count is preserved`, () => {
      const withoutSystem = adapter.render(fixture.turns, { contextBySha: CONTEXT }).messages.filter(
        (m) => m.role !== "system",
      );
      assert.equal(withoutSystem.length, fixture.turns.length);
    });

    test(`${label}: no text content is lost`, () => {
      const { messages } = adapter.render(fixture.turns, { contextBySha: CONTEXT });
      const rendered = allText(messages);
      for (const text of canonicalTexts(fixture.turns)) {
        assert.ok(rendered.includes(text), `lost text: ${JSON.stringify(text)}`);
      }
    });

    test(`${label}: tool information survives`, () => {
      const { messages } = adapter.render(fixture.turns, { contextBySha: CONTEXT });
      const calls = toolCalls(fixture.turns);
      const results = toolResults(fixture.turns);

      if (adapter.supportsTools) {
        // Structured: every call and result is present, and pairs still match.
        const renderedCalls = allParts(messages).filter((p) => p.type === "tool-call");
        const renderedResults = allParts(messages).filter((p) => p.type === "tool-result");
        assert.equal(renderedCalls.length, calls.length);
        assert.equal(renderedResults.length, results.length);

        const callIds = new Set(
          renderedCalls.map((p) => (p as { toolCallId: string }).toolCallId),
        );
        for (const r of renderedResults) {
          const id = (r as { toolCallId: string }).toolCallId;
          assert.ok(callIds.has(id), `orphaned tool result ${id}`);
        }
      } else {
        // Flattened: tool structure is preserved as prose, not dropped.
        const text = allText(messages);
        for (const c of calls) assert.ok(text.includes(c.tool), `lost tool name ${c.tool}`);
        for (const r of results) assert.ok(text.includes(r.callId), `lost result ${r.callId}`);
      }
    });

    test(`${label}: foreign provider artifacts never leak`, () => {
      const { messages } = adapter.render(fixture.turns, { contextBySha: CONTEXT });
      const serialized = JSON.stringify(messages);
      // "refusal" only ever appears in an openai artifact, which no adapter keeps.
      assert.equal(serialized.includes("refusal"), false, "foreign artifact leaked");
      if (adapter.id !== "anthropic") {
        assert.equal(
          messages.some((m) => m.content.some((p) => p.type === "reasoning")),
          false,
          "reasoning must not survive outside anthropic",
        );
      }
    });

    test(`${label}: rendering is deterministic`, () => {
      const a = adapter.render(fixture.turns, { system: "s", contextBySha: CONTEXT });
      const b = adapter.render(fixture.turns, { system: "s", contextBySha: CONTEXT });
      assert.equal(contentHash(JSON.stringify(a)), contentHash(JSON.stringify(b)));
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Adapter-specific behaviour                                                  */
/* -------------------------------------------------------------------------- */

test("anthropic carries the system prompt out of band", () => {
  const r = renderFor("anthropic", FIXTURES[0].turns, { system: "be terse" });
  assert.equal(r.system, "be terse");
  assert.equal(
    r.messages.some((m) => m.role === "system"),
    false,
  );
});

test("openai-compatible emits the system prompt as the first message", () => {
  const r = renderFor("openai-compatible", FIXTURES[0].turns, { system: "be terse" });
  assert.equal(r.system, undefined);
  assert.equal(r.messages[0].role, "system");
  assert.deepEqual(r.messages[0].content, [{ type: "text", text: "be terse" }]);
});

test("anthropic preserves its own thinking blocks", () => {
  const r = renderFor("anthropic", FIXTURES[4].turns);
  assert.ok(r.messages.some((m) => m.content.some((p) => p.type === "reasoning")));
});

test("anthropic routes tool results into user turns", () => {
  const r = renderFor("anthropic", FIXTURES[1].turns);
  const toolMsg = r.messages[2];
  assert.equal(toolMsg.role, "user");
  assert.ok(toolMsg.content.every((p) => p.type === "tool-result"));
});

test("generic-text produces exactly one text part per turn", () => {
  const r = renderFor("generic-text", FIXTURES[2].turns);
  for (const m of r.messages.filter((m) => m.role !== "system")) {
    assert.equal(m.content.length, 1);
    assert.equal(m.content[0].type, "text");
  }
});

/* -------------------------------------------------------------------------- */
/* Pinned context                                                              */
/* -------------------------------------------------------------------------- */

test("resolved repo context is rendered with its pin", () => {
  for (const family of Object.keys(ADAPTERS) as Array<keyof typeof ADAPTERS>) {
    const text = allText(renderFor(family, FIXTURES[3].turns, { contextBySha: CONTEXT }).messages);
    assert.ok(text.includes("export const auth = 1;"), `${family} lost context body`);
    assert.ok(text.includes("sha-present"), `${family} lost the pin`);
  }
});

test("unresolvable repo context renders an explicit note, never current content", () => {
  for (const family of Object.keys(ADAPTERS) as Array<keyof typeof ADAPTERS>) {
    const text = allText(renderFor(family, FIXTURES[3].turns, { contextBySha: new Map() }).messages);
    assert.ok(
      text.includes(unavailableContextNote("o", "r", "auth.ts", "sha-present")),
      `${family} should flag the unavailable pin`,
    );
    assert.equal(text.includes("export const auth = 1;"), false);
  }
});

/* -------------------------------------------------------------------------- */
/* FR-9.5 — the cross-provider guarantee                                       */
/* -------------------------------------------------------------------------- */

test("FR-9.5: one transcript renders for every provider, satisfying every invariant", () => {
  const turns = FIXTURES[1].turns; // the tool-heavy fixture
  const families = Object.keys(ADAPTERS) as Array<keyof typeof ADAPTERS>;
  const rendered = families.map((f) => ({ f, r: renderFor(f, turns, { contextBySha: CONTEXT }) }));

  for (const { f, r } of rendered) {
    const nonSystem = r.messages.filter((m) => m.role !== "system");
    assert.equal(nonSystem.length, turns.length, `${f} changed message count`);
    for (const text of canonicalTexts(turns)) {
      assert.ok(allText(r.messages).includes(text), `${f} lost text`);
    }
  }
});

test("adapterFor rejects an unknown family and familyForProvider maps registry ids", () => {
  assert.equal(familyForProvider("anthropic"), "anthropic");
  assert.equal(familyForProvider("openai"), "openai-compatible");
  assert.equal(familyForProvider("local"), "openai-compatible");
  assert.equal(familyForProvider("something-new"), "generic-text");
  // @ts-expect-error — exercising the runtime guard
  assert.throws(() => adapterFor("nope"), /no render adapter/);
});
