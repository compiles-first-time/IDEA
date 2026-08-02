import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { GetIdea } from "@/components/get-idea";
import { isSiteOnly } from "@/lib/hosted";

export default async function Home() {
  // Site-only (S-52): the deployment is a product website — the homepage IS
  // the download page, and nothing asks anyone to sign in.
  if (isSiteOnly()) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-8 p-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">IDEA</h1>
          <p className="mt-3 max-w-2xl text-neutral-400">
            A multi-model chat and agent console that runs on your own computer — your repos,
            your keys, agents that write code, and an observatory of everything they did.
          </p>
        </div>
        <GetIdea />
      </div>
    );
  }

  const session = await auth();
  redirect(session ? "/chat" : "/login");
}
