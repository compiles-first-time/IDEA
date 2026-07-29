import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import { auth } from "@/auth";
import { jsonError, serverError } from "@/lib/api";
import { ChatRequest, TurnMetadata } from "@/lib/contracts/api";
import { SpendRecord, type RoutingDecision } from "@/lib/contracts/routing";
import { ASSUMED_OUTPUT_TOKENS, estimateCostUsd } from "@/lib/cost";
import { chainFor, loadRoutingConfig, orderFromChain } from "@/lib/fallback";
import { resolveModel } from "@/lib/providers";
import { enabledModels, getModel, defaultModelId, loadRegistry } from "@/lib/registry";
import { route, scoreComplexity, selectModel } from "@/lib/router";
import type { NewTurn } from "@/lib/conversation";
import { appendForProject } from "@/lib/project-conversations";
import { chatTools } from "@/lib/chat-tools";
import { orientationPrompt, readOrientation } from "@/lib/orientation";
import { loadProjects } from "@/lib/project-store";
import { getProject, projectRoot } from "@/lib/projects";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/chat (S-09).
 *
 * Thin by contract: authenticate → validate → route via lib/ → stream. The
 * routing decision rides the UI message stream as `start` metadata, so the
 * client can show which model answered while the answer is still arriving; the
 * actual provider-reported usage follows as `finish` metadata (FR-4.10).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("Unauthorized", { status: 401 });

  let body: ChatRequest;
  try {
    body = ChatRequest.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  const registry = loadRegistry();
  const candidates = enabledModels(registry);
  if (candidates.length === 0) return jsonError("no models are enabled", 500);

  const messages = body.messages as UIMessage[];
  const prompt = lastUserText(messages);

  // The user's chain is the ordering function in auto mode (FR-4.7); cost
  // ordering applies only where no chain is configured.
  const chain = chainFor(loadRoutingConfig());
  const order = chain ? orderFromChain(chain) : undefined;

  let decision: RoutingDecision;
  try {
    decision =
      body.mode === "auto"
        ? route(
            {
              prompt,
              context: body.context,
              fileCount: body.contextFiles.length,
              needsTools: body.needsTools,
            },
            { mode: "auto", candidates, order },
          )
        : manualDecision(body, candidates, prompt);
  } catch (e) {
    return serverError(e);
  }

  const chosen = getModel(decision.chosenModelId, registry);
  if (!chosen) return jsonError(`model ${decision.chosenModelId} is unavailable`, 500);

  // A selected project turns the chat from "answer from what was pasted" into
  // "go and look". Orientation is attached; location is searched (S-49).
  const workspace = body.project ? await workspaceFor(body.project) : null;

  const system =
    "You are IDEA, a precise, concise coding assistant." +
    (workspace ? orientationPrompt(body.project!, workspace.orientation) : "") +
    (body.context
      ? `\n\nThe user attached these repository files as context. Use them when relevant:\n\n${body.context}`
      : "");

  try {
    const result = streamText({
      model: resolveModel(chosen),
      system,
      messages: await convertToModelMessages(messages),
      tools: workspace?.tools,
      // Without this the model emits one tool call and stops, leaving the user
      // looking at a search result instead of an answer. Bounded so a loop that
      // keeps searching cannot run away with the budget.
      stopWhen: workspace ? stepCountIs(MAX_TOOL_STEPS) : undefined,
    });

    // Persist the user's turn now rather than after the answer: if the stream
    // fails or the tab closes mid-reply, what the user said is still recorded.
    // Losing your own message is worse than losing the reply, which can be asked
    // for again.
    const persist = body.project && body.conversationId
      ? { project: body.project, id: body.conversationId }
      : null;

    if (persist) {
      await savePersistFailure(persist, {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...body.contextFiles.map((f) => ({ type: "repo_context" as const, ...f })),
        ],
      });
    }

    return result.toUIMessageStreamResponse({
      onFinish: async ({ responseMessage }) => {
        if (!persist) return;
        const text = textOf(responseMessage as UIMessage);
        if (!text) return;
        await savePersistFailure(
          persist,
          { role: "assistant", content: [{ type: "text", text }], modelId: chosen.id },
        );
      },
      messageMetadata: ({ part }) => {
        // Known before the first token — show the decision while streaming.
        if (part.type === "start") {
          return TurnMetadata.parse({ routing: decision });
        }
        // Actual usage, not the pre-flight estimate (FR-4.10).
        if (part.type === "finish") {
          const inputTokens = part.totalUsage?.inputTokens ?? 0;
          const outputTokens = part.totalUsage?.outputTokens ?? 0;
          return TurnMetadata.parse({
            spend: SpendRecord.parse({
              ts: new Date().toISOString(),
              modelId: chosen.id,
              inputTokens,
              outputTokens,
              costUsd: finiteOrZero(estimateCostUsd(chosen, inputTokens, outputTokens)),
              estimatedCostUsd: decision.estCostUsd,
            }),
          });
        }
        return undefined;
      },
    });
  } catch (e) {
    return serverError(e);
  }
}

