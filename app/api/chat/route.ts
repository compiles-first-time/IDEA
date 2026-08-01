import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import { auth } from "@/auth";
import { jsonError, serverError } from "@/lib/api";
import { keysFromHeaders, type ProviderKeys } from "@/lib/byok";
import { ChatRequest, TurnMetadata } from "@/lib/contracts/api";
import { SpendRecord, type RoutingDecision } from "@/lib/contracts/routing";
import { ASSUMED_OUTPUT_TOKENS, estimateCostUsd } from "@/lib/cost";
import { chainFor, loadRoutingConfig, orderFromChain } from "@/lib/fallback";
import { isHosted } from "@/lib/hosted";
import { hasKeyFor, resolveModel } from "@/lib/providers";
import { enabledModels, getModel, defaultModelId, loadRegistry } from "@/lib/registry";
import { route, scoreComplexity, selectModel } from "@/lib/router";
import type { NewTurn } from "@/lib/conversation";
import { appendForProject } from "@/lib/project-conversations";
import { chatTools } from "@/lib/chat-tools";
import { orientationPrompt, readOrientation } from "@/lib/orientation";
import { loadProjects } from "@/lib/project-store";
import { getProject, projectRoot } from "@/lib/projects";
import { isLoomMaintainer } from "@/lib/maintainers";

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
  const hosted = isHosted();
  // In hosted mode keys are the user's own, carried as headers (E-15.b); a
  // local install keeps reading the environment and ignores the headers.
  const keys: ProviderKeys | undefined = hosted ? keysFromHeaders(req.headers) : undefined;

  const allEnabled = enabledModels(registry);
  if (allEnabled.length === 0) return jsonError("no models are enabled", 500);

  // Route only among models we can actually reach: a provider without a key
  // must not win the routing decision only to fail mid-stream (BR_02_BE-02
  // taught this lesson for stale picks; the same applies to keyless providers).
  // Hosted also drops `local` entries — a server cannot see anyone's 127.0.0.1.
  const candidates = allEnabled.filter(
    (m) => (!hosted || m.provider !== "local") && hasKeyFor(m, keys),
  );
  if (candidates.length === 0) {
    return jsonError(
      hosted
        ? "No provider API key yet — add your own key in Settings. It stays in your browser."
        : "No provider API key configured — add one in Settings.",
      400,
      "missing_key",
    );
  }

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
  // Hosted mode has no projects on disk, so the workspace is structurally null
  // (E-15.a) — this also guarantees no tool ever runs against the host.
  const workspace =
    body.project && !hosted ? await workspaceFor(body.project, session.login) : null;

  const system =
    "You are IDEA, a precise, concise coding assistant." +
    (workspace ? orientationPrompt(body.project!, workspace.orientation) : "") +
    (body.context
      ? `\n\nThe user attached these repository files as context. Use them when relevant:\n\n${body.context}`
      : "");

  try {
    const result = streamText({
      model: resolveModel(chosen, keys),
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
    // Never in hosted mode: there is no disk to save to, and a turn that
    // *carried* a user's key headers must not leave any server-side residue.
    const persist = !hosted && body.project && body.conversationId
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
async function workspaceFor(projectName: string, login?: string) {
  try {
    const ideaRoot = process.cwd();
    const project = getProject(await loadProjects(ideaRoot), projectName);
    if (!project) return null;

    const root = projectRoot(ideaRoot, project);
    // E-11.a — loom-template is never written to. Now that a project can point
    // at any checkout, the upstream template can *be* the selected project, so
    // the guard has to be set from the record rather than assumed absent.
    const isTemplate =
      project.repo === "loom-template" || /(^|[\\/])loom-template$/.test(root);
    const scope = {
      projectRoot: root,
      ideaRoot,
      // E-11.a as amended: the template is protected from everyone EXCEPT the
      // people who maintain it. Identity is answered in lib/maintainers.ts, not
      // here — this route only carries the answer across.
      ...(isTemplate ? { loomTemplateRoot: root, loomMaintainer: isLoomMaintainer(login) } : {}),
    };
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
