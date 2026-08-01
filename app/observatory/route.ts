import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { auth } from "@/auth";
import { isHosted } from "@/lib/hosted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /observatory — the Loom Observatory weave (BR_05).
 *
 * Serves the vendored single-file reference implementation
 * (`vendor/loom-observatory.html`, spec v4) with IDEA's integration layer
 * appended. The file is served, not rewritten: the spec's packaging decision —
 * one auditable HTML file, no build step — survives intact, and every IDEA
 * change lives in the one appended script (`vendor/observatory-live.js`).
 *
 * Auth-gated like every other page. Doc `10`'s objections to the old
 * Observatory were the separate process and the port; served by IDEA there is
 * neither. The previous React panels view remains at /observatory/panels.
 */

let cached: string | null = null;

async function page(): Promise<string> {
  if (cached) return cached;
  const root = process.cwd();
  const [html, live] = await Promise.all([
    readFile(join(root, "vendor", "loom-observatory.html"), "utf8"),
    readFile(join(root, "vendor", "observatory-live.js"), "utf8"),
  ]);

  // Appended after the core script so the engine's globals exist; before
  // </body> so it still runs during initial load.
  const marker = "</body>";
  if (!html.includes(marker)) {
    throw new Error("vendor/loom-observatory.html has no </body> — refusing to serve a broken page");
  }
  cached = html.replace(
    marker,
    `<script>\n${live}\n</script>\n<div style="position:fixed;right:12px;bottom:10px;z-index:70;font:11px var(--mono,monospace);color:#7a8695"><a href="/observatory/panels" style="color:inherit">panels view</a></div>\n${marker}`,
  );
  return cached;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session) {
    return Response.redirect(new URL("/login", req.url), 307);
  }
  // The weave reads event logs off this machine's disk; a hosted deployment
  // has none. Chat is where hosted IDEA works, so land there (FR-15.3).
  if (isHosted()) {
    return Response.redirect(new URL("/chat", req.url), 307);
  }

  try {
    return new Response(await page(), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    // BR_05_SE-02: a missing vendored file is a named failure, not a blank page.
    const message = e instanceof Error ? e.message : "could not load the observatory";
    return new Response(message, { status: 500, headers: { "content-type": "text/plain" } });
  }
}
