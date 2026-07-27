import { spawn } from "node:child_process";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { z } from "zod";

import { checkPath, type ScopeContext, type ToolCall } from "@/lib/permissions";

/**
 * The tool registry (S-12 / S-14).
 *
 * Agents get real capability here — shell, read, write, list — bounded by the
 * project scope rather than by absence. Every call still passes the Rule 20
 * gate in `lib/permissions.ts` before reaching this module; nothing here
 * re-decides permission, it only executes what was already approved.
 *
 * Adding a tool is a deliberate edit to this one file.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
  /** Paths this call will touch, so the gate can scope-check before approval. */
  pathsFor: (args: Record<string, unknown>) => string[];
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the project. Paths are project-relative.",
    parameters: z.object({ path: z.string().describe("Project-relative file path") }),
    pathsFor: (a) => [String(a.path ?? "")],
  },
  {
    name: "write_file",
    description: "Write a UTF-8 text file in the project, creating directories as needed.",
    parameters: z.object({
      path: z.string().describe("Project-relative file path"),
      content: z.string().describe("Full file contents"),
    }),
    pathsFor: (a) => [String(a.path ?? "")],
  },
  {
    name: "list_files",
    description: "List files under a project-relative directory.",
    parameters: z.object({
      path: z.string().default(".").describe("Project-relative directory"),
    }),
    pathsFor: (a) => [String(a.path ?? ".")],
  },
  {
    name: "bash",
    description:
      "Run a shell command in the project directory. Destructive commands stop for confirmation.",
    parameters: z.object({ command: z.string().describe("The command line to run") }),
    // A command's paths are not statically knowable; the scope is enforced by
    // running with cwd = project root, and by the Rule 20 gate on the command.
    pathsFor: () => [],
  },
];

export const TOOL_NAMES: readonly string[] = TOOL_DEFINITIONS.map((t) => t.name);

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

/** Names a skill declared that this build does not provide. */
export function unknownTools(declared: readonly string[]): string[] {
  const known = new Set(TOOL_NAMES);
  return declared.filter((n) => !known.has(n));
}

export function pathsForCall(call: ToolCall): string[] {
  const def = getTool(call.tool);
  return def ? def.pathsFor(call.args ?? {}) : [];
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

export interface ExecOptions {
  scope: ScopeContext;
  /** Hard ceiling on a single command, so a hung process can't wedge a run. */
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_OUTPUT = 64 * 1024;

export class ToolError extends Error {}

/**
 * Execute an approved tool call.
 *
 * Preconditions the caller (the agent loop) has already satisfied: the call was
 * classified, scope-checked, and approved. This function still re-checks paths,
 * because a defence that only runs in one place is one refactor from not running
 * at all.
 */
export async function executeTool(
  call: ToolCall & { id: string },
  opts: ExecOptions,
): Promise<{ ok: boolean; result: unknown }> {
  const def = getTool(call.tool);
  if (!def) {
    return { ok: false, result: `tool "${call.tool}" is not available in this build` };
  }

  const parsed = def.parameters.safeParse(call.args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      result: `invalid arguments for ${call.tool}: ${parsed.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    };
  }
  const args = parsed.data as Record<string, unknown>;

  for (const p of def.pathsFor(args)) {
    const verdict = checkPath(p, opts.scope);
    if (!verdict.allowed) return { ok: false, result: `refused: ${verdict.reason}` };
  }

  try {
    switch (call.tool) {
      case "read_file":
        return await doRead(String(args.path), opts);
      case "write_file":
        return await doWrite(String(args.path), String(args.content), opts);
      case "list_files":
        return await doList(String(args.path ?? "."), opts);
      case "bash":
        return await doBash(String(args.command), opts);
      default:
        return { ok: false, result: `tool "${call.tool}" has no implementation` };
    }
  } catch (e) {
    return { ok: false, result: e instanceof Error ? e.message : String(e) };
  }
}

function abs(p: string, scope: ScopeContext): string {
  return resolve(scope.projectRoot, p);
}

async function doRead(path: string, opts: ExecOptions) {
  const content = await readFile(abs(path, opts.scope), "utf8");
  const max = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  return {
    ok: true,
    result:
      content.length > max
        ? `${content.slice(0, max)}\n… [truncated at ${max} bytes]`
        : content,
  };
}

async function doWrite(path: string, content: string, opts: ExecOptions) {
  const target = abs(path, opts.scope);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { ok: true, result: `wrote ${relative(opts.scope.projectRoot, target)} (${content.length} bytes)` };
}

async function doList(path: string, opts: ExecOptions) {
  const entries = await readdir(abs(path, opts.scope), { withFileTypes: true });
  return {
    ok: true,
    result: entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort(),
  };
}

/**
 * Run a shell command with `cwd` pinned to the project.
 *
 * `shell: true` is required — the model writes command lines, not argv arrays.
 * That is exactly why the Rule 20 gate runs first: the protection is the
 * classification and the confirmation, not an escaping trick.
 */
/**
 * Kill a shell-spawned command *and its children*.
 *
 * `child.kill()` only signals the shell. On Windows the real command is a
 * grandchild and keeps running — so a "timed out" command would carry on
 * holding files and burning CPU, which is precisely what the timeout exists to
 * prevent. `taskkill /T` walks the tree; on POSIX the same is done by signalling
 * the process group, which requires `detached: true` at spawn.
 */
function killTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) return Promise.resolve();

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone, or we lack permission.
    }
    return Promise.resolve();
  }

  // Await taskkill so the timeout is deterministic: when this resolves the
  // tree is actually gone, not merely asked to go.
  return new Promise((done) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    killer.on("close", () => done());
    killer.on("error", () => done());
  });
}

function doBash(command: string, opts: ExecOptions): Promise<{ ok: boolean; result: unknown }> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const max = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: opts.scope.projectRoot,
      shell: true,
      env: process.env,
      // Puts the command in its own process group so the whole tree can be
      // signalled on POSIX. Ignored on Windows, where taskkill /T is used.
      detached: process.platform !== "win32",
    });

    let out = "";
    let truncated = false;
    const append = (chunk: Buffer) => {
      if (out.length >= max) {
        truncated = true;
        return;
      }
      out += chunk.toString("utf8");
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    // Killing the process makes `close` fire immediately, so the two outcomes
    // race and `close` always wins — reporting a timed-out command as a plain
    // `exit 1`, which is exactly the kind of misleading error that sends
    // someone debugging the wrong thing. The flag makes `close` aware.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void killTree(child.pid);
    }, timeout);

    child.on("error", (e) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, result: `failed to start: ${e.message}` });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const body = out.slice(0, max) + (truncated ? `\n… [truncated at ${max} bytes]` : "");

      if (timedOut) {
        resolvePromise({
          ok: false,
          result: `command timed out after ${timeout}ms and was killed:\n${body}`,
        });
        return;
      }
      resolvePromise({
        // Exit code is reported, but the body is returned either way — a
        // failing command's output is usually the useful part.
        ok: code === 0,
        result: `exit ${code}\n${body}`,
      });
    });
  });
}
