import { z } from "zod";

import { RoutingDecision, SpendRecord } from "@/lib/contracts/routing";
import { contentHash } from "@/lib/hash";

/**
 * Canonical, provider-neutral conversation format (S-23, FR-9.3).
 *
 * This is the archive shape — deliberately owned by no vendor, so a conversation
 * started on one model can be replayed on another (FR-9.5). Provider-specific
 * payloads live in `provider_artifact` parts, which are preserved on write and
 * dropped when rendering for a different provider.
 *
 * Stored in the project repo as:
 *   .idea/conversations/<id>/meta.json     ConversationMeta
 *   .idea/conversations/<id>/turns.jsonl   one CanonicalTurn per line, append-only
 *
 * JSONL and append-only are deliberate: appends produce clean git diffs instead
 * of rewriting the whole file every turn.
 */
export const SCHEMA_VERSION = 1;

export const CanonicalPart = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("repo_context"),
    owner: z.string().min(1),
    repo: z.string().min(1),
    path: z.string().min(1),
    /**
     * Required, not optional. Unpinned context makes a stored conversation
     * unreproducible and there is no backfill for a SHA never recorded (FR-9.4).
     */
    sha: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    contentHash: z.string().min(1),
  }),
  z.object({
    type: z.literal("tool_call"),
    id: z.string().min(1),
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("tool_result"),
    callId: z.string().min(1),
    ok: z.boolean(),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("provider_artifact"),
    provider: z.string().min(1),
    kind: z.string().min(1),
    data: z.unknown(),
  }),
]);

export const CanonicalTurn = z.object({
  seq: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant", "tool"]),
  /** ISO 8601, server-stamped. Client-supplied values are overwritten on append. */
  ts: z.string().min(1),
  content: z.array(CanonicalPart),
  modelId: z.string().optional(),
  routingDecision: RoutingDecision.optional(),
  spend: SpendRecord.optional(),
  /** Set when S-26 redacted something from this turn, so the UI can mark it. */
  redacted: z.boolean().optional(),
});

export const ConversationMeta = z.object({
  id: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  projectName: z.string().min(1),
  title: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  modelsUsed: z.array(z.string()).default([]),
});

export type CanonicalPart = z.infer<typeof CanonicalPart>;
export type CanonicalTurn = z.infer<typeof CanonicalTurn>;
export type ConversationMeta = z.infer<typeof ConversationMeta>;

export class ConversationError extends Error {}

/* -------------------------------------------------------------------------- */
/* Pairing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every `tool_result` must answer a `tool_call` that came before it, and every
 * call must be answered. Adapters (S-24) and compaction (S-28) both rely on this
 * holding, so it is checked once here rather than defensively everywhere.
 */
export function validatePairing(turns: readonly CanonicalTurn[]): void {
  const open = new Map<string, number>();
  const answered = new Set<string>();

  for (const turn of turns) {
    for (const part of turn.content) {
      if (part.type === "tool_call") {
        if (open.has(part.id)) {
          throw new ConversationError(`duplicate tool_call id "${part.id}" at seq ${turn.seq}`);
        }
        open.set(part.id, turn.seq);
      } else if (part.type === "tool_result") {
        if (!open.has(part.callId)) {
          throw new ConversationError(
            `tool_result at seq ${turn.seq} references unknown call "${part.callId}"`,
          );
        }
        if (answered.has(part.callId)) {
          throw new ConversationError(`tool_call "${part.callId}" answered more than once`);
        }
        answered.add(part.callId);
      }
    }
  }

  for (const [id, seq] of open) {
    if (!answered.has(id)) {
      throw new ConversationError(`tool_call "${id}" at seq ${seq} has no tool_result`);
    }
  }
}

/** Non-throwing variant — used mid-stream, where a call is legitimately open. */
export function pairingErrors(turns: readonly CanonicalTurn[]): string[] {
  try {
    validatePairing(turns);
    return [];
  } catch (e) {
    return [(e as Error).message];
  }
}

