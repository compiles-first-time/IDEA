/**
 * The download instructions (S-52) — rendered at /get always, and as the
 * homepage in site-only mode. Server component, no state, nothing secret.
 *
 * Two tiers on purpose: the one-line installers handle Node themselves (the
 * scripts live in /public and are served by this same site), and the manual
 * path below stays for people who read before they pipe to a shell — a habit
 * worth respecting, not talking anyone out of.
 */
export function GetIdea() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Install with one command</h2>
        <p className="text-sm text-neutral-400">
          Checks for Node.js, installs it if missing, then starts IDEA and opens your browser.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Windows — PowerShell
            </p>
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm">
              irm https://idea-ideallab.vercel.app/install.ps1 | iex
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
              macOS / Linux — Terminal
            </p>
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm">
              curl -fsSL https://idea-ideallab.vercel.app/install.sh | bash
            </pre>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Or step by step</h2>
        <ol className="grid gap-5 text-sm lg:grid-cols-2">
          <li className="space-y-1">
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
          <li className="space-y-1">
            <p className="font-medium text-neutral-200">2 · Run one command</p>
            <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm">
              npx @ideallab/idea
            </pre>
            <p className="text-neutral-400">
              First run downloads and builds — a few minutes, once. Then your browser opens by
              itself.
            </p>
          </li>
          <li className="space-y-1">
            <p className="font-medium text-neutral-200">3 · Sign in with GitHub</p>
            <p className="text-neutral-400">
              IDEA shows a short code — type it at github.com when asked. No setup, no
              configuration files. The first account to sign in becomes the owner of that
              install.
            </p>
          </li>
          <li className="space-y-1">
            <p className="font-medium text-neutral-200">4 · Add a model key</p>
            <p className="text-neutral-400">
              Open Settings and paste an API key for whichever models you use — Claude, GPT,
              Gemini, Kimi, or Qwen. Keys stay on your machine.
            </p>
          </li>
        </ol>
      </section>

      <p className="text-xs text-neutral-500">
        Everything runs and stays on your computer — repositories, conversations, keys. IDEA
        binds to 127.0.0.1, so nothing is reachable from your network unless you explicitly ask
        for it.
      </p>
    </div>
  );
}
