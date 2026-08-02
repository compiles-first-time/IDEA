/**
 * Hosted mode (FR-15, doc 12-hosted-mode).
 *
 * One deployment of IDEA serves many people from a serverless host. Everything
 * that assumes a machine the user owns — repos on disk, spawned processes,
 * `.env.local`, local model endpoints — is switched off, and provider keys
 * arrive per-request from each user's own browser instead of the environment.
 *
 * The flag is environment-derived, not configuration: `VERCEL=1` is set by the
 * platform itself, and `IDEA_HOSTED=1` exists so any other serverless host (or
 * a test) can opt in explicitly. There is deliberately no way to enable hosted
 * mode from the UI — it is a property of where the process runs.
 */
export function isHosted(env: Record<string, string | undefined> = process.env): boolean {
  return env.IDEA_HOSTED === "1" || env.VERCEL === "1";
}

/**
 * Site-only mode (S-52): the deployment is a plain product website — landing
 * page and download instructions, no console. Chat, settings, and sign-in all
 * redirect home. For the phase where the hosted console is not yet meant for
 * visitors; remove the env var and the console is back.
 */
export function isSiteOnly(env: Record<string, string | undefined> = process.env): boolean {
  // Tolerant on purpose: "1", "true", or "yes" — a switch this consequential
  // must not silently no-op over the spelling of truth.
  const value = env.IDEA_SITE_ONLY?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
