import { authedOctokit, unauthorized } from "@/lib/github";
import { contentHash } from "@/lib/hash";
import { FileResponse, MAX_FILE_BYTES } from "@/lib/contracts/repos";

export const runtime = "nodejs";

type Blob = { content: string; size: number; sha: string };

/**
 * GET /api/repos/file?owner=&repo=&path=&branch=&sha=
 *
 * With `sha`, fetches that exact blob — the bytes are reproducible regardless of
 * later commits (S-25, FR-9.4). Without it, resolves through the branch as before
 * and returns whichever SHA it landed on, so callers can pin next time.
 */
export async function GET(req: Request) {
  const octokit = await authedOctokit();
  if (!octokit) return unauthorized();

  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const path = searchParams.get("path");
  const branch = searchParams.get("branch") || undefined;
  const sha = searchParams.get("sha") || undefined;
  if (!owner || !repo || !path) {
    return Response.json({ error: "owner, repo and path are required" }, { status: 400 });
  }

  let blob: Blob;
  try {
    blob = sha
      ? await getBySha(octokit, owner, repo, sha)
      : await getByPath(octokit, owner, repo, path, branch);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    // A pinned SHA that no longer resolves is a distinct, expected condition —
    // S-28 must tell "unavailable" apart from "changed" when reporting fidelity.
    if (sha && (err.status === 404 || err.status === 422)) {
      return Response.json(
        { error: `blob ${sha} is no longer available`, code: "sha_unavailable" },
        { status: 404 },
      );
    }
    if (err.status === 403 || err.status === 404) {
      return Response.json({ error: err.message ?? "not found" }, { status: err.status });
    }
    return Response.json({ error: err.message ?? "upstream error" }, { status: 502 });
  }

  if (blob.size > MAX_FILE_BYTES) {
    return Response.json({ error: `file too large (>${MAX_FILE_BYTES} bytes)` }, { status: 413 });
  }

  const content = Buffer.from(blob.content, "base64").toString("utf8");
  return Response.json(
    FileResponse.parse({
      path,
      size: blob.size,
      content,
      sha: blob.sha,
      contentHash: contentHash(content),
    }),
  );
}

type Octo = NonNullable<Awaited<ReturnType<typeof authedOctokit>>>;

async function getBySha(octokit: Octo, owner: string, repo: string, sha: string): Promise<Blob> {
  const { data } = await octokit.git.getBlob({ owner, repo, file_sha: sha });
  return { content: data.content, size: data.size ?? 0, sha: data.sha };
}

async function getByPath(
  octokit: Octo,
  owner: string,
  repo: string,
  path: string,
  branch?: string,
): Promise<Blob> {
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
  if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
    throw Object.assign(new Error("not a file"), { status: 400 });
  }
  return { content: data.content, size: data.size ?? 0, sha: data.sha };
}
