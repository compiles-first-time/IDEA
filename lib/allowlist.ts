/**
 * Sign-in allowlist (NFR-4).
 *
 * IDEA can read files and run commands on the machine it runs on, so who may
 * sign in is a security boundary, not a preference. This fails closed: an unset
 * or empty allowlist denies everyone, including the person who started it.
 *
 * Pure so it can be tested — `auth.ts` holds the Auth.js wiring and no logic.
 */

/** Split the `ALLOWED_LOGINS` env value into comparable logins. */
export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * May this GitHub login sign in?
 *
 * GitHub logins are case-insensitive — `Compiles-First-Time` and
 * `compiles-first-time` are the same account — so both sides are lowercased. A
 * case mismatch locking someone out of their own machine would be a bug, not
 * security.
 */
export function isAllowed(login: string | undefined | null, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  const normalized = String(login ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return allowlist.includes(normalized);
}

/**
 * Why a sign-in was refused, in words the person running IDEA can act on.
 *
 * A bare "Access Denied" is unhelpful when the fix is a one-line env change: the
 * operator cannot see which account the browser actually used, and GitHub lets
 * you hold several. Naming the rejected login is safe — a username is public,
 * and this goes to the local server log, not the browser.
 */
export function denialReason(login: string | undefined | null, allowlist: string[]): string {
  const normalized = String(login ?? "").trim().toLowerCase();
  if (allowlist.length === 0) {
    return "ALLOWED_LOGINS is empty, so no one can sign in. Set it in .env.local to your GitHub username.";
  }
  if (!normalized) {
    return `GitHub did not return a username, so the sign-in could not be checked against ALLOWED_LOGINS (${allowlist.join(", ")}).`;
  }
  return `"${normalized}" is not in ALLOWED_LOGINS (${allowlist.join(", ")}). If that is your account, add it; if it is not, sign out of GitHub and sign in as an allow-listed account.`;
}
