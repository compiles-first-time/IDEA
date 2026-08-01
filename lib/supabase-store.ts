import { randomUUID } from "node:crypto";

import type { RepoFile, RepoFileStore } from "@/lib/conversation-store";

/**
 * Supabase-backed store for hosted mode (S-51, amends E-15.c/E-15.d).
 *
 * One table — `idea_hosted_files (namespace, path, content, sha)` — holding
 * small text documents per user, where `namespace` is the signed-in GitHub
 * login. It implements the same `RepoFileStore` seam the local-disk and
 * GitHub backends implement, so every conversation guarantee — unconditional
 * redaction, optimistic concurrency, the retry loop — is inherited, not
 * reimplemented.
 *
 * Talks to Supabase's REST layer (PostgREST) with plain `fetch` — no SDK.
 * Two functions and four verbs do not justify a dependency, and an injected
 * fetch keeps the whole store testable without a network.
 *
 * The secret key is server-only and bypasses RLS; the schema enables RLS with
 * **no policies**, so a leaked publishable key can read nothing (NFR-4).
 * Provider keys are never written here — they are not in any turn by
 * construction (E-15.b), and redaction scrubs them again before every write.
 */

export const HOSTED_TABLE = "idea_hosted_files";

export interface SupabaseConfig {
  url: string;
  secretKey: string;
}

export class SupabaseStoreError extends Error {
  constructor(
    message: string,
    /** HTTP-ish status, read by conversation-store's error classifier. */
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Read the deployment's Supabase wiring. Null — not a throw — when absent:
 * an unconfigured store means "hosted persistence is off", which is a
 * supported state, not a fault.
 */
export function supabaseConfig(
  env: Record<string, string | undefined> = process.env,
): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim();
  // Both current naming (sb_secret_…) and the legacy service-role JWT work —
  // PostgREST accepts either as a bearer secret.
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !secretKey) return null;
  return { url: url.replace(/\/+$/, ""), secretKey };
}

type FetchLike = typeof fetch;

interface Row {
  content: string;
  sha: string;
}

function headers(cfg: SupabaseConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: cfg.secretKey,
    authorization: `Bearer ${cfg.secretKey}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function fail(res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new SupabaseStoreError(
    `supabase ${res.status}: ${body.slice(0, 200) || res.statusText}`,
    res.status,
  );
}

/** Read one row. Exported for the settings module; not part of RepoFileStore. */
export async function getRow(
  cfg: SupabaseConfig,
  namespace: string,
  path: string,
  fetchImpl: FetchLike = fetch,
): Promise<Row | null> {
  const url =
    `${cfg.url}/rest/v1/${HOSTED_TABLE}` +
    `?namespace=eq.${encodeURIComponent(namespace)}&path=eq.${encodeURIComponent(path)}` +
    `&select=content,sha`;
  const res = await fetchImpl(url, { headers: headers(cfg) });
  if (!res.ok) return fail(res);
  const rows = (await res.json()) as Row[];
  return rows[0] ?? null;
}

/** Insert-or-replace one row, last write wins. For settings, not conversations. */
export async function upsertRow(
  cfg: SupabaseConfig,
  namespace: string,
  path: string,
  content: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const res = await fetchImpl(`${cfg.url}/rest/v1/${HOSTED_TABLE}`, {
    method: "POST",
    headers: headers(cfg, {
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      namespace,
      path,
      content,
      sha: randomUUID(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return fail(res);
}

/**
 * The `RepoFileStore` over one user's namespace.
 *
 * `branch`/`ref` are carried for the shared contract and ignored — a table
 * has no branches; the login *is* the isolation boundary.
 */
export function supabaseFileStore(
  cfg: SupabaseConfig,
  namespace: string,
  fetchImpl: FetchLike = fetch,
): RepoFileStore {
  const base = `${cfg.url}/rest/v1/${HOSTED_TABLE}`;
  const ns = `namespace=eq.${encodeURIComponent(namespace)}`;

  return {
    async getFile(path: string): Promise<RepoFile | null> {
      return getRow(cfg, namespace, path, fetchImpl);
    },

    async putFile(args): Promise<{ sha: string }> {
      const nextSha = randomUUID();
      const stamp = new Date().toISOString();

      if (args.sha === undefined) {
        // Create. The primary key makes a duplicate a 409, which the
        // conversation layer already understands as a conflict.
        const res = await fetchImpl(base, {
          method: "POST",
          headers: headers(cfg, { prefer: "return=minimal" }),
          body: JSON.stringify({
            namespace,
            path: args.path,
            content: args.content,
            sha: nextSha,
            updated_at: stamp,
          }),
        });
        if (!res.ok) return fail(res);
        return { sha: nextSha };
      }

      // Update, only if the row still carries the sha we read (optimistic
      // concurrency). Zero rows back means someone wrote in between — surface
      // it as the 409 the append retry-loop is built to handle.
      const url =
        `${base}?${ns}&path=eq.${encodeURIComponent(args.path)}` +
        `&sha=eq.${encodeURIComponent(args.sha)}`;
      const res = await fetchImpl(url, {
        method: "PATCH",
        headers: headers(cfg, { prefer: "return=representation" }),
        body: JSON.stringify({ content: args.content, sha: nextSha, updated_at: stamp }),
      });
      if (!res.ok) return fail(res);
      const rows = (await res.json()) as Row[];
      if (rows.length === 0) {
        throw new SupabaseStoreError("write conflict: the file changed since it was read", 409);
      }
      return { sha: nextSha };
    },

    async listDir(path: string): Promise<Array<{ name: string; type: "file" | "dir" }>> {
      // PostgREST `like` uses `*` as the wildcard.
      const url = `${base}?${ns}&path=like.${encodeURIComponent(`${path}/*`)}&select=path`;
      const res = await fetchImpl(url, { headers: headers(cfg) });
      if (!res.ok) return fail(res);
      const rows = (await res.json()) as Array<{ path: string }>;

      const prefix = `${path}/`;
      const seen = new Map<string, "file" | "dir">();
      for (const row of rows) {
        const rest = row.path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) seen.set(rest, "file");
        else seen.set(rest.slice(0, slash), "dir");
      }
      return [...seen.entries()].map(([name, type]) => ({ name, type }));
    },

    async ensureBranch(): Promise<void> {
      // A table has no branches to create.
    },

    async canWrite(): Promise<boolean> {
      // Configured means writable — the secret key is the write credential.
      return true;
    },
  };
}
