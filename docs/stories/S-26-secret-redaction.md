# S-26 — Secret redaction before persistence

**Phase:** 2 · **Workstream:** 7 Conversations · **Status:** Not started
**Component:** C-28 · **Traces to:** E-9.c, NFR-4, NFR-6
**Depends on:** S-02 · **Blocks:** S-27 — **hard blocker, not a nice-to-have**

## Goal

A conversation is about to become a **git commit in a repo**. Anything a user pasted into
chat — an API key, a `.env` file, a token from an error message — becomes durable,
distributable, and potentially public the moment we persist it. Git history makes it
effectively permanent even after deletion.

Loom already treats this as first-class ("secrets get redacted automatically", v0.3).
IDEA must too, before the first conversation is ever written.

## Scope

`lib/redact.ts` — pure, tested, applied on the write path in S-27.

- Pattern detection: common key formats (`sk-`, `ghp_`/`gho_`/`github_pat_`, AWS
  `AKIA`, `hf_`, Google `AIza`, bearer tokens, PEM blocks, JWTs), plus generic
  high-entropy string heuristics
- `.env`-shaped lines (`KEY=value` where the key name matches a secret-ish pattern)
- Known-value redaction: any value present in the server's own env (`ANTHROPIC_API_KEY`,
  `AUTH_SECRET`, `IDEA_HELPER_TOKEN`, the GitHub `accessToken`) is redacted on sight
- Replace with a stable, non-reversible marker: `[REDACTED:anthropic-key]`

## Acceptance criteria

- [ ] Redaction runs on **every** part before persistence — text, tool args, and tool
      results. Tool results are the easiest to forget and a common leak path.
- [ ] The session's GitHub `accessToken` can never appear in a stored transcript, tested
      explicitly
- [ ] Redaction is **not reversible** — no encrypted original stashed alongside
- [ ] Redaction markers survive round-trip through S-23's format and S-24's adapters
- [ ] The user is **told** when redaction fired on a turn, not silently altered
- [ ] Unit tests per pattern, plus false-positive tests: a base64 image blob, a git SHA,
      and a UUID must **not** be redacted
- [ ] Pure — no I/O (§C)

## Exceptions honored

- **E-9.c** Secrets never reach a commit.
- **NFR-4 Fail closed.** On ambiguity, **redact**. A false positive costs a little
  readability; a false negative publishes a credential.
- **NFR-6** Server-side keys never enter client bundles, chat, tool args — or now, archives.

## Notes / open questions

- **This gates S-27.** Do not write a single conversation to a repo before redaction is
  in place. There is no retroactive fix — a leaked key in git history means rotating the
  key, and possibly rewriting history in a repo that may already be cloned.
- Redaction is best-effort by nature and will miss novel formats. Pair it with **E-8.b**
  (new project repos default to private) so a miss isn't immediately public. Defense in
  depth: neither control is sufficient alone.
- Open: should the *chat input* warn at paste time, before the secret ever reaches the
  server? Better UX and a smaller blast radius, but client-side detection is bypassable
  and must not replace the server-side gate. Recommend both, server-side first.
