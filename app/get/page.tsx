import { GetIdea } from "@/components/get-idea";

/**
 * /get — how to run the full IDEA on your own machine (S-52).
 *
 * Deliberately public (not in the proxy matcher, no auth() call): its whole
 * job is to hand the install command to someone who cannot sign in to the
 * hosted console yet, or wants more than it offers.
 */
export default function GetPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-8 overflow-auto p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Run IDEA on your machine</h1>
        <p className="mt-2 text-neutral-400">
          The hosted console is chat only. On your own computer, IDEA is the whole platform:
          your projects, agents that write code, the requirements board, and the observatory.
        </p>
      </div>
      <GetIdea />
    </main>
  );
}
