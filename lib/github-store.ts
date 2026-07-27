import type { Octokit } from "@octokit/rest";

import type { RepoFile, RepoFileStore } from "@/lib/conversation-store";

/**
 * GitHub-backed `RepoFileStore` (S-27).
 *
 * The only place in the conversation path that talks to a network. All logic
 * lives in `lib/conversation-store.ts` against the interface, so it stays
 * testable without one.
 */
export function githubStore(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): RepoFileStore {
  const { octokit, owner, repo } = args;

  return {
    async getFile(path: string, ref: string): Promise<RepoFile | null> {
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
        if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
        return {
          content: Buffer.from(data.content, "base64").toString("utf8"),
          sha: data.sha,
        };
      } catch (e) {
        // A missing file is an expected state, not an error.
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },

    async putFile({ path, content, message, branch, sha }) {
      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch,
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
      });
      return { sha: data.content?.sha ?? "" };
    },

    async listDir(path: string, ref: string) {
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
        if (!Array.isArray(data)) return [];
        return data.map((d) => ({
          name: d.name,
          type: d.type === "dir" ? ("dir" as const) : ("file" as const),
        }));
      } catch (e) {
        if ((e as { status?: number }).status === 404) return [];
        throw e;
      }
    },

    async ensureBranch(branch: string) {
      try {
        await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
        return; // already exists
      } catch (e) {
        if ((e as { status?: number }).status !== 404) throw e;
      }
      // Branch it off the default branch's current head.
      const { data: repoData } = await octokit.repos.get({ owner, repo });
      const { data: head } = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${repoData.default_branch}`,
      });
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: head.object.sha,
      });
    },

    async canWrite() {
      try {
        const { data } = await octokit.repos.get({ owner, repo });
        return data.permissions?.push === true;
      } catch {
        return false;
      }
    },
  };
}
