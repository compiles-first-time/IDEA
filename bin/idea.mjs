#!/usr/bin/env node
/**
 * IDEA launcher (S-36, FR-10).
 *
 * Starts IDEA on this machine and opens a browser to it. Same app and same UI
 * as a hosted deployment — it just runs where your files are, so it can clone
 * repos, start the Observatory, and reach local models.
 *
 * Binds 127.0.0.1 by default (FR-10.3): not reachable from the network unless
 * you explicitly ask with --host.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 4300;

const c = {
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
};

function parseArgs(argv) {
  const args = { port: Number(process.env.PORT) || DEFAULT_PORT, host: "127.0.0.1", open: true, dev: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") args.port = Number(argv[++i]);
    else if (a === "--host") args.host = argv[++i] ?? "0.0.0.0";
    else if (a === "--no-open") args.open = false;
    else if (a === "--dev") args.dev = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function usage() {
  console.log(`
${c.bold("idea")} — run IDEA on this machine

  ${c.dim("npx @ideallab/idea")}                start and open your browser
  ${c.dim("npx @ideallab/idea --port 5000")}    use a different port
  ${c.dim("npx @ideallab/idea --no-open")}      don't open a browser
  ${c.dim("npx @ideallab/idea --host 0.0.0.0")} expose to your network ${c.yellow("(see below)")}
  ${c.dim("npx @ideallab/idea --dev")}          development mode

${c.yellow("--host")} makes IDEA reachable by other machines on your network. It is off by
default on purpose: IDEA can read your files and run commands. Only use it on a
network you trust.
`);
}

/* -------------------------------------------------------------------------- */
/* Escape node_modules (S-52)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `npx` runs this file from inside a node_modules directory — and Next.js
 * cannot build an app that lives there (Turbopack refuses to treat its files
 * as application modules; found by the cold-start test). So when we detect
 * that layout, the app is materialized once into a stable home directory,
 * dependencies installed there, and this launcher re-runs from that copy.
 *
 * A welcome side effect: `.env.local` (the owner's secret, allowlist, keys)
 * and the built `.next` live in the user's home instead of npx's disposable
 * cache, so they survive cache evictions and `npx` upgrades.
 */
async function materializeIfInsideNodeModules(argv) {
  if (!ROOT.split(sep).includes("node_modules")) return null;

  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const homeBase = join(homedir(), ".ideallab");
  const appHome = join(homeBase, `idea-${version}`);

  if (!existsSync(join(appHome, "package.json"))) {
    console.log(c.dim(`Setting up IDEA in ${appHome} — once per version.\n`));
    cpSync(ROOT, appHome, {
      recursive: true,
      filter: (src) => {
        const name = basename(src);
        return name !== "node_modules" && name !== ".next" && name !== ".env.local";
      },
    });

    // Carry the owner's config forward from the previous version, so an
    // upgrade never signs anyone out or loses their keys.
    const previous = existsSync(homeBase)
      ? readdirSync(homeBase)
          .filter((d) => d.startsWith("idea-") && d !== `idea-${version}`)
          .sort()
          .at(-1)
      : undefined;
    if (previous && existsSync(join(homeBase, previous, ".env.local"))) {
      cpSync(join(homeBase, previous, ".env.local"), join(appHome, ".env.local"));
      console.log(c.dim(`Kept your settings from ${previous}.\n`));
    }

    console.log(c.dim("Installing dependencies — a minute or two, once.\n"));
    const code = await runNpmInstall(appHome);
    if (code !== 0) {
      rmSync(appHome, { recursive: true, force: true });
      console.error(c.red("\nDependency install failed — see the output above."));
      process.exit(code ?? 1);
    }
  }

  // Hand over to the copy outside node_modules; it takes it from here.
  const child = spawn(process.execPath, [join(appHome, "bin", "idea.mjs"), ...argv], {
    cwd: appHome,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  return child;
}

/** Run `npm install --omit=dev` in a directory, wherever npm actually is. */
function runNpmInstall(cwd) {
  const args = ["install", "--omit=dev", "--no-audit", "--no-fund"];
  // Under npx/npm, npm_execpath points at npm's (or npx's) own JS entry —
  // the one binary guaranteed present. Fall back to PATH lookup otherwise.
  let execpath = process.env.npm_execpath;
  if (execpath && basename(execpath).startsWith("npx")) {
    execpath = join(dirname(execpath), "npm-cli.js");
  }
  const child =
    execpath && existsSync(execpath)
      ? spawn(process.execPath, [execpath, ...args], { cwd, stdio: "inherit" })
      : spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
          cwd,
          stdio: "inherit",
          shell: process.platform === "win32",
        });
  return new Promise((resolve) => child.on("exit", resolve));
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/** Read .env.local without a dependency — enough to check what's present. */
function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && m[2].trim()) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * First-run configuration (S-52): configure what a machine can configure for
 * itself, and say plainly what happens in the app for the rest. Nothing here
 * exits — a fresh download must reach the browser, where sign-in (device
 * flow) and provider keys (Settings) both have their own guided paths.
 */
