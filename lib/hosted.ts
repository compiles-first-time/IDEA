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
