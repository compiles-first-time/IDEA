import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { chainFor, loadRoutingConfig, unreachableEntries } from "@/lib/fallback";
import { Allocation, parseAllocationConfig } from "@/lib/ledger";
import { enabledModels, loadRegistry } from "@/lib/registry";

export const runtime = "nodejs";

const CONFIG_DIR = () => join(process.cwd(), "config");
const ROUTING_FILE = () => join(CONFIG_DIR(), "routing.json");
const ALLOCATION_FILE = () => join(CONFIG_DIR(), "allocation.json");

async function readAllocation(): Promise<z.infer<typeof Allocation> | null> {
  const path = ALLOCATION_FILE();
  if (!existsSync(path)) return null;
  const config = parseAllocationConfig(JSON.parse(await readFile(path, "utf8")));
  return config.allocations.find((a) => a.scope === "global") ?? null;
}

/** GET /api/routing — the current chain and budget, plus anything unreachable. */
export async function GET() {
  const session = await auth();
  if (!session) return unauthorized();

  try {
    const chain = chainFor(loadRoutingConfig());
    const models = enabledModels(loadRegistry());
    return Response.json({
      chain: chain?.entries ?? [],
      allocation: await readAllocation(),
      // Entries the router can never pick, so the UI can flag them (S-35).
      unreachable: chain ? unreachableEntries(chain, models) : [],
    });
  } catch (e) {
    return serverError(e);
  }
}

const SaveBody = z.object({
  entries: z.array(z.object({ modelId: z.string().min(1) })).min(1),
  /** null clears any configured limit. */
  allocation: Allocation.omit({ scope: true, projectName: true }).nullable().default(null),
});

/** POST /api/routing — save the user's fallback order and spending limit. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session) return unauthorized();

  let body: z.infer<typeof SaveBody>;
  try {
    body = SaveBody.parse(await req.json());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "invalid request body", 400);
  }

  try {
    await mkdir(CONFIG_DIR(), { recursive: true });

    const routing = { chains: [{ scope: "global" as const, entries: body.entries }] };
    await writeFile(ROUTING_FILE(), JSON.stringify(routing, null, 2) + "\n", "utf8");

    // Validate before writing — a malformed limit must not reach disk and
    // break the next startup.
    const allocations = body.allocation ? [{ scope: "global" as const, ...body.allocation }] : [];
    parseAllocationConfig({ allocations });
    await writeFile(ALLOCATION_FILE(), JSON.stringify({ allocations }, null, 2) + "\n", "utf8");

    return Response.json({
      saved: true,
      entries: body.entries,
      allocation: body.allocation,
      // The loaded config is cached for the process lifetime.
      note: "Saved. Restart IDEA for routing changes to take effect.",
    });
  } catch (e) {
    return serverError(e);
  }
}
