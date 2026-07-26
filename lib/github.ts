import { Octokit } from "@octokit/rest";
import { auth } from "@/auth";

/** Octokit authenticated as the signed-in user, or null if unauthenticated. */
export async function authedOctokit(): Promise<Octokit | null> {
  const session = await auth();
  if (!session?.accessToken) return null;
  return new Octokit({ auth: session.accessToken });
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
