/**
 * /get — how to run the full IDEA on your own machine (S-52).
 *
 * Deliberately public (not in the proxy matcher, no auth() call): its whole
 * job is to hand the install command to someone who cannot sign in to the
 * hosted console yet, or wants more than it offers. Nothing here is secret —
 * it is documentation with good typography.
 */
export default function GetPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-8 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Run IDEA on your machine</h1>
        <p className="mt-2 text-neutral-400">
          The hosted console is chat only. On your own computer, IDEA is the whole platform:
          your projects, agents that write code, the requirements board, and the observatory.
        </p>
      </div>

      <ol className="space-y-6 text-sm">
        <li className="space-y-1.5">
          <p className="font-medium text-neutral-200">
            1 · Install Node.js <span className="text-neutral-500">(version 20 or newer)</span>
          </p>
          <p className="text-neutral-400">
            From{" "}
            <a
              href="https://nodejs.org"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-neutral-200"
            >
              nodejs.org
            </a>{" "}
            — the standard download, default options.
          </p>
        </li>

        <li className="space-y-1.5">
          <p className="font-medium text-neutral-200">2 · Run one command</p>
          <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm">
            npx @ideallab/idea
          </pre>
          <p className="text-neutral-400">
            First run downloads and builds — a few minutes, once. Then your browser opens by
            itself.
          </p>
        </li>

        <li className="space-y-1.5">
          <p className="font-medium text-neutral-200">3 · Sign in with GitHub</p>
          <p className="text-neutral-400">
            IDEA shows a short code — type it at github.com when asked. No setup, no
            configuration files. The first account to sign in becomes the owner of that
            install.
          </p>
        </li>

        <li className="space-y-1.5">
          <p className="font-medium text-neutral-200">4 · Add a model key</p>
          <p className="text-neutral-400">
            Open Settings and paste an API key for whichever models you use — Claude, GPT,
            Gemini, Kimi, or Qwen. Keys stay on your machine.
          </p>
        </li>
      </ol>

      <p className="text-xs text-neutral-500">
        Everything runs and stays on your computer — repositories, conversations, keys. IDEA
        binds to 127.0.0.1, so nothing is reachable from your network unless you explicitly ask
        for it.
      </p>
    </main>
  );
}
