import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  hasDependencies,
  isProvisioned,
  projectRoot,
  type ProjectRecord,
} from "@/lib/projects";

/**
 * Provisioning (S-29, FR-8.3–8.7).
 *
 * Clone → install → bootstrap → verify → start, **in this process**. The
 * companion that used to own this work no longer exists
 * ([08-local-first](../../docs/architecture/08-local-first.md)); there is no
 * worker, no polling, and no token to pass.
 *
 * Steps come from the **validated registry**, never from repo content (E-8.c):
 * IDEA does not read a script list out of a cloned repo and execute it.
 */

export const ProvisionStep = z.enum(["clone", "install", "bootstrap", "verify", "start"]);
export type ProvisionStep = z.infer<typeof ProvisionStep>;

export const StepOutcome = z.object({
  step: ProvisionStep,
  ok: z.boolean(),
  skipped: z.boolean().default(false),
  detail: z.string(),
  durationMs: z.number().int().nonnegative(),
});
export type StepOutcome = z.infer<typeof StepOutcome>;

export interface ProvisionResult {
  project: string;
  ok: boolean;
  log: StepOutcome[];
  /** The step that failed, if any. */
  failedAt: ProvisionStep | null;
  pid: number | null;
}

export interface ProvisionOptions {
  ideaRoot: string;
  project: ProjectRecord;
  /** Progress callback — the route streams these to the UI (FR-8.3). */
  onStep?: (outcome: StepOutcome) => void;
  /** Skip `start`; useful when the caller only wants the checkout ready. */
  startDashboard?: boolean;
  timeoutMs?: number;
  /** Injected for tests. */
  run?: RunCommand;
}

export const DEFAULT_STEP_TIMEOUT_MS = 10 * 60_000;

export type RunCommand = (
  argv: readonly string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ ok: boolean; output: string }>;

export class ProvisionError extends Error {}

/* -------------------------------------------------------------------------- */
/* Command execution                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Run a command as an **argv array, never a shell string**.
 *
 * Provisioning arguments come from the registry — a repo URL, a directory name
 * — and a shell would let a hostile value in either become command injection.
 * The agent-facing `bash` tool deliberately does use a shell, but that path is
 * gated by Rule 20; this one is not user-directed at all, so it takes the
 * stricter option.
 */
export const runCommand: RunCommand = (argv, opts) =>
  new Promise((resolvePromise) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { cwd: opts.cwd, shell: false });

    let output = "";
    const append = (c: Buffer) => {
      if (output.length < 32_768) output += c.toString("utf8");
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.on("error", (e) => {
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        output:
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? `\`${cmd}\` was not found on your PATH. Install it and try again.`
            : e.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolvePromise({ ok: false, output: `timed out after ${opts.timeoutMs}ms\n${output}` });
        return;
      }
      resolvePromise({ ok: code === 0, output });
    });
  });

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Provision a project.
 *
 * **Idempotent** (FR-8.6): an existing checkout skips `clone`, existing
 * dependencies skip `install`. Re-running after a partial failure resumes
 * rather than requiring a manual wipe.
 */
