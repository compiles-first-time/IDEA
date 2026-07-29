import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type { RepoFile, RepoFileStore } from "@/lib/conversation-store";

/**
 * A `RepoFileStore` backed by the project's working tree (S-46, FR-9).
 *
 * Conversations live in the project directory, so they travel with the clone,
 * work offline, and need no second service. `08-local-first` deleted the hosted
 * split deliberately; putting chat history behind a hosted database would put it
 * back — a service to keep up, an account to hold, a key to leak, and a second
 * source of truth for something the repo already carries.
 *
 * The GitHub-backed store (`githubStore`) stays for the case it was built for:
 * writing to a repo IDEA has not cloned. This one is for the ordinary case,
 * where the project is right there on disk.
 *
 * **The directory is created on first write.** `loom-template` ships no
 * conversations folder, so a store that assumes one fails on exactly the case it
 * exists for — a brand-new project.
 */

/** Content-addressed, like a git blob SHA: same content, same id. */
function sha(content: string): string {
  return createHash("sha1").update(content, "utf8").digest("hex");
}

/**
 * Refuse to escape the project root.
 *
 * `assertWritablePath` in the store already confines writes to
 * `.idea/conversations/`, but that check is about *which* file. This one is
 * about *where the root is* — two different mistakes, and the cheap one to make
 * twice.
 */
function safeJoin(root: string, path: string): string {
  const abs = resolve(root, path);
  const base = resolve(root);
  if (abs !== base && !abs.startsWith(base + sep)) {
    throw new Error(`refusing to touch a path outside the project: ${path}`);
  }
  return abs;
}

export interface LocalStoreOptions {
  /** Absolute path to the project's working tree. */
  projectRoot: string;
}

export function localStore({ projectRoot }: LocalStoreOptions): RepoFileStore {
  return {
    async getFile(path: string): Promise<RepoFile | null> {
      const abs = safeJoin(projectRoot, path);
      if (!existsSync(abs)) return null;
      const content = await readFile(abs, "utf8");
      return { content, sha: sha(content) };
    },

    async putFile({ path, content, sha: expected }) {
      const abs = safeJoin(projectRoot, path);

      // Optimistic concurrency, same contract as the GitHub store: if the caller
      // says "I read sha X", refuse when the file has moved on. Two tabs
      // appending to one conversation would otherwise silently lose a turn.
      if (expected !== undefined) {
        const current = existsSync(abs) ? sha(await readFile(abs, "utf8")) : undefined;
        if (current !== expected) {
          const err = new Error("sha mismatch — the file changed since it was read");
          // The store's retry loop recognises this shape.
          (err as Error & { status?: number }).status = 409;
          throw err;
        }
      }

      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
      return { sha: sha(content) };
    },

    async listDir(path: string) {
      const abs = safeJoin(projectRoot, path);
      if (!existsSync(abs)) return [];
      const entries = await readdir(abs, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? ("dir" as const) : ("file" as const),
      }));
    },

    async ensureBranch() {
      // A working tree has no branch to create. Conversations are written to the
      // checkout; committing and pushing them is a separate, deliberate act —
      // which is the point, since an auto-commit on every message would bury the
      // project's real history.
    },

    async canWrite() {
      // Writable if the project exists. The directory itself is created on first
      // write, so its absence is not a failure.
      return existsSync(projectRoot);
    },
  };
}

/** Where a project's conversations live, for messages and diagnostics. */
export function conversationDirFor(projectRoot: string): string {
  return join(projectRoot, ".idea", "conversations");
}