function prepareConfig() {
  const envPath = join(ROOT, ".env.local");
  const fromFile = readEnvFile(envPath);
  const get = (key) => process.env[key] || fromFile[key];
  const notes = [];

  // The session secret is ours to invent — there is nothing to ask the user.
  if (!get("AUTH_SECRET")) {
    const secret = randomBytes(33).toString("base64");
    appendFileSync(
      envPath,
      `${existsSync(envPath) ? "\n" : ""}# Session secret — generated by IDEA on first run.\nAUTH_SECRET=${secret}\n`,
      "utf8",
    );
    process.env.AUTH_SECRET = secret;
    notes.push(`${c.green("•")} Generated a session secret ${c.dim("(saved to .env.local)")}`);
  }

  if (!get("ALLOWED_LOGINS")) {
    notes.push(`${c.green("•")} No allowlist yet — ${c.bold("the first GitHub sign-in becomes the owner")}`);
  }
  if (!get("AUTH_GITHUB_SECRET")) {
    notes.push(`${c.green("•")} Sign-in uses a GitHub device code ${c.dim("(no OAuth app setup needed)")}`);
  }

  const keyVars = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MOONSHOT_API_KEY", "DASHSCOPE_API_KEY"];
  if (!keyVars.some((k) => get(k))) {
    notes.push(`${c.yellow("•")} No provider API key yet — ${c.bold("paste yours in Settings")} after signing in`);
  }

  if (notes.length) console.log(`\n${notes.join("\n")}\n`);
}

/* -------------------------------------------------------------------------- */
/* Port + browser                                                             */
/* -------------------------------------------------------------------------- */

function portFree(port, host) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function findPort(preferred, host) {
  for (let p = preferred; p < preferred + 20; p++) {
    if (await portFree(p, host)) return p;
  }
  throw new Error(`no free port between ${preferred} and ${preferred + 19}`);
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
  } catch {
    // Not fatal — the URL is printed either way.
  }
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Run Next's JS entrypoint under this same Node binary.
 *
 * Deliberately avoids both alternatives: `shell: true` concatenates arguments
 * instead of escaping them on Windows (DEP0190), and spawning the `.bin/*.cmd`
 * shim directly fails with EINVAL on Node 20+, which refuses to execute .cmd
 * without a shell. Calling the underlying JS sidesteps both and behaves
 * identically on Windows, macOS, and Linux.
 */
function nextCli() {
  // Resolve through Node's own algorithm, starting from this file: a packed
  // install hoists dependencies to the PARENT node_modules (npx does too), a
  // git checkout keeps them in ROOT/node_modules. A hardcoded path only ever
  // found the second — the cold-start test caught it (S-52).
  try {
    return createRequire(import.meta.url).resolve("next/dist/bin/next");
  } catch {
    return join(ROOT, "node_modules", "next", "dist", "bin", "next");
  }
}

function run(args, env) {
  const NEXT_CLI = nextCli();
  if (!existsSync(NEXT_CLI)) {
    throw new Error(`Could not find Next.js at ${NEXT_CLI} — try running: npm install`);
  }
  return spawn(process.execPath, [NEXT_CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  // Inside node_modules (npx layout): hand over to a copy that isn't (S-52).
  if (await materializeIfInsideNodeModules(process.argv.slice(2))) return;

  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    console.error(c.red(`Invalid port: ${args.port}`));
    process.exit(1);
  }

  const port = await findPort(args.port, args.host);
  if (port !== args.port) {
    console.log(c.dim(`Port ${args.port} is in use — using ${port} instead.`));
  }

  prepareConfig();

  // Auth.js needs to know its own origin to build the OAuth callback.
  const url = `http://localhost:${port}`;
  const env = { PORT: String(port), AUTH_URL: process.env.AUTH_URL ?? url, HOSTNAME: args.host };

  // BUILD_ID exists only when a build FINISHED — a crashed build leaves a
  // partial .next that must not be mistaken for one (S-52 cold-start lesson).
  if (!args.dev && !existsSync(join(ROOT, ".next", "BUILD_ID"))) {
    console.log(c.dim("First run — building. This happens once.\n"));
    const build = run(["build"], env);
    const code = await new Promise((r) => build.on("exit", r));
    if (code !== 0) {
      console.error(c.red("\nBuild failed. See the output above."));
      process.exit(code ?? 1);
    }
  }

  const mode = args.dev ? "dev" : "start";
  console.log(`\n  ${c.bold("IDEA")} ${c.dim(`(${mode})`)}\n  ${c.green(url)}\n`);
  if (args.host !== "127.0.0.1") {
    console.log(`  ${c.yellow("Exposed on")} ${args.host} ${c.yellow("— reachable from your network.")}\n`);
  }

  const server = run([mode, "--port", String(port), "--hostname", args.host], env);

  if (args.open) setTimeout(() => openBrowser(url), args.dev ? 3000 : 1200);

  const stop = () => server.kill();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error(c.red(`\n${e.message}`));
  process.exit(1);
});
