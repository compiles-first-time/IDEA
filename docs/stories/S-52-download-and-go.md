# S-52 — Download and go: `npx @ideallab/idea` with zero setup

**Phase:** 3 · **Status:** Done (code) — first publish + one GitHub checkbox remain
**Traces to:** FR-10 (doc `08`), amends FR-10.4; adds E-10.c, E-10.d · **Component:** C-37 (launcher), C-42 (device sign-in)
**Depends on:** S-36 (CLI launcher) — this finishes what it started

## The problem

"Distributed as a one-command package" was true only after five hand-set env values —
one of which was *create your own GitHub OAuth app*, a step that ends "good to go" for
anyone who is not already a developer. And the documented command, `npx idea`, installs
a **stranger's package**: the unscoped npm name has belonged to someone else for years.

## What ships

- **The real name:** `@ideallab/idea`, public, with a safe `files` whitelist (the old
  list shipped the whole `config/` directory — including the machine-local project
  registry — and omitted `vendor/` and `proxy.ts`, so a packaged install had no
  observatory and no route gate).
- **Device-code sign-in** (`lib/device-auth.ts`, `components/device-signin.tsx`):
  GitHub's flow for installed apps, as used by the `gh` CLI. IDEA shows an eight-char
  code, the user types it at github.com/login/device, done. The GitHub token never
  enters the browser — the Auth.js session is minted from a one-time server-side
  handoff. A local install that configures its own OAuth app keeps the web flow;
  hosted deployments are unchanged.
- **Self-configuring first run** (`bin/idea.mjs`): the session secret is generated and
  saved automatically; nothing hard-fails. Missing provider keys become a pointer to
  Settings, not an exit code.
- **`/get`** on the hosted deployment: the public download page — requirements, the one
  command, what first run looks like.
- **Escape from node_modules.** Next.js (Turbopack) cannot build an app that lives
  inside a node_modules directory — which is exactly where `npx` puts it. Found by the
  cold-start test, twice removed: first the launcher's hardcoded Next path assumed
  un-hoisted dependencies; then the build itself panicked. The launcher now
  materializes the app once into `~/.ideallab/idea-<version>`, installs there, and
  re-runs from that copy — which also moves `.env.local` and the build cache out of
  npx's disposable cache, and carries settings forward across version upgrades.
- **One-line installers** (`public/install.ps1`, `public/install.sh`): served by the
  site itself; check for Node 20+, install it (winget / Homebrew) when missing, then
  run `npx @ideallab/idea`. The manual path stays documented beside them.
- **Site-only mode** (`IDEA_SITE_ONLY=1`): the deployment renders as a plain product
  website — the homepage is the download page; chat, settings, and sign-in redirect
  home; the proxy passes everything through so no redirect loop can form. Remove the
  env var to bring the hosted console back.

## Exceptions

- **E-10.c** IDEA ships a public OAuth **client id** (no secret) for the device flow.
  A client id is not a credential — it appears in every ordinary OAuth redirect URL and
  identifies the app, not the user; this is the same posture as GitHub's own CLI. The
  operator can override it with `AUTH_GITHUB_ID`, and no flow in IDEA ever requires the
  matching client secret to exist anywhere but GitHub.
- **E-10.d** On a **local** install with an **empty** allowlist, the first completed
  device-code sign-in writes itself into `ALLOWED_LOGINS` as the owner. This narrows
  FR-1.3's fail-closed rule for exactly one state, because the rule's premise holds
  differently there: the server binds 127.0.0.1 (FR-10.3), so the only person who can
  complete the flow is at the machine's own keyboard — refusing them protects nobody
  and bricks every fresh install. The moment the list is non-empty, and always on
  hosted deployments, fail-closed applies unchanged (proven in
  `lib/device-auth.test.ts`).

## Done when

- [x] Device flow: pending → authorized walks GitHub's real response sequence in tests;
      handoffs redeem exactly once; a non-listed login never gets one
- [x] Empty allowlist: local claims the first login; hosted denies and claims nothing
- [x] Launcher boots a fresh install with an empty `.env.local` and says what happens
      next instead of exiting
- [x] `npm pack` contains no `.env.local`, no `config/projects.json`, and does contain
      `vendor/` and `proxy.ts`
- [ ] "Enable Device Flow" ticked on the shipped OAuth app (one checkbox, operator)
- [ ] `npm publish` of `@ideallab/idea` and a cold-start `npx @ideallab/idea` on a
      machine that has never seen IDEA
