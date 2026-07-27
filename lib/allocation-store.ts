import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseAllocationConfig, type Allocation } from "@/lib/ledger";

/** Read the saved global spending limit, or null when none is set. */
export async function readGlobalAllocation(
  ideaRoot = process.cwd(),
): Promise<Allocation | null> {
  const path = join(ideaRoot, "config", "allocation.json");
  if (!existsSync(path)) return null;
  try {
    const config = parseAllocationConfig(JSON.parse(await readFile(path, "utf8")));
    return config.allocations.find((a) => a.scope === "global") ?? null;
  } catch {
    // A malformed file must not take the settings page down — it shows "no
    // limit", and saving from the UI rewrites it correctly.
    return null;
  }
}
