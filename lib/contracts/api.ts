import { z } from "zod";

import { RoutingDecision, SpendRecord, Tier } from "@/lib/contracts/routing";

/**
 * HTTP contracts for IDEA's own routes. Requests are parsed against these;
 * responses are validated before they are sent.
 */

/** A model as exposed to the browser. `endpoint` is deliberately omitted. */
export const PublicModel = z.object({
  id: z.string(),
  provider: z.enum(["anthropic", "openai", "local", "google", "other"]),
  label: z.string(),
  tier: Tier,
  inputWeight: z.number(),
  outputWeight: z.number(),
  contextWindow: z.number().int().positive(),
});

export const ModelsResponse = z.object({
  models: z.array(PublicModel),
  defaultId: z.string(),
});

/**
 * POST /api/chat.
 *
 * `mode` and `model` are additive — a Phase-1 body without them still parses,
 * defaulting to manual with the registry default.
 */
export const ChatRequest = z.object({
  messages: z.array(z.unknown()).min(1),
  context: z.string().optional(),
  mode: z.enum(["manual", "auto"]).default("manual"),
  model: z.string().optional(),
  /** Files attached as context, pinned by SHA (S-25) so replay is exact. */
  contextFiles: z
    .array(
      z.object({
        owner: z.string(),
        repo: z.string(),
        path: z.string(),
        sha: z.string(),
        bytes: z.number().int().nonnegative(),
        contentHash: z.string(),
      }),
    )
    .default([]),
  /** True when the turn invokes a skill — a fact, never inferred from prose. */
  needsTools: z.boolean().default(false),
});

/**
 * Per-turn metadata carried on the AI SDK UI message stream.
 *
 * The routing decision is emitted on `start` (it is known before the first
 * token) and usage on `finish`, so the client can show the decision while the
 * answer is still streaming.
 */
export const TurnMetadata = z.object({
  routing: RoutingDecision.optional(),
  spend: SpendRecord.optional(),
});

export type PublicModel = z.infer<typeof PublicModel>;
export type ModelsResponse = z.infer<typeof ModelsResponse>;
export type ChatRequest = z.infer<typeof ChatRequest>;
export type TurnMetadata = z.infer<typeof TurnMetadata>;
