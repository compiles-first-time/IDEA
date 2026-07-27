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
 * Clone → install → bootstrap → verify, **in this process**. The companion that
 * used to own this work no longer exists (08-local-first), and there is nothing
 * to start afterwards: a project is not a process, because IDEA's dashboard is
 * the Observatory (10-observatory-merged).
 *
 * Steps come from the **validated registry**, never from repo content (E-8.c):
 * IDEA does not read a script list out of a cloned repo and execute it.
 */

export const ProvisionStep = z.enum(["clone", "install", "bootstrap", "verify"]);
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
}

export interface ProvisionOptions {
  ideaRoot: string;
  project: ProjectRecord;
  /** Progress callback — the route streams these to the UI (FR-8.3). */
  onStep?: (outcome: StepOutcome) => void;
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
    // A Loom project keeps its event log here. Its absence is normal before the
    // first session, so it is reported rather than treated as a failure.
    const hasEventLog = existsSync(join(root, "memory", "event-log"));

    if (problems.length) return { ok: false, detail: problems.join("; ") };
    return {
      ok: true,
      detail: hasEventLog
        ? "checkout complete; event log present"
        : "checkout complete; no event log yet (normal before the first session)",
    };
  });
  if (!verify.ok) return failed(project.name, log, "verify");

  return { project: project.name, ok: true, log, failedAt: null };
}

function failed(name: string, log: StepOutcome[], step: ProvisionStep): ProvisionResult {
  return { project: name, ok: false, log, failedAt: step };
}
