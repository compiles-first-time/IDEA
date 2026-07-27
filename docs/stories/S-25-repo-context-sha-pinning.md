# S-25 — Repo context SHA pinning

**Phase:** 2 · **Workstream:** 7 Conversations · **Status:** Not started
**Component:** amends C-7 (`/api/repos/file`) and C-8 (`/api/chat`) · **Traces to:** FR-9.4, FR-2.3, FR-2.4
**Depends on:** nothing · **Blocks:** S-27 (needed for a faithful archive)

## Goal

Make injected repo context reproducible. Today `/api/repos/file` fetches by branch, so
"the contents of `auth.ts`" means *whatever it is right now*. The moment conversations
become durable, that's a correctness bug: resume a March conversation in July and the
model reads July's file while the transcript discusses March's.

This is **layer 2** of the fidelity model, and the largest single accuracy loss available
if we skip it — bigger than anything in the adapters or compaction.

## Scope

- `/api/repos/tree` — return each blob's `sha` alongside `path` and `size`
- `/api/repos/file` — accept an optional `sha` and fetch **by SHA when given**, falling
  back to branch resolution when not; always return the resolved `sha` and a `contentHash`
- `/api/chat` — carry pinned identifiers through into the context it builds, so the
  `repo_context` parts written by S-27 are already pinned
- Extend the Phase-1 response contracts additively

```ts
FileResponse = z.object({
  path: z.string(),
  size: z.number(),
  content: z.string(),
  sha: z.string(),          // NEW — resolved blob SHA
  contentHash: z.string(),  // NEW — hash of the bytes actually returned
});
```

## Acceptance criteria

- [ ] Fetching by `sha` returns identical bytes regardless of subsequent branch commits —
      **tested against a repo with a real second commit**, not asserted
- [ ] Omitting `sha` preserves exact Phase-1 behavior (additive change, nothing breaks)
- [ ] `contentHash` is stable and matches on re-fetch
- [ ] A `sha` that no longer exists (force-push, GC'd) returns a clear, distinguishable
      error — S-28 needs to tell "unavailable" apart from "changed"
- [ ] The 512 KB cap (E-2.b) and the 413 response still apply to SHA fetches
- [ ] Tree response includes `sha` per file without breaking existing consumers

## Exceptions honored

- **E-2.a** Still GitHub REST API only — no clone. Blob-by-SHA is a REST call.
- **E-2.b** Size cap and binary exclusion unchanged.
- **E-2.c / GE-4** Read-only. This story touches no write path.

## Notes

- Do this **before** S-27. Persisting unpinned context means every conversation written
  in the meantime has permanently unreproducible context — there is no backfill for a
  SHA you never recorded.
- Cheap story, outsized payoff. Good early pickup.
