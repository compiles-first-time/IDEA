# S-36 — CLI launcher

**Phase:** 2 · **Workstream:** 0 Foundation · **Status:** ✅ **Done** (2026-07-27)
**Component:** C-37 · **Traces to:** FR-10.1–10.4, E-10.a, E-10.b
**Depends on:** nothing · **Blocks:** nothing (it's how everything else is reached)

## Goal

One command starts IDEA on the user's machine and opens their browser to it. Same app,
same UI, same GitHub sign-in — served locally so it can reach the user's files.

This is the deliverable that replaced the Vercel deployment
([08-local-first.md](../architecture/08-local-first.md)).

## Scope

`bin/idea.mjs`, wired as the package's `bin` entry and `npm start`.

```
npx idea                  start and open a browser
npx idea --port 5000      use a different port
npx idea --no-open        don't open a browser
npx idea --host 0.0.0.0   expose to the network (opt-in)
npx idea --dev            development mode
```

## Acceptance criteria

- [x] Starts the app and serves it — `/login` returns 200, API routes return 401
      unauthenticated (verified end to end)
- [x] Binds **`127.0.0.1` by default** (FR-10.3); `--host` is an explicit opt-in and
      prints a warning when used
- [x] Missing configuration prints **actionable setup steps**, including the exact
      OAuth callback URL for the chosen port — not a stack trace (FR-10.4)
- [x] Builds automatically on first run, then starts
- [x] Finds the next free port when the preferred one is taken, and says so
- [x] Sets `AUTH_URL` so the OAuth callback matches the port actually in use
- [x] Cross-platform browser open (Windows / macOS / Linux)
- [x] Ctrl-C stops the server cleanly
- [x] No extra runtime dependency — `.env.local` is parsed with a few lines rather than
      pulling in a dotenv package

## Exceptions honored

- **E-10.a** No native executable, no code signing, no auto-updater.
- **E-10.b** No public bind by default.
- **FR-1.3** The launcher does not weaken the fail-closed allowlist — it *surfaces* it,
  warning that an empty `ALLOWED_LOGINS` means nobody can sign in.

## Outcome

Two spawn approaches were tried and rejected before landing on the third:

1. **`shell: true`** — works, but Node raises `DEP0190`: on Windows the shell
   concatenates arguments rather than escaping them, which is an injection risk.
2. **Spawning `node_modules/.bin/next.cmd` directly** — fails with `EINVAL` on
   Node 20+, which refuses to execute `.cmd` without a shell (a CVE-2024-27980 fix).
3. **Running Next's JS entrypoint under `process.execPath`** ✅ — no shim, no shell,
   identical behavior on all three platforms.

Port default is **4300**, chosen to avoid colliding with Next's usual 3000 and with
Loom's Observatory on 4040.

## Notes

- The build-on-first-run check is `existsSync(".next")`. If the package ever ships
  prebuilt, that check short-circuits and startup is instant.
- `--host` is the one genuinely dangerous flag: IDEA can read files and run commands,
  so exposing it to a network is a real decision. It warns on every start when set.
