import { authedOctokit, unauthorized } from "@/lib/github";

export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024; // don't pull huge blobs into chat context

// GET /api/repos/file?owner=&repo=&path=&branch= — a single file's UTF-8 content.
export async function GET(req: Request) {
  const octokit = await authedOctokit();
  if (!octokit) return unauthorized();

  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const path = searchParams.get("path");
  const branch = searchParams.get("branch") || undefined;
  if (!owner || !repo || !path) {
    return Response.json({ error: "owner, repo and path are required" }, { status: 400 });
  }

  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
      return Response.json({ error: "not a file" }, { status: 400 });
    }
    if ((data.size ?? 0) > MAX_BYTES) {
      return Response.json({ error: `file too large (>${MAX_BYTES} bytes)` }, { status: 413 });
    }
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return Response.json({ path, size: data.size, content });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
