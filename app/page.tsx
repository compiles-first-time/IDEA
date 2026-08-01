import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GetIdea } from "@/components/get-idea";
import { isSiteOnly } from "@/lib/hosted";

export default async function Home() {
  // Site-only (S-52): the deployment is a product website — the homepage IS
  // the download page, and nothing asks anyone to sign in.
  if (isSiteOnly()) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-10 overflow-auto p-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">IDEA</h1>
          <p className="mt-3 text-neutral-400">
            A multi-model chat and agent console that runs on your own computer — your repos,
            your keys, agents that write code, and an observatory of everything they did.
          </p>
        </div>
        <GetIdea />
      </main>
    );
  }

  const session = await auth();
  redirect(session ? "/chat" : "/login");
}
