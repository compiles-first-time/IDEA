import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import ChatWorkspace from "@/components/chat-workspace";

export default async function ChatPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="font-semibold tracking-tight">
          IDEA <span className="ml-1 text-xs font-normal text-neutral-500">console</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-400">
          {session.login && <span className="text-neutral-500">@{session.login}</span>}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <ChatWorkspace />
    </div>
  );
}
