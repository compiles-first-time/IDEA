import { z } from "zod";

import { auth } from "@/auth";
import { jsonError, unauthorized } from "@/lib/api";
import { storeError } from "@/app/api/conversations/route";
import {
  appendConversationTurn,
  describeRedactions,
  loadConversation,
  type StoreContext,
} from "@/lib/conversation-store";
import { CanonicalTurn } from "@/lib/conversation";
import { authedOctokit } from "@/lib/github";
import { githubStore } from "@/lib/github-store";

export const runtime = "nodejs";

const DEFAULT_BRANCH = "idea/conversations";

const Query = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  project: z.string().min(1),
  branch: z.string().min(1).default(DEFAULT_BRANCH),
});

/** A turn as supplied by a client: no `seq`, and `ts` is stamped server-side. */
const IncomingTurn = CanonicalTurn.omit({ seq: true, ts: true });

const AppendBody = Query.extend({ turn: IncomingTurn });

async function contextFrom(params: z.infer<typeof Query>): Promise<StoreContext | Response> {
  const octokit = await authedOctokit();
  if (!octokit) return unauthorized();
  return {
    store: githubStore({ octokit, owner: params.owner, repo: params.repo }),
    branch: params.branch,
    projectName: params.project,
  };
}

/** GET /api/conversations/[id] — the full transcript. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return jsonError("owner, repo and project are required", 400);

  const ctx = await contextFrom(parsed.data);
  if (ctx instanceof Response) return ctx;

  try {
    return Response.json(await loadConversation(ctx, id));
  } catch (e) {
    return storeError(e);
  }
}

/** POST /api/conversations/[id] — append a turn and commit it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { id } = await params;
  let body: z.infer<typeof AppendBody>;
  try {
    body = AppendBody.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  const ctx = await contextFrom(body);
  if (ctx instanceof Response) return ctx;

  try {
    const result = await appendConversationTurn(
      ctx,
      id,
      body.turn,
      new Date(),
      // The session token must never reach a commit, even via a tool result.
      session.accessToken ? [session.accessToken] : [],
    );
    return Response.json({
      turn: result.turn,
      meta: result.meta,
      transcriptHash: result.transcriptHash,
      // Redaction is reported, never applied silently (S-26).
      redactionNotice: describeRedactions(result),
    });
  } catch (e) {
    return storeError(e);
  }
}