export async function provision(opts: ProvisionOptions): Promise<ProvisionResult> {
  const { ideaRoot, project } = opts;
  const run = opts.run ?? runCommand;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const root = projectRoot(ideaRoot, project);
  const log: StepOutcome[] = [];

  const record = (o: StepOutcome) => {
    log.push(o);
    opts.onStep?.(o);
    return o;
  };

  const timed = async (
    step: ProvisionStep,
    fn: () => Promise<{ ok: boolean; detail: string; skipped?: boolean }>,
  ): Promise<StepOutcome> => {
    const started = Date.now();
    let outcome: { ok: boolean; detail: string; skipped?: boolean };
    try {
      outcome = await fn();
    } catch (e) {
      outcome = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    return record(
      StepOutcome.parse({
        step,
        ok: outcome.ok,
        skipped: outcome.skipped ?? false,
        detail: outcome.detail,
        durationMs: Date.now() - started,
      }),
    );
  };

  /* clone ---------------------------------------------------------------- */
  const clone = await timed("clone", async () => {
    if (isProvisioned(ideaRoot, project)) {
      return { ok: true, skipped: true, detail: "already cloned" };
    }
    await mkdir(dirname(root), { recursive: true });
    const r = await run(["git", "clone", project.gitUrl, root], { cwd: ideaRoot, timeoutMs });
    return { ok: r.ok, detail: r.ok ? `cloned ${project.gitUrl}` : r.output };
  });
  if (!clone.ok) return failed(project.name, log, "clone");

  /* install -------------------------------------------------------------- */
  const install = await timed("install", async () => {
    if (!existsSync(join(root, "package.json"))) {
      return { ok: true, skipped: true, detail: "no package.json — nothing to install" };
    }
    if (hasDependencies(ideaRoot, project)) {
      return { ok: true, skipped: true, detail: "dependencies already installed" };
    }
    const r = await run(["npm", "install"], { cwd: root, timeoutMs });
    return { ok: r.ok, detail: r.ok ? "dependencies installed" : r.output };
  });
  if (!install.ok) return failed(project.name, log, "install");

  /* bootstrap ------------------------------------------------------------ */
  const bootstrap = await timed("bootstrap", async () => {
    // Loom's bootstrap threads the warp into a new project. It runs only when
    // the project declares it, and the command is not read from repo content.
    const marker = join(root, "constitution", "kernel-v6.md");
    if (existsSync(marker)) {
      return { ok: true, skipped: true, detail: "already bootstrapped" };
    }
    if (!existsSync(join(root, "scripts", "bootstrap.mjs"))) {
      return { ok: true, skipped: true, detail: "no bootstrap script in this project" };
    }
    const r = await run(["node", "scripts/bootstrap.mjs"], { cwd: root, timeoutMs });
    return { ok: r.ok, detail: r.ok ? "bootstrapped" : r.output };
  });
  if (!bootstrap.ok) return failed(project.name, log, "bootstrap");

  /* verify --------------------------------------------------------------- */
  const verify = await timed("verify", async () => {
    const problems: string[] = [];
    if (!existsSync(join(root, ".git"))) problems.push("no .git directory after clone");
    const launchFile = project.launch.split(/\s+/).slice(1)[0];
    if (launchFile && !existsSync(join(root, launchFile))) {
      problems.push(`launch target "${launchFile}" is missing`);
    }
    return problems.length
      ? { ok: false, detail: problems.join("; ") }
      : { ok: true, detail: "checkout looks complete" };
  });
  if (!verify.ok) return failed(project.name, log, "verify");

  /* start ---------------------------------------------------------------- */
  if (opts.startDashboard === false) {
    record(
      StepOutcome.parse({
        step: "start",
        ok: true,
        skipped: true,
        detail: "not requested",
        durationMs: 0,
      }),
    );
    return { project: project.name, ok: true, log, failedAt: null, pid: null };
  }

  const started = await startDashboard(ideaRoot, project);
  record(
    StepOutcome.parse({
      step: "start",
      ok: started.ok,
      skipped: false,
      detail: started.detail,
      durationMs: 0,
    }),
  );
  return {
    project: project.name,
    ok: started.ok,
    log,
    failedAt: started.ok ? null : "start",
    pid: started.pid,
  };
}

function failed(name: string, log: StepOutcome[], step: ProvisionStep): ProvisionResult {
  return { project: name, ok: false, log, failedAt: step, pid: null };
}

/* -------------------------------------------------------------------------- */
/* Dashboard process                                                           */
/* -------------------------------------------------------------------------- */

const running = new Map<string, { pid: number }>();

/**
 * Start a project's dashboard.
 *
 * The launch command comes from the validated registry and is split into argv —
 * no shell (E-8.c). Returns once the process is spawned; liveness is decided by
 * probing the port, not by trusting a stored pid, so the answer survives a
 * restart of IDEA itself.
 */
export async function startDashboard(
  ideaRoot: string,
  project: ProjectRecord,
): Promise<{ ok: boolean; detail: string; pid: number | null }> {
  if (await isDashboardUp(project)) {
    return { ok: true, detail: "already running", pid: running.get(project.name)?.pid ?? null };
  }

  const root = projectRoot(ideaRoot, project);
  const argv = project.launch.split(/\s+/).filter(Boolean);
  if (argv.length === 0) return { ok: false, detail: "no launch command configured", pid: null };

  const child = spawn(argv[0], argv.slice(1), {
    cwd: root,
    shell: false,
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  child.unref();

  if (child.pid === undefined) {
    return { ok: false, detail: "failed to spawn the dashboard", pid: null };
  }
  running.set(project.name, { pid: child.pid });

  // Wait for the port to answer rather than optimistically reporting success.
  for (let i = 0; i < 40; i++) {
    if (await isDashboardUp(project)) {
      return { ok: true, detail: `listening on ${project.dashboardUrl}`, pid: child.pid };
    }
    await sleep(250);
  }
  return {
    ok: false,
    detail: `started (pid ${child.pid}) but ${project.dashboardUrl} did not answer within 10s`,
    pid: child.pid,
  };
}

export async function stopDashboard(project: ProjectRecord): Promise<{ ok: boolean; detail: string }> {
  const entry = running.get(project.name);
  if (!entry) return { ok: true, detail: "not started by this process" };
  try {
    process.kill(entry.pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  running.delete(project.name);
  return { ok: true, detail: `stopped pid ${entry.pid}` };
}

/** Liveness by probe, never by remembered pid. */
export async function isDashboardUp(project: ProjectRecord): Promise<boolean> {
  try {
    const res = await fetch(project.dashboardUrl, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
