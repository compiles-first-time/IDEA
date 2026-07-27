import { authedOctokit, unauthorized } from "@/lib/github";
import { TreeResponse } from "@/lib/contracts/repos";

export const runtime = "nodejs";

// GET /api/repos/tree?owner=&repo=&branch= — the repo's full file list (blobs).
// Each entry carries its blob SHA so callers can pin exact bytes later (S-25).
export async function GET(req: Request) {
  const octokit = await authedOctokit();
  if (!octokit) return unauthorized();

  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  if (!owner || !repo) return Response.json({ error: "owner and repo are required" }, { status: 400 });

  let branch = searchParams.get("branch") ?? "";
  try {
    if (!branch) {
      const { data } = await octokit.repos.get({ owner, repo });
      branch = data.default_branch;
    }
    const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const tree = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: ref.data.object.sha,
      recursive: "1",
    });
    const files = tree.data.tree
      .filter((t) => t.type === "blob" && t.sha)
      .map((t) => ({ path: t.path as string, size: t.size ?? 0, sha: t.sha as string }));
    return Response.json(
      TreeResponse.parse({ branch, truncated: tree.data.truncated ?? false, files }),
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
