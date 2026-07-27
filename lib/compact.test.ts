import test from "node:test";
import assert from "node:assert/strict";

import { appendTurn, validatePairing, type CanonicalTurn, type NewTurn } from "@/lib/conversation";
import {
  RESPONSE_HEADROOM,
  applyPlan,
  describeFidelity,
  groupTurns,
  planFit,
  transcriptTokens,
  turnTokens,
} from "@/lib/compact";

const T = new Date("2026-07-26T12:00:00.000Z");

function build(...turns: NewTurn[]): CanonicalTurn[] {
  let acc: CanonicalTurn[] = [];
  for (const t of turns) acc = appendTurn(acc, t, T);
  return acc;
}

function text(role: "user" | "assistant", body: string): NewTurn {
  return { role, content: [{ type: "text", text: body }] };
}

/** ~250 tokens per turn at 4 chars/token. */
function chunky(role: "user" | "assistant", i: number): NewTurn {
  return text(role, `turn ${i} ` + "x".repeat(1000));
}

const SMALL = { modelId: "small", contextWindow: 2000 };
const BIG = { modelId: "big", contextWindow: 1_000_000 };

/* -------------------------------------------------------------------------- */
/* Fits                                                                        */
/* -------------------------------------------------------------------------- */

test("a transcript that fits is returned untouched at full fidelity", () => {
  const turns = build(text("user", "hello"), text("assistant", "hi"));
  const plan = planFit(turns, BIG);

  assert.equal(plan.strategy, "full");
  assert.equal(plan.fidelity.level, "full");
  assert.equal(plan.fidelity.pct, 100);
  assert.deepEqual(plan.fidelity.lost, []);
  assert.deepEqual(plan.keptSeqs, [0, 1]);
  assert.deepEqual(applyPlan(turns, plan), turns);
});

test("an empty transcript plans cleanly", () => {
  const plan = planFit([], SMALL);
  assert.equal(plan.strategy, "full");
  assert.equal(plan.estTokensBefore, 0);
  assert.equal(plan.fidelity.pct, 100);
});

