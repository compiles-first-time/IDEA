import type { CanonicalTurn } from "@/lib/conversation";

/**
 * Secret redaction before persistence (S-26, E-9.c).
 *
 * A conversation becomes a git commit. Anything pasted into chat — a key, a .env
 * file, a token in an error message — would otherwise become durable and
 * distributable, and git history makes it effectively permanent even after
 * deletion. This runs on the write path in S-27 and cannot be bypassed.
 *
 * Redaction is one-way. No encrypted original is kept alongside.
 */

export type RedactionKind =
  | "known-secret"
  | "anthropic-key"
  | "openai-key"
  | "github-token"
  | "aws-access-key"
  | "huggingface-token"
  | "google-api-key"
  | "slack-token"
  | "jwt"
  | "private-key"
  | "bearer-token"
  | "env-assignment";

export interface RedactionHit {
  kind: RedactionKind;
  count: number;
}

export interface RedactResult<T> {
  value: T;
  hits: RedactionHit[];
  redacted: boolean;
}

function marker(kind: RedactionKind): string {
  return `[REDACTED:${kind}]`;
}

/**
 * Prefix-anchored patterns. Deliberately *not* a generic high-entropy detector:
 * that is the dominant false-positive source and would shred base64 image data,
 * git SHAs, and UUIDs — all of which must survive (see tests). Entropy is only
 * trusted when a secret-ish key name vouches for it, which is `env-assignment`.
 */
const PATTERNS: ReadonlyArray<{ kind: RedactionKind; re: RegExp }> = [
  // PEM blocks first — they span lines and would otherwise be partly matched.
  {
    kind: "private-key",
    re: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  },
  { kind: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { kind: "openai-key", re: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/g },
  { kind: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { kind: "github-token", re: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { kind: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "huggingface-token", re: /\bhf_[A-Za-z0-9]{30,}/g },
  { kind: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
];

/** `SOMETHING_KEY=value` — the key name is what makes the value suspicious. */
const ENV_ASSIGNMENT =
  /^([ \t]*(?:export[ \t]+)?[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|API_?KEY)[A-Za-z0-9_]*[ \t]*=[ \t]*)(.+)$/gim;

/** Env vars whose literal values must never appear in an archive (NFR-6). */
const SECRET_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "AUTH_SECRET",
  "AUTH_GITHUB_SECRET",
  "AUTH_GITHUB_ID",
  "IDEA_HELPER_TOKEN",
  "HF_TOKEN",
] as const;

function knownSecretValues(extra: readonly string[]): string[] {
  const values = new Set<string>();
  for (const name of SECRET_ENV_VARS) {
    const v = process.env[name];
    // Short values would match everywhere; they are not credentials anyway.
    if (v && v.length >= 8) values.add(v);
  }
  for (const v of extra) if (v && v.length >= 8) values.add(v);
  // Longest first, so an overlapping shorter secret can't leave a fragment behind.
  return [...values].sort((a, b) => b.length - a.length);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class HitCounter {
  private readonly counts = new Map<RedactionKind, number>();
  add(kind: RedactionKind, n = 1) {
    if (n > 0) this.counts.set(kind, (this.counts.get(kind) ?? 0) + n);
  }
  merge(hits: readonly RedactionHit[]) {
    for (const h of hits) this.add(h.kind, h.count);
  }
  toHits(): RedactionHit[] {
    return [...this.counts].map(([kind, count]) => ({ kind, count }));
  }
}

function redactInto(text: string, extra: readonly string[], hits: HitCounter): string {
  let out = text;

  // 1. Exact known values — the session token and server env secrets.
  for (const secret of knownSecretValues(extra)) {
    const re = new RegExp(escapeRegExp(secret), "g");
    const matches = out.match(re);
    if (matches) {
      hits.add("known-secret", matches.length);
      out = out.replace(re, marker("known-secret"));
    }
  }

  // 2. Shape-based patterns.
  for (const { kind, re } of PATTERNS) {
    const matches = out.match(re);
    if (matches) {
      hits.add(kind, matches.length);
      out = out.replace(re, marker(kind));
    }
  }

  // 3. Secret-ish assignments — replace the value, keep the key readable.
  out = out.replace(ENV_ASSIGNMENT, (whole, prefix: string, value: string) => {
    if (value.trim().startsWith("[REDACTED:")) return whole;
    hits.add("env-assignment");
    return `${prefix}${marker("env-assignment")}`;
  });

  return out;
}

export function redactText(text: string, extraSecrets: readonly string[] = []): RedactResult<string> {
  const hits = new HitCounter();
  const value = redactInto(text, extraSecrets, hits);
  const list = hits.toHits();
  return { value, hits: list, redacted: list.length > 0 };
}

/** Recursively redact every string in an arbitrary JSON-ish value. */
export function redactUnknown(
  input: unknown,
  extraSecrets: readonly string[] = [],
): RedactResult<unknown> {
  const hits = new HitCounter();
  const value = walk(input, extraSecrets, hits);
  const list = hits.toHits();
  return { value, hits: list, redacted: list.length > 0 };
}

function walk(input: unknown, extra: readonly string[], hits: HitCounter): unknown {
  if (typeof input === "string") return redactInto(input, extra, hits);
  if (Array.isArray(input)) return input.map((v) => walk(v, extra, hits));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = walk(v, extra, hits);
    }
    return out;
  }
  return input;
}

/**
 * Redact a whole turn. This is the single entry point S-27 calls — text, tool
 * arguments, tool results, and provider artifacts all pass through it. Tool
 * results are the easiest leak path to forget, so they are covered explicitly.
 */
export function redactTurn(
  turn: CanonicalTurn,
  extraSecrets: readonly string[] = [],
): RedactResult<CanonicalTurn> {
  const hits = new HitCounter();

  const content = turn.content.map((part) => {
    switch (part.type) {
      case "text": {
        const r = redactText(part.text, extraSecrets);
        hits.merge(r.hits);
        return { ...part, text: r.value };
      }
      case "tool_call": {
        const r = redactUnknown(part.args, extraSecrets);
        hits.merge(r.hits);
        return { ...part, args: r.value as Record<string, unknown> };
      }
      case "tool_result": {
        const r = redactUnknown(part.result, extraSecrets);
        hits.merge(r.hits);
        return { ...part, result: r.value };
      }
      case "provider_artifact": {
        const r = redactUnknown(part.data, extraSecrets);
        hits.merge(r.hits);
        return { ...part, data: r.value };
      }
      // repo_context holds identifiers and hashes, never content.
      default:
        return part;
    }
  });

  const list = hits.toHits();
  const redacted = list.length > 0;
  return {
    value: { ...turn, content, ...(redacted ? { redacted: true } : {}) },
    hits: list,
    redacted,
  };
}

/** Human-readable summary for the UI, e.g. "1 github-token, 2 env-assignment". */
export function describeHits(hits: readonly RedactionHit[]): string {
  return hits.map((h) => `${h.count} ${h.kind}`).join(", ");
}
