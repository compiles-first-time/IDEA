import { auth, signOut } from "@/auth";
import { NavLink } from "@/components/nav-link";

/**
 * The app-wide nav.
 *
 * Every page was reachable only by typing its URL, which meant the Observatory
 * and the routing settings effectively did not exist for anyone who did not
 * already know the routes. A feature you cannot navigate to is not shipped.
 *
 * Rendered from the root layout and hidden when signed out, so `/login` stays a
 * bare page and no route is advertised to someone who cannot open it.
 */
export async function Nav() {
  const session = await auth();
  if (!session) return null;

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
      <div className="flex items-center gap-1">
        <span className="mr-2 font-semibold tracking-tight">IDEA</span>
        <NavLink href="/chat" label="Chat" />
        <NavLink href="/projects" label="Projects" />
        <NavLink href="/observatory" label="Observatory" />
        <NavLink href="/settings" label="Settings" />
      </div>
      <div className="flex items-center gap-3 text-sm">
        {session.login && <span className="text-neutral-500">@{session.login}</span>}
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