test("every resume produces a fidelity record, including full ones (NFR-5)", () => {
  const plan = planFit(build(text("user", "hi")), BIG);
  assert.ok(plan.fidelity, "uniformity is what makes the record auditable");
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

test("planning is deterministic", () => {
  const turns = build(...Array.from({ length: 30 }, (_, i) => chunky("user", i)));
  assert.deepEqual(planFit(turns, SMALL), planFit(turns, SMALL));
});

test("planning makes no model call — the module is pure", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./compact.ts", import.meta.url), "utf8"),
  );
  for (const banned of ["streamText", "generateText", "fetch(", "anthropic("]) {
    assert.equal(src.includes(banned), false, `compact.ts must not contain ${banned}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Doesn't fit                                                                 */
/* -------------------------------------------------------------------------- */

test("an oversized transcript compacts and reports partial fidelity", () => {
  const turns = build(...Array.from({ length: 40 }, (_, i) => chunky("user", i)));
  const plan = planFit(turns, SMALL);

  assert.notEqual(plan.strategy, "full");
  assert.equal(plan.fidelity.level, "partial");
  assert.ok(plan.fidelity.pct < 100);
  assert.ok(plan.estTokensAfter < plan.estTokensBefore);
  assert.ok(plan.droppedSeqs.length > 0);
});

test("compaction respects the response headroom, not the raw window", () => {
  const turns = build(...Array.from({ length: 40 }, (_, i) => chunky("user", i)));
  const plan = planFit(turns, SMALL);
  const budget = SMALL.contextWindow * (1 - RESPONSE_HEADROOM);
  assert.ok(plan.estTokensAfter <= budget, `${plan.estTokensAfter} must fit ${budget}`);
});

test("the most recent turns survive compaction", () => {
  const turns = build(...Array.from({ length: 40 }, (_, i) => chunky("user", i)));
  const plan = planFit(turns, SMALL);
  const lastSeq = turns[turns.length - 1].seq;
  assert.ok(plan.keptSeqs.includes(lastSeq), "the newest turn must always survive");
});

test("allowSummary switches the strategy without changing what is compacted", () => {
  const turns = build(...Array.from({ length: 40 }, (_, i) => chunky("user", i)));
  const truncated = planFit(turns, SMALL);
  const summarized = planFit(turns, SMALL, { allowSummary: true });

  assert.equal(truncated.strategy, "truncate");
  assert.equal(summarized.strategy, "summarize");
  assert.deepEqual(truncated.droppedSeqs, summarized.summarizedSeqs);
  assert.deepEqual(summarized.keptSeqs, truncated.keptSeqs);
});

test("a transcript larger than any available model still yields a usable plan", () => {
  const turns = build(...Array.from({ length: 500 }, (_, i) => chunky("user", i)));
  const plan = planFit(turns, { modelId: "tiny", contextWindow: 100 });
  assert.equal(plan.fidelity.level, "partial");
  assert.doesNotThrow(() => applyPlan(turns, plan));
});

/* -------------------------------------------------------------------------- */
/* Tool pairing is never broken                                                */
/* -------------------------------------------------------------------------- */

function interleaved(): CanonicalTurn[] {
  const parts: NewTurn[] = [];
  for (let i = 0; i < 12; i++) {
    parts.push(text("user", `ask ${i} ` + "y".repeat(600)));
    parts.push({
      role: "assistant",
      content: [{ type: "tool_call", id: `c${i}`, tool: "read_repo_file", args: { i } }],
    });
    parts.push({
      role: "tool",
      content: [{ type: "tool_result", callId: `c${i}`, ok: true, result: "z".repeat(600) }],
    });
  }
  return build(...parts);
}

test("compaction never orphans a tool call from its result", () => {
  const turns = interleaved();
  const plan = planFit(turns, SMALL);
  const kept = applyPlan(turns, plan);

  assert.ok(kept.length > 0);
  assert.doesNotThrow(() => validatePairing(kept), "kept turns must still pair correctly");
});

test("groupTurns keeps a call and its result in one group", () => {
  const groups = groupTurns(interleaved());
  for (const g of groups) {
    const calls = g.flatMap((t) => t.content.filter((p) => p.type === "tool_call"));
    const results = g.flatMap((t) => t.content.filter((p) => p.type === "tool_result"));
    assert.equal(calls.length, results.length, "each group must be self-contained");
  }
});

test("a dangling call at the tail still forms a group rather than vanishing", () => {
  const turns = build(
    text("user", "go"),
    { role: "assistant", content: [{ type: "tool_call", id: "x", tool: "t", args: {} }] },
  );
  const groups = groupTurns(turns);
  assert.equal(groups.flat().length, turns.length);
});

/* -------------------------------------------------------------------------- */
/* Repo context: unavailable vs dropped                                        */
/* -------------------------------------------------------------------------- */

function withContext(): CanonicalTurn[] {
  return build({
    role: "user",
    content: [
      { type: "text", text: "explain" },
      {
        type: "repo_context",
        owner: "o",
        repo: "r",
        path: "auth.ts",
        sha: "gone",
        bytes: 100,
        contentHash: "h",
      },
    ],
  });
}

test("an unresolvable pin is reported as unavailable, not as dropped for size", () => {
  const plan = planFit(withContext(), BIG, { unavailableShas: new Set(["gone"]) });

  assert.equal(plan.fidelity.level, "partial");
  assert.ok(plan.fidelity.lost.some((l) => l.includes("unavailable")));
  assert.equal(
    plan.fidelity.lost.some((l) => l.includes("dropped for size")),
    false,
    "different cause, different user action — these must not be conflated",
  );
});

test("a resolvable pin costs nothing in fidelity", () => {
  const plan = planFit(withContext(), BIG);
  assert.equal(plan.fidelity.level, "full");
});

test("dropped file contexts are counted separately in the report", () => {
  const many: NewTurn[] = [];
  for (let i = 0; i < 30; i++) {
    many.push({
      role: "user",
      content: [
        { type: "text", text: "x".repeat(400) },
        {
          type: "repo_context",
          owner: "o",
          repo: "r",
          path: `f${i}.ts`,
          sha: `s${i}`,
          bytes: 800,
          contentHash: "h",
        },
      ],
    });
  }
  const plan = planFit(build(...many), SMALL);
  assert.ok(plan.fidelity.lost.some((l) => /file contexts? dropped for size/.test(l)));
});

/* -------------------------------------------------------------------------- */
/* Token accounting                                                            */
/* -------------------------------------------------------------------------- */

test("provider artifacts cost nothing — they are dropped when rendering anyway", () => {
  const turn = build({
    role: "assistant",
    content: [{ type: "provider_artifact", provider: "anthropic", kind: "thinking", data: { text: "x".repeat(4000) } }],
  })[0];
  assert.equal(turnTokens(turn), 0);
});

test("repo context is sized by its byte count, not by its identifiers", () => {
  const turn = withContext()[0];
  assert.ok(turnTokens(turn) >= 25, "100 bytes ≈ 25 tokens plus the text part");
});

test("transcriptTokens sums turns", () => {
  const turns = build(text("user", "a".repeat(400)), text("assistant", "b".repeat(400)));
  assert.equal(transcriptTokens(turns), turnTokens(turns[0]) + turnTokens(turns[1]));
});

/* -------------------------------------------------------------------------- */
/* Reporting                                                                   */
/* -------------------------------------------------------------------------- */

test("describeFidelity states full context plainly", () => {
  const plan = planFit(build(text("user", "hi")), BIG);
  assert.equal(describeFidelity(plan, "Opus 5"), "Resumed on Opus 5 — full context.");
});

test("describeFidelity enumerates what was lost, not just a percentage", () => {
  const turns = build(...Array.from({ length: 40 }, (_, i) => chunky("user", i)));
  const line = describeFidelity(planFit(turns, SMALL), "Haiku 4.5");

  assert.match(line, /compacted/);
  assert.match(line, /→/);
  assert.match(line, /turns dropped/);
  assert.match(line, /% retained/);
});
