import { authedOctokit, unauthorized } from "@/lib/github";

export const runtime = "nodejs";

// GET /api/repos — the signed-in user's repositories, most-recently-updated first.
export async function GET() {
  const octokit = await authedOctokit();
  if (!octokit) return unauthorized();
  const { data } = await octokit.repos.listForAuthenticatedUser({
    per_page: 100,
    sort: "updated",
  });
  return Response.json({
    repos: data.map((r) => ({
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      updated_at: r.updated_at,
    })),
  });
}
