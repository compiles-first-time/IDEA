import { z } from "zod";

/** Max bytes pulled into chat context (E-2.b). */
export const MAX_FILE_BYTES = 512 * 1024;

/** GET /api/repos/tree */
export const TreeFile = z.object({
  path: z.string(),
  size: z.number(),
  /** Git blob SHA — lets a later fetch pin these exact bytes (S-25). */
  sha: z.string(),
});

export const TreeResponse = z.object({
  branch: z.string(),
  truncated: z.boolean(),
  files: z.array(TreeFile),
});

/** GET /api/repos/file */
export const FileResponse = z.object({
  path: z.string(),
  size: z.number(),
  content: z.string(),
  /** Resolved blob SHA — always returned, whether or not one was requested. */
  sha: z.string(),
  contentHash: z.string(),
});

/**
 * A pinned reference to repo content, as embedded in a stored conversation
 * (S-23 `repo_context` part). Carries everything needed to reconstruct exactly
 * what the model saw, or to detect that we no longer can.
 */
export const RepoContextRef = z.object({
  owner: z.string(),
  repo: z.string(),
  path: z.string(),
  sha: z.string(),
  bytes: z.number().int().nonnegative(),
  contentHash: z.string(),
});

/** Why a pinned context could not be reconstructed (S-28 reports these). */
export const ContextUnavailableReason = z.enum([
  "sha_unavailable", // blob gone — force-push, GC, repo deleted
  "hash_mismatch", // blob resolved but bytes differ — should not happen
  "forbidden", // caller lost read access
]);

export type TreeFile = z.infer<typeof TreeFile>;
export type TreeResponse = z.infer<typeof TreeResponse>;
export type FileResponse = z.infer<typeof FileResponse>;
export type RepoContextRef = z.infer<typeof RepoContextRef>;
export type ContextUnavailableReason = z.infer<typeof ContextUnavailableReason>;
