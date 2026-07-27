import { createHash } from "node:crypto";

/**
 * Stable content hash for pinned repo context (S-25, FR-9.4).
 *
 * Used to prove that a blob re-fetched by SHA is byte-identical to what a model
 * originally saw. Distinct from the git blob SHA: that identifies *which* object
 * GitHub returned, this verifies the bytes we actually decoded and injected.
 */
export function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/** True when `content` still hashes to `expected`. Never throws. */
export function matchesHash(content: string, expected: string): boolean {
  return contentHash(content) === expected;
}
