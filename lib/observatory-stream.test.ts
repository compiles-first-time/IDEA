import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EVENT_LOG_DIR, type ObservatoryState } from "@/lib/observatory";
import { sseFrame, streamProjectState } from "@/lib/observatory-stream";

const LOG = "2026-07-27.jsonl";

async function project(withLog = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "idea-stream-"));
  if (withLog) {
    await mkdir(join(dir, EVENT_LOG_DIR), { recursive: true });
    await writeFile(
      join(dir, EVENT_LOG_DIR, LOG),
      JSON.stringify({ event_type: "session_start", session_id: "s1", timestamp: "2026-07-27T10:00:00Z" }) + "\n",
    );
  }
  return dir;
}

function appendEvent(dir: string, event: Record<string, unknown>) {
  return appendFile(join(dir, EVENT_LOG_DIR, LOG), JSON.stringify(event) + "\n");
}

/** Wait until `check` passes, or give up. Avoids sleeping a fixed guess. */
async function until(check: () => boolean, timeoutMs = 6000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

/* -------------------------------------------------------------------------- */
/* Frames                                                                      */
/* -------------------------------------------------------------------------- */

test("sseFrame produces a well-formed event", () => {
  assert.equal(sseFrame("state", { a: 1 }), 'event: state\ndata: {"a":1}\n\n');
});

test("sseFrame keeps data on one line so a frame is never split", () => {
  const frame = sseFrame("state", { text: "line one\nline two" });
  const dataLines = frame.split("\n").filter((l) => l.startsWith("data: "));
  assert.equal(dataLines.length, 1, "a raw newline in the payload would break the protocol");
});

/* -------------------------------------------------------------------------- */
/* Streaming                                                                   */
/* -------------------------------------------------------------------------- */

test("emits an initial frame immediately", async (t) => {
  const dir = await project();
  const states: ObservatoryState[] = [];

  const handle = streamProjectState({
    projectRoot: dir,
    projectName: "demo",
    onState: (s) => states.push(s),
  });
  t.after(() => {
    handle.close();
    return rm(dir, { recursive: true, force: true });
  });

  assert.ok(await until(() => states.length >= 1), "the client must never stare at nothing");
  assert.equal(states[0].sessions.active.length, 1);
});

test("pushes a new projection when the log grows", async (t) => {
  const dir = await project();
  const states: ObservatoryState[] = [];

  const handle = streamProjectState({
    projectRoot: dir,
    projectName: "demo",
    onState: (s) => states.push(s),
    debounceMs: 50,
    pollMs: 400,
  });
  t.after(() => {
    handle.close();
    return rm(dir, { recursive: true, force: true });
  });

  await until(() => states.length >= 1);
  await appendEvent(dir, { event_type: "session_start", session_id: "s2", timestamp: "2026-07-27T10:01:00Z" });

  assert.ok(
    await until(() => states.some((s) => s.sessions.active.length === 2)),
    "an appended event should reach the client without being asked for",
  );
});

test("does not push when nothing changed", async (t) => {
  const dir = await project();
  const states: ObservatoryState[] = [];

  const handle = streamProjectState({
    projectRoot: dir,
    projectName: "demo",
    onState: (s) => states.push(s),
    debounceMs: 30,
    pollMs: 150,
  });
  t.after(() => {
    handle.close();
    return rm(dir, { recursive: true, force: true });
  });

  await until(() => states.length >= 1);
  const afterFirst = states.length;
  // Several poll cycles with no writes.
  await new Promise((r) => setTimeout(r, 700));

  assert.equal(states.length, afterFirst, "the poll must not resend an unchanged projection");
});

test("a burst of writes coalesces rather than emitting per line", async (t) => {
  const dir = await project();
  const states: ObservatoryState[] = [];

  const handle = streamProjectState({
    projectRoot: dir,
    projectName: "demo",
    onState: (s) => states.push(s),
    debounceMs: 150,
    pollMs: 5000,
  });
  t.after(() => {
    handle.close();
    return rm(dir, { recursive: true, force: true });
  });

  await until(() => states.length >= 1);
  const before = states.length;

  for (let i = 0; i < 10; i++) {
    await appendEvent(dir, { event_type: "tool_call", session_id: "s1", tool: `t${i}` });
  }
  await until(() => states.length > before);
  await new Promise((r) => setTimeout(r, 400));

  assert.ok(
    states.length - before <= 3,
    `ten appends produced ${states.length - before} frames; they should coalesce`,
  );
});

/* -------------------------------------------------------------------------- */
/* A project that has not run yet                                              */
/* -------------------------------------------------------------------------- */

test("streams a project with no event log, and picks it up when one appears", async (t) => {
  const dir = await project(false);
  const states: ObservatoryState[] = [];

  const handle = streamProjectState({
    projectRoot: dir,
    projectName: "fresh",
    onState: (s) => states.push(s),
    debounceMs: 50,
    pollMs: 200,
  });
  t.after(() => {
    handle.close();
    return rm(dir, { recursive: true, force: true });
  });

  assert.ok(await until(() => states.length >= 1));
  assert.equal(states[0].meta.hasEventLog, false, "an unrun project is not an error");

  // The directory appears only when the first session runs — the poll is what
  // notices, since there was nothing to watch at subscribe time.
  await mkdir(join(dir, EVENT_LOG_DIR), { recursive: true });
  await writeFile(
    join(dir, EVENT_LOG_DIR, LOG),
    JSON.stringify({ event_type: "session_start", session_id: "s1" }) + "\n",
  );

  assert.ok(
    await until(() => states.some((s) => s.meta.hasEventLog)),
    "a log created after subscribing must still be picked up",
  );
});

/* -------------------------------------------------------------------------- */
/* Cleanup                                                                     */
/* -------------------------------------------------------------------------- */

test("close stops emitting — a closed tab must not keep pushing", async (t) => {
  const dir = await project();
  const states: ObservatoryState[] = [];

  const handle = streamProjectState({
    projectRoot: dir,
    projectName: "demo",
    onState: (s) => states.push(s),
    debounceMs: 30,
    pollMs: 100,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  await until(() => states.length >= 1);
  handle.close();
  const afterClose = states.length;

  await appendEvent(dir, { event_type: "session_start", session_id: "s9" });
  await new Promise((r) => setTimeout(r, 500));

  assert.equal(states.length, afterClose, "a closed stream must release its watcher and timers");
});

test("close is idempotent", async (t) => {
  const dir = await project();
  const handle = streamProjectState({ projectRoot: dir, projectName: "demo", onState: () => {} });
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.doesNotThrow(() => {
    handle.close();
    handle.close();
  });
});

test("the process is not held open by a stream", async (t) => {
  // `persistent: false` on the watcher and a cleared interval are what let
  // `npx idea` exit on Ctrl-C rather than hanging on an open dashboard.
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./observatory-stream.ts", import.meta.url), "utf8"),
  );
  assert.match(src, /persistent:\s*false/);
  assert.match(src, /clearInterval\(poller\)/);
  t.diagnostic("watcher is non-persistent and the poller is cleared on close");
});