/* -------------------------------------------------------------------------- */
/* Append-only surface                                                          */
/* -------------------------------------------------------------------------- */

/** A turn as supplied by a caller: no `seq`, and `ts` is stamped here. */
export type NewTurn = Omit<z.input<typeof CanonicalTurn>, "seq" | "ts">;

/**
 * Append a turn, assigning the next `seq` and stamping `ts` server-side.
 *
 * There is deliberately no `updateTurn` or `deleteTurn` — the archive is
 * append-only, which is what makes the transcript integrity guarantee (layer 1)
 * meaningful. Returns a new array; the input is not mutated.
 */
export function appendTurn(
  turns: readonly CanonicalTurn[],
  turn: NewTurn,
  now: Date,
): CanonicalTurn[] {
  const seq = turns.length === 0 ? 0 : turns[turns.length - 1].seq + 1;
  const parsed = CanonicalTurn.parse({ ...turn, seq, ts: now.toISOString() });
  return [...turns, parsed];
}

export function newMeta(
  input: { id: string; projectName: string; title: string },
  now: Date,
): ConversationMeta {
  const ts = now.toISOString();
  return ConversationMeta.parse({
    ...input,
    schemaVersion: SCHEMA_VERSION,
    createdAt: ts,
    updatedAt: ts,
    modelsUsed: [],
  });
}

/** Refresh `updatedAt` and accumulate `modelsUsed` from the stored turns. */
export function touchMeta(
  meta: ConversationMeta,
  turns: readonly CanonicalTurn[],
  now: Date,
): ConversationMeta {
  const models = new Set(meta.modelsUsed);
  for (const t of turns) if (t.modelId) models.add(t.modelId);
  return { ...meta, updatedAt: now.toISOString(), modelsUsed: [...models].sort() };
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                                */
/* -------------------------------------------------------------------------- */

export function serializeTurns(turns: readonly CanonicalTurn[]): string {
  return turns.map((t) => JSON.stringify(t)).join("\n") + (turns.length ? "\n" : "");
}

export function parseTurns(jsonl: string): CanonicalTurn[] {
  const lines = jsonl.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new ConversationError(`turns.jsonl line ${i + 1} is not valid JSON`);
    }
    const result = CanonicalTurn.safeParse(raw);
    if (!result.success) {
      throw new ConversationError(
        `turns.jsonl line ${i + 1} is not a valid turn: ${result.error.issues
          .map((iss) => `${iss.path.join(".")} ${iss.message}`)
          .join("; ")}`,
      );
    }
    return result.data;
  });
}

export function serializeMeta(meta: ConversationMeta): string {
  return JSON.stringify(meta, null, 2) + "\n";
}

export function parseMeta(json: string): ConversationMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ConversationError("meta.json is not valid JSON");
  }
  const result = ConversationMeta.safeParse(raw);
  if (!result.success) {
    throw new ConversationError(
      `meta.json is invalid: ${result.error.issues
        .map((iss) => `${iss.path.join(".")} ${iss.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/**
 * Hash of the serialized transcript. The layer-1 integrity guarantee is proven by
 * asserting this is unchanged across a serialize/parse round trip.
 */
export function transcriptHash(turns: readonly CanonicalTurn[]): string {
  return contentHash(serializeTurns(turns));
}

/* -------------------------------------------------------------------------- */
/* Paths                                                                        */
/* -------------------------------------------------------------------------- */

export const CONVERSATION_ROOT = ".idea/conversations";

/** Every write path IDEA is permitted to touch lives under this prefix (E-9.a). */
export function conversationPaths(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new ConversationError(`unsafe conversation id "${id}"`);
  }
  return {
    dir: `${CONVERSATION_ROOT}/${id}`,
    meta: `${CONVERSATION_ROOT}/${id}/meta.json`,
    turns: `${CONVERSATION_ROOT}/${id}/turns.jsonl`,
  };
}
