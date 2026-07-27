import {
  CONVERSATION_ROOT,
  ConversationError,
  conversationPaths,
  newMeta,
  parseMeta,
  parseTurns,
  serializeMeta,
  serializeTurns,
  touchMeta,
  transcriptHash,
  appendTurn as appendToTurns,
  type CanonicalTurn,
  type ConversationMeta,
  type NewTurn,
} from "@/lib/conversation";
import { describeHits, redactTurn, type RedactionHit } from "@/lib/redact";

/**
 * Conversation store (S-27, FR-9.1/9.2).
 *
 * Conversations are committed to the project's own repo under
 * `.idea/conversations/`, on a dedicated branch, through the GitHub Contents
 * API rather than the local working tree.
 *
 * **Why the API and not local git, now that IDEA runs locally?** Three reasons
 * that survive the local-first pivot:
 *   1. It writes to a *different branch* without touching the working tree — no
 *      noise in `git status`, no conversation files swept into the user's
 *      commits, no merge conflicts with work in progress.
 *   2. One call is durable and pushed; a local write still needs commit + push.
 *   3. It works before a project has been cloned.
 *
 * All I/O goes through `RepoFileStore` so this module stays testable without a
 * network, and so a different backend could be substituted without touching the
 * logic.
 */

/* -------------------------------------------------------------------------- */
/* Backend seam                                                                */
/* -------------------------------------------------------------------------- */

export interface RepoFile {
  content: string;
  /** Blob SHA — required for optimistic concurrency on update. */
  sha: string;
}

export interface RepoFileStore {
  getFile(path: string, ref: string): Promise<RepoFile | null>;
  putFile(args: {
    path: string;
    content: string;
    message: string;
    branch: string;
    /** Omit to create; supply the current blob SHA to update. */
    sha?: string;
  }): Promise<{ sha: string }>;
  listDir(path: string, ref: string): Promise<Array<{ name: string; type: "file" | "dir" }>>;
  /** Create the branch from the default branch if it does not exist. */
  ensureBranch(branch: string): Promise<void>;
  /** True when the caller can write. Checked before the first write. */
  canWrite(): Promise<boolean>;
}

export class ConversationStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | "no_write_access"
      | "conflict"
      | "not_found"
      | "forbidden_path"
      | "upstream",
  ) {
    super(message);
  }
}

export interface StoreContext {
  store: RepoFileStore;
  /** The conversations branch — never the default branch (E-9.a). */
  branch: string;
  projectName: string;
}

/* -------------------------------------------------------------------------- */
/* Write-path confinement (E-9.a)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every write goes through here. IDEA is permitted to write under
 * `.idea/conversations/**` and nowhere else — enforced in code, not by
 * convention, because this is the whole of the GE-4 carve-out.
 */
function assertWritablePath(path: string): void {
  if (!path.startsWith(`${CONVERSATION_ROOT}/`)) {
    throw new ConversationStoreError(
      `refusing to write outside ${CONVERSATION_ROOT}/ — got "${path}" (E-9.a)`,
      "forbidden_path",
    );
  }
  if (path.includes("..")) {
    throw new ConversationStoreError(`refusing a traversing path: "${path}"`, "forbidden_path");
  }
}

async function write(
  ctx: StoreContext,
  args: { path: string; content: string; message: string; sha?: string },
): Promise<{ sha: string }> {
  assertWritablePath(args.path);
  try {
    return await ctx.store.putFile({ ...args, branch: ctx.branch });
  } catch (e) {
    throw toStoreError(e);
  }
}