/**
 * Manual mode still produces a full RoutingDecision — FR-4.4 says *every*
 * routed turn records one, and it keeps the archive uniform (AD-7).
 */
function manualDecision(
  body: ChatRequest,
  candidates: ReturnType<typeof enabledModels>,
  prompt: string,
): RoutingDecision {
  const scored = scoreComplexity({
    prompt,
    context: body.context,
    fileCount: body.contextFiles.length,
    needsTools: body.needsTools,
  });
  return selectModel({
    mode: "manual",
    candidates,
    score: scored.score,
    signals: scored.signals,
    requiredTier: scored.requiredTier,
    inputTokens: scored.signals.tokens,
    outputTokens: ASSUMED_OUTPUT_TOKENS,
    requestedModelId: body.model ?? defaultModelId(),
  });
}

/** Flatten the newest user turn to text for scoring. */
/**
 * How many tool round-trips one turn may take before it must answer.
 *
 * High enough for search → read → read → answer, low enough that a model which
 * keeps looking cannot spend the budget looking.
 */
const MAX_TOOL_STEPS = 8;

/**
 * Resolve a project into the things a grounded turn needs: its orientation
 * documents and its tools.
 *
 * Returns null when the project is unknown rather than failing the turn — chat
 * without a project is a supported state (it simply is not saved and cannot
 * search), and an unknown name should not swallow the user's message.
 */
async function workspaceFor(projectName: string) {
  try {
    const ideaRoot = process.cwd();
    const project = getProject(await loadProjects(ideaRoot), projectName);
    if (!project) return null;

    const root = projectRoot(ideaRoot, project);
    const scope = { projectRoot: root, ideaRoot };
    return {
      orientation: await readOrientation(root),
      tools: chatTools({ scope }),
    };
  } catch {
    return null;
  }
}

/**
 * Save a turn, and never take the chat down over it.
 *
 * A failed save is real and must be visible — but throwing here would abort a
 * reply the user is already reading. The store surfaces its own retry
 * exhaustion; this logs loudly so the failure is not silent, and E-9.d's
 * user-facing surface is tracked in S-46 rather than faked here.
 */
async function savePersistFailure(
  target: { project: string; id: string },
  turn: NewTurn,
): Promise<void> {
  try {
    await appendForProject(target.project, target.id, turn);
  } catch (e) {
    console.error(
      `[chat] the turn was NOT saved to ${target.project}/${target.id}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/** Flatten an assistant message's text parts. */
function textOf(message: UIMessage | undefined): string {
  if (!message) return "";
  return (message.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

function lastUserText(messages: readonly UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    return parts
      .filter((p): p is { type: "text"; text: string } => p?.type === "text")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

function finiteOrZero(n: number): number {
  return Number.isFinite(n) ? n : 0;
}
