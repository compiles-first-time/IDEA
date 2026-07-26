import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// Single default model for Phase 1; complexity/cost routing lands in a later phase.
// Override with IDEA_CHAT_MODEL if your API key exposes a different model id.
const MODEL = process.env.IDEA_CHAT_MODEL ?? "claude-sonnet-4-5";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { messages, context } = (await req.json()) as {
    messages: UIMessage[];
    context?: string;
  };

  const system =
    "You are IDEA, a precise, concise coding assistant." +
    (context
      ? `\n\nThe user attached these repository files as context. Use them when relevant:\n\n${context}`
      : "");

  const result = streamText({
    model: anthropic(MODEL),
    system,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
