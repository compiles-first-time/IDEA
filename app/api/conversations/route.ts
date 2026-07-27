import { randomUUID } from "node:crypto";

import { z } from "zod";

import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import {
  ConversationStoreError,
  createConversation,
  listConversations,
  type StoreContext,
} from "@/lib/conversation-store";
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

const CreateBody = Query.extend({ title: z.string().min(1).max(200) });

/** Resolve the store, or return the error response that explains why we can't. */
async function contextFrom(
  params: z.infer<typeof Query>,
): Promise<StoreContext | Response> {
  const octokit = await authedOctokit();
  if (!octokit) return unauthorized();
  return {
    store: githubStore({ octokit, owner: params.owner, repo: params.repo }),
    branch: params.branch,
    projectName: params.project,
  };
}

/** GET /api/conversations?owner=&repo=&project= — this project's conversations. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return jsonError("owner, repo and project are required", 400);

  const ctx = await contextFrom(parsed.data);
  if (ctx instanceof Response) return ctx;

  try {
    return Response.json({ conversations: await listConversations(ctx) });
  } catch (e) {
    return storeError(e);
  }
}

/** POST /api/conversations — start a conversation in the project's repo. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  const ctx = await contextFrom(body);
  if (ctx instanceof Response) return ctx;

  try {
    const meta = await createConversation(
      ctx,
      { id: randomUUID(), title: body.title },
      new Date(),
    );
    return Response.json({ conversation: meta }, { status: 201 });
  } catch (e) {
    return storeError(e);
  }
}

/** Map store failures onto statuses that say what actually went wrong (E-9.d). */
export function storeError(e: unknown): Response {
  if (!(e instanceof ConversationStoreError)) return serverError(e);
  const status =
    e.code === "no_write_access" ? 403
    : e.code === "not_found" ? 404
    : e.code === "conflict" ? 409
    : e.code === "forbidden_path" ? 400
    : 502;
  return jsonError(e.message, status, e.code);
}
