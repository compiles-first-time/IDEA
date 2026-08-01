import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { DeviceSignIn } from "@/components/device-signin";
import { isHosted, isSiteOnly } from "@/lib/hosted";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ switch?: string }>;
}) {
  if (isSiteOnly()) redirect("/");
  const session = await auth();
  const { switch: switching } = await searchParams;
  if (session && !switching) redirect("/chat");

  // Which door? Hosted has a real OAuth callback — the web flow. A local
  // install that configured its own OAuth app keeps the web flow too. Every
  // other local install (i.e. a fresh download) signs in by device code,
  // which needs no setup at all (S-52).
  const webFlow = isHosted() || !!process.env.AUTH_GITHUB_SECRET;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">IDEA</h1>
        <p className="mt-2 text-neutral-400">Gated multi-LLM console</p>
      </div>

      {switching && (
        // GitHub's session is not ours to clear. Signing out of IDEA and
        // immediately back in silently re-uses the same GitHub account — exactly
        // how two similarly-named accounts got confused here. Say so, and link
        // the one action that actually works.
        <div className="max-w-md rounded-lg border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
          <p className="font-medium">You&apos;re signed out of IDEA.</p>
          <p className="mt-1 text-amber-200/80">
            GitHub keeps its own session, so signing in again will re-use the same account. To
            use a different one, sign out of GitHub first:
          </p>
          <a
            href="https://github.com/logout"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block rounded border border-amber-700 px-3 py-1 text-xs hover:bg-amber-900/40"
          >
            Sign out of GitHub ↗
          </a>
          <p className="mt-2 text-xs text-amber-200/60">
            Then come back and sign in. Both accounts must be on the allowlist.
          </p>
        </div>
      )}

      {webFlow ? (
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/chat" });
          }}
        >
          <button
            type="submit"
            className="rounded-lg bg-white px-5 py-2.5 font-medium text-black transition-colors hover:bg-neutral-200"
          >
            Sign in with GitHub
          </button>
        </form>
      ) : (
        <DeviceSignIn />
      )}
      <p className="max-w-sm text-center text-xs text-neutral-500">
        {webFlow
          ? "Access is limited to allow-listed GitHub accounts. If you can't get in, your login isn't on the allowlist."
          : "On a fresh install, the first sign-in becomes the owner. After that, access is limited to allow-listed GitHub accounts."}
      </p>
      {isHosted() && (
        <a href="/get" className="text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-300">
          Want the full platform? Run IDEA on your own machine →
        </a>
      )}
    </main>
  );
}
