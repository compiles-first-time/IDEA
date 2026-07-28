# S-43 — Requirements and exceptions become test cases

**Phase:** 3 · **Workstream:** 10 Requirements · **Status:** Not started
**Component:** C-41 · **Traces to:** FR-14.3, FR-14.5
**Depends on:** S-42, S-39 · **Blocks:** nothing

## Goal

Close the loop: every requirement and every exception should have a test, and
the project should say plainly which ones do not.

This is coverage against **intent**, not against code. Line coverage tells you
which statements ran. It cannot tell you that the thing you promised was never
verified, because the code implementing that promise was never written.

## Why this is within reach

`test_case` already appears **1,136 times** in the real logs, plus 664
`test_result` and 56 `test_run_summary`. The execution half exists and IDEA
already projects it. What is missing is the *link* from a test back to the
requirement or exception it verifies.

## Scope

- A test case may declare `verifies: R-1` or `verifies: R-1.E1`.
- Three states per requirement and per exception:
  - **Verified** — a linked test ran and passed.
  - **Failing** — a linked test ran and failed.
  - **Unverified / unguarded** — no linked test exists at all.
- The third state is the point. Show it as prominently as a failure — an
  untested promise and a broken one are both promises you cannot rely on, and
  only one of them is currently visible anywhere.
- Link to the provenance graph (FR-14.5): a test that ran shows its result and
  its cost.
- Suggest test cases from exceptions. An exception already names a risk and how
  to detect it — that is most of a test. **Suggest, never auto-write:** a
  generated test that asserts nothing is worse than a gap, because it turns the
  gap green.

## Not in scope

Running tests from IDEA. The project runs its own tests; IDEA reads the results.

## Done when

- A requirement with a passing linked test shows verified.
- A requirement with no linked test shows unverified, and is not visually
  quieter than a failure.
- An exception with no test shows unguarded.
- A test linked to a requirement that does not exist is reported as a broken
  link rather than ignored.
- Suggested tests are clearly marked as suggestions and are never written to disk
  by an agent.
