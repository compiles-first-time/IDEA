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
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
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

  ${c.dim("npx idea")}                start and open your browser
  ${c.dim("npx idea --port 5000")}    use a different port
  ${c.dim("npx idea --no-open")}      don't open a browser
  ${c.dim("npx idea --host 0.0.0.0")} expose to your network ${c.yellow("(see below)")}
  ${c.dim("npx idea --dev")}          development mode

${c.yellow("--host")} makes IDEA reachable by other machines on your network. It is off by
default on purpose: IDEA can read your files and run commands. Only use it on a
network you trust.
`);
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const REQUIRED_ENV = [
  ["AUTH_SECRET", "Session secret. Generate one with:  npx auth secret"],
  ["AUTH_GITHUB_ID", "GitHub OAuth app client ID"],
  ["AUTH_GITHUB_SECRET", "GitHub OAuth app client secret"],
  ["ANTHROPIC_API_KEY", "Anthropic API key — https://console.anthropic.com/"],
  ["ALLOWED_LOGINS", "GitHub usernames allowed to sign in (comma-separated)"],
];

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
 * Fail with instructions, not a stack trace (FR-10.4). A missing key is the
 * single most likely first-run problem, so it gets the clearest message.
 */
function checkConfig(port) {
  const fromFile = readEnvFile(join(ROOT, ".env.local"));
  const missing = REQUIRED_ENV.filter(([key]) => !(process.env[key] || fromFile[key]));
  if (missing.length === 0) return true;

  console.error(`\n${c.red("IDEA isn't configured yet.")} Missing ${missing.length} setting${missing.length === 1 ? "" : "s"}.\n`);
  console.error(`Create ${c.bold(".env.local")} in ${ROOT} containing:\n`);
  for (const [key, help] of missing) {
    console.error(`  ${c.dim("#")} ${c.dim(help)}`);
    console.error(`  ${key}=\n`);
  }
  console.error(`Your GitHub OAuth app needs this callback URL:`);
  console.error(`  ${c.bold(`http://localhost:${port}/api/auth/callback/github`)}`);
  console.error(`  ${c.dim("github.com → Settings → Developer settings → OAuth Apps")}\n`);
  console.error(`${c.yellow("Note:")} ALLOWED_LOGINS fails closed — if it's empty, nobody can sign in.\n`);
  return false;
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
const NEXT_CLI = join(ROOT, "node_modules", "next", "dist", "bin", "next");

function run(args, env) {
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

  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    console.error(c.red(`Invalid port: ${args.port}`));
    process.exit(1);
  }

  const port = await findPort(args.port, args.host);
  if (port !== args.port) {
    console.log(c.dim(`Port ${args.port} is in use — using ${port} instead.`));
  }

  if (!checkConfig(port)) process.exit(1);

  // Auth.js needs to know its own origin to build the OAuth callback.
  const url = `http://localhost:${port}`;
  const env = { PORT: String(port), AUTH_URL: process.env.AUTH_URL ?? url, HOSTNAME: args.host };

  if (!args.dev && !existsSync(join(ROOT, ".next"))) {
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
