import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ChatWorkspace from "@/components/chat-workspace";

export default async function ChatPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // The header (and sign-out) now live in the app-wide nav in the root layout,
  // so every page has them instead of just this one. `min-h-0` lets the chat
  // pane scroll inside the remaining height rather than pushing the page down.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatWorkspace />
    </div>
  );
}