function toStoreError(e: unknown): ConversationStoreError {
  if (e instanceof ConversationStoreError) return e;
  const err = e as { status?: number; message?: string };
  if (err.status === 409 || err.status === 422) {
    return new ConversationStoreError(err.message ?? "write conflict", "conflict");
  }
  if (err.status === 403 || err.status === 401) {
    return new ConversationStoreError(
      "you do not have write access to this repository — the turn was not saved",
      "no_write_access",
    );
  }
  return new ConversationStoreError(err.message ?? "upstream error", "upstream");
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

export interface StoredConversation {
  meta: ConversationMeta;
  turns: CanonicalTurn[];
}

/** Conversation ids present in the repo. A malformed entry is skipped, not fatal. */
export async function listConversations(ctx: StoreContext): Promise<ConversationMeta[]> {
  let entries: Array<{ name: string; type: "file" | "dir" }>;
  try {
    entries = await ctx.store.listDir(CONVERSATION_ROOT, ctx.branch);
  } catch {
    return []; // nothing stored yet is not an error
  }

  const metas: ConversationMeta[] = [];
  for (const entry of entries) {
    if (entry.type !== "dir") continue;
    try {
      const file = await ctx.store.getFile(conversationPaths(entry.name).meta, ctx.branch);
      if (file) metas.push(parseMeta(file.content));
    } catch {
      // A single corrupt conversation must not hide the rest.
    }
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadConversation(
  ctx: StoreContext,
  id: string,
): Promise<StoredConversation> {
  const paths = conversationPaths(id);
  const [metaFile, turnsFile] = await Promise.all([
    ctx.store.getFile(paths.meta, ctx.branch),
    ctx.store.getFile(paths.turns, ctx.branch),
  ]);
  if (!metaFile) {
    throw new ConversationStoreError(`conversation "${id}" not found`, "not_found");
  }
  return {
    meta: parseMeta(metaFile.content),
    turns: turnsFile ? parseTurns(turnsFile.content) : [],
  };
}

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

export async function createConversation(
  ctx: StoreContext,
  input: { id: string; title: string },
  now: Date,
): Promise<ConversationMeta> {
  if (!(await ctx.store.canWrite())) {
    throw new ConversationStoreError(
      "you do not have write access to this repository — the conversation was not created",
      "no_write_access",
    );
  }
  await ctx.store.ensureBranch(ctx.branch);

  const paths = conversationPaths(input.id);
  const existing = await ctx.store.getFile(paths.meta, ctx.branch);
  if (existing) {
    throw new ConversationStoreError(`conversation "${input.id}" already exists`, "conflict");
  }

  const meta = newMeta({ id: input.id, projectName: ctx.projectName, title: input.title }, now);
  await write(ctx, {
    path: paths.meta,
    content: serializeMeta(meta),
    message: `idea: start conversation ${input.id}`,
  });
  return meta;
}

export interface AppendResult {
  turn: CanonicalTurn;
  meta: ConversationMeta;
  /** Non-empty when S-26 redacted something — surfaced, never silent. */
  redactions: RedactionHit[];
  /** Hash of the stored transcript; the layer-1 integrity guarantee. */
  transcriptHash: string;
}

/** How many times a concurrent-write conflict is retried before giving up. */
export const MAX_APPEND_ATTEMPTS = 3;

/**
 * Append a turn and commit it.
 *
 * **Redaction is unconditional.** There is no parameter, flag, or alternative
 * path that writes an unredacted turn — a secret reaching git history means
 * rotating the credential and possibly rewriting a repo others have cloned
 * (E-9.c). The `extraSecrets` argument only *adds* values to redact.
 */
export async function appendConversationTurn(
  ctx: StoreContext,
  id: string,
  turn: NewTurn,
  now: Date,
  extraSecrets: readonly string[] = [],
): Promise<AppendResult> {
  const paths = conversationPaths(id);

  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    const [metaFile, turnsFile] = await Promise.all([
      ctx.store.getFile(paths.meta, ctx.branch),
      ctx.store.getFile(paths.turns, ctx.branch),
    ]);
    if (!metaFile) {
      throw new ConversationStoreError(`conversation "${id}" not found`, "not_found");
    }

    const meta = parseMeta(metaFile.content);
    const existing = turnsFile ? parseTurns(turnsFile.content) : [];

    // Stamp and sequence first, then redact — so the redacted turn is exactly
    // what gets hashed, written, and read back.
    const withNew = appendToTurns(existing, turn, now);
    const appended = withNew[withNew.length - 1];
    const redaction = redactTurn(appended, extraSecrets);
    const turns = [...existing, redaction.value];

    try {
      await write(ctx, {
        path: paths.turns,
        content: serializeTurns(turns),
        message: `idea: turn ${appended.seq} in ${id}${redaction.redacted ? " (redacted)" : ""}`,
        sha: turnsFile?.sha,
      });
    } catch (e) {
      const err = toStoreError(e);
      if (err.code !== "conflict") throw err;
      // Someone else appended between our read and write — re-read and retry.
      if (attempt < MAX_APPEND_ATTEMPTS) continue;
      // Out of attempts. Say plainly that the turn was not saved (E-9.d) —
      // the upstream message alone ("sha mismatch") tells the user nothing.
      throw new ConversationStoreError(
        `could not append after ${MAX_APPEND_ATTEMPTS} attempts (${err.message}) — the turn was not saved`,
        "conflict",
      );
    }

    const nextMeta = touchMeta(meta, turns, now);
    await write(ctx, {
      path: paths.meta,
      content: serializeMeta(nextMeta),
      message: `idea: update ${id}`,
      sha: metaFile.sha,
    });

    return {
      turn: redaction.value,
      meta: nextMeta,
      redactions: redaction.hits,
      transcriptHash: transcriptHash(turns),
    };
  }

  // Unreachable — the loop either returns or throws. Kept so the function has
  // no implicit undefined path.
  throw new ConversationStoreError("append loop exited unexpectedly", "upstream");
}

/** User-facing summary of what redaction did, for the UI to show. */
export function describeRedactions(result: AppendResult): string | null {
  return result.redactions.length ? `Redacted before saving: ${describeHits(result.redactions)}` : null;
}

export { ConversationError };
