# S-02 — Test harness for deterministic libs

**Phase:** 2 foundation · **Workstream:** Foundation · **Status:** ✅ **Done** (2026-07-26)
**Component:** — · **Traces to:** NFR-1 (determinism first), AD-3
**Depends on:** nothing · **Blocks:** S-04, S-07, S-08, S-11, S-15

## Goal

NFR-1 says routing, cost math, fit classification, and manifest parsing are "plain code
**with unit tests**." There is currently no test runner and no `test` script in
`package.json`. Every deterministic story below is untestable until this lands.

## Scope

- Pick a runner and wire it up. Recommend **`node --test`** with `tsx` — zero new
  framework, no config, runs TypeScript directly. Vitest is the alternative if we want
  watch mode and richer assertions.
- `npm test` script; tests colocated as `lib/*.test.ts` or under `lib/__tests__/`
- One trivial passing test to prove the harness works
- Decide whether tests run in CI (no CI exists yet — probably a Phase-3 concern)

## Acceptance criteria

- [x] `npm test` runs and passes — 3/3
- [x] `npm run typecheck` still passes with test files present
- [x] Test files are excluded from the Next.js build — **verified via `npm run build`**
- [x] A one-line note in `AGENTS.md`: pure `lib/` functions ship with tests

## Outcome

Chose **`tsx --test`** — Node's built-in runner, no framework, TypeScript directly.
Node v24.16.0, `tsx@^4.23.1` as the only new devDependency.

```json
"test":       "tsx --test \"lib/**/*.test.ts\"",
"test:watch": "tsx --test --watch \"lib/**/*.test.ts\""
```

Smoke tests in `lib/harness.test.ts` cover three things, deliberately: that TypeScript
executes under the runner, that the `@/` path alias resolves (lib code depends on it, and
it's the most likely thing to silently break), and one real assertion against
`unauthorized()`.

**No `tsconfig.json` change was needed.** Tests are typechecked by both `tsc --noEmit` and
Next's build step — which is what we want — and are not bundled, because no route imports
them. Verified: `npm run build` compiles clean and the route list contains no test
artifacts. Adding an `exclude` would have lost the typechecking for no benefit.

## Exceptions honored

- Tests cover **pure functions only**. API routes and UI are not unit-tested in Phase 2 —
  they're thin by design (§3 of the architecture spec) and the logic lives in `lib/`.

## Notes

- Keep the harness boring. The point is to make NFR-1 enforceable, not to build a
  testing culture from scratch.
