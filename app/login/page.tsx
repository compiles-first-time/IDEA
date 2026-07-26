import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/chat");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">IDEA</h1>
        <p className="mt-2 text-neutral-400">Gated multi-LLM console</p>
      </div>
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
      <p className="max-w-sm text-center text-xs text-neutral-500">
        Access is limited to allow-listed GitHub accounts. If you can&apos;t get in, your login
        isn&apos;t on the allowlist.
      </p>
    </main>
  );
}
