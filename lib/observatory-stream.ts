import { watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { EVENT_LOG_DIR, projectState, redactState, type ObservatoryState } from "@/lib/observatory";

/**
 * Live Observatory updates (FR-12.4).
 *
 * Agents write to the event log while the user watches, so the dashboard
 * streams rather than waiting to be asked. This is the same shape Loom's own
 * Observatory uses — SSE over a file watcher — with the projection running in
 * IDEA instead of a per-project server.
 */

/** Writes arrive in bursts; coalesce them so one save is one update. */
export const DEBOUNCE_MS = 250;

/**
 * `fs.watch` misses events on some platforms and network drives, so a slow
 * poll backs it up. Without it a user on an unlucky filesystem sees a dashboard
 * that silently stops updating — worse than one that updates a little late.
 */
export const POLL_FALLBACK_MS = 5_000;

export interface StreamOptions {
  projectRoot: string;
  projectName: string;
  /** Called with a fresh projection whenever the log changes. */
  onState: (state: ObservatoryState) => void;
  onError?: (error: Error) => void;
  debounceMs?: number;
  pollMs?: number;
}

export interface StreamHandle {
  /** Stop watching and release every timer and handle. */
  close: () => void;
}

/**
 * Watch a project's event log and emit a fresh projection on change.
 *
 * Emits the **full state** each time rather than a diff. The projection is
 * already bounded by file and event caps, and a full snapshot cannot drift out
 * of sync with the client the way an incremental stream can.
 */
export function streamProjectState(opts: StreamOptions): StreamHandle {
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const pollMs = opts.pollMs ?? POLL_FALLBACK_MS;
  const logDir = join(opts.projectRoot, EVENT_LOG_DIR);

  let closed = false;
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let poller: NodeJS.Timeout | null = null;
  let projecting = false;
  let pendingWhileBusy = false;
  let lastSignature = "";

  async function emit(force = false) {
    if (closed) return;
    // A re-projection triggered mid-flight is deferred, not run concurrently —
    // two overlapping folds would waste work and could emit out of order.
    if (projecting) {
      pendingWhileBusy = true;
      return;
    }
    projecting = true;
    try {
      const state = redactState(await projectState(opts.projectRoot, opts.projectName));
      const signature = `${state.meta.eventsRead}:${state.meta.newestEventAt ?? ""}`;
      // The poll fires on a timer whether or not anything changed; only push
      // when the projection actually moved.
      if (force || signature !== lastSignature) {
        lastSignature = signature;
        if (!closed) opts.onState(state);
      }
    } catch (e) {
      opts.onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      projecting = false;
      if (pendingWhileBusy && !closed) {
        pendingWhileBusy = false;
        void emit();
      }
    }
  }

  function schedule() {
    if (closed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void emit(), debounceMs);
  }

  function startWatching() {
    if (closed || watcher || !existsSync(logDir)) return;
    try {
      watcher = watch(logDir, { persistent: false }, (_event, filename) => {
        if (!filename || filename.toString().endsWith(".jsonl")) schedule();
      });
      watcher.on("error", () => {
        // A watcher that dies leaves the poll as the only signal; drop it and
        // let the poll try to re-establish one.
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  }

  // First frame immediately, so the client is never staring at nothing.
  void emit(true);
  startWatching();

  poller = setInterval(() => {
    // The log directory may not exist until the first session runs.
    if (!watcher) startWatching();
    void emit();
  }, pollMs);

  return {
    close() {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (poller) clearInterval(poller);
      watcher?.close();
      watcher = null;
    },
  };
}

/** Format one Server-Sent Event frame. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
