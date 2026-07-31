/**
 * Who may change shared, upstream repositories (E-11.a, amended 2026-07-31).
 *
 * The original rule was absolute: no agent ever writes to `loom-template`. The
 * owner has narrowed it — *they* may, through IDEA, because they maintain it.
 * Everyone else still cannot.
 *
 * This is deliberately its own module rather than a check inside
 * `lib/permissions.ts`. That module answers "is this path in scope"; this one
 * answers "who is asking". Keeping them apart is what will let the second
 * question grow into roles or groups without touching the path checker — and it
 * keeps an identity allowlist out of a file where nobody would look for one.
 *
 * ## Where this is going
 *
 * The owner wants roles or groups eventually. The shape below is a deliberate
 * stepping stone, not a placeholder: a *capability* is asked for by name
 * (`write:loom-template`), and the answer happens to come from a list today. A
 * role table can replace the lookup without changing a single call site. Asking
 * "is this person an admin" instead would have to be rewritten everywhere the
 * moment roles arrive.
 */

/** Capabilities that can be granted. Named for what they permit, not who holds them. */
export const CAPABILITIES = ["write:loom-template"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Accounts that maintain `loom-template`.
 *
 * Both of the owner's GitHub accounts: they browse as one and use the command
 * line as the other, which is how a sign-in failure took several rounds to
 * diagnose earlier. Overridable by env so this file is not the only way to
 * change it — but it fails closed if the env var is empty rather than falling
 * back to "anyone".
 */
export const DEFAULT_LOOM_MAINTAINERS = ["compiles-first-time", "compiles-first-try"] as const;

function configured(env: Record<string, string | undefined>): string[] {
  const raw = env.LOOM_MAINTAINERS;
  if (raw === undefined) return [...DEFAULT_LOOM_MAINTAINERS];
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // An env var set to an empty string means "nobody", and is honoured as such.
  // Silently restoring the defaults would ignore a deliberate lockout.
  return parsed;
}

/**
 * May this login exercise this capability?
 *
 * Fails closed on every uncertain input: no login, blank login, unknown
 * capability. GitHub logins are case-insensitive, so comparison is lowercased —
 * locking the owner out of their own template over capitalisation would be a
 * bug, not security.
 */
export function can(
  login: string | null | undefined,
  capability: Capability,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!CAPABILITIES.includes(capability)) return false;
  const who = String(login ?? "").trim().toLowerCase();
  if (!who) return false;

  if (capability === "write:loom-template") {
    return configured(env).includes(who);
  }
  return false;
}

/** Convenience for the one capability that exists today. */
export function isLoomMaintainer(
  login: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return can(login, "write:loom-template", env);
}

/**
 * Why a capability was refused, in words the person can act on.
 *
 * Same discipline as the sign-in allowlist: a refusal that does not say who was
 * refused leaves the operator guessing, and the fix is usually one line of
 * configuration.
 */
export function denialReason(
  login: string | null | undefined,
  capability: Capability,
  env: Record<string, string | undefined> = process.env,
): string {
  const who = String(login ?? "").trim().toLowerCase();
  if (!who) return `Not signed in, so no one is authorised for "${capability}".`;
  if (capability === "write:loom-template") {
    const list = configured(env);
    return list.length === 0
      ? `No one is currently a loom-template maintainer (LOOM_MAINTAINERS is empty), so "${who}" cannot change it.`
      : `"${who}" does not maintain loom-template (maintainers: ${list.join(", ")}). ` +
          `Work in a project seeded from it, or add this account to LOOM_MAINTAINERS.`;
  }
  return `"${who}" is not authorised for "${capability}".`;
}
