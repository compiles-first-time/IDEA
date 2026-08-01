import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { loadProjects } from "@/lib/project-store";
import { getProject, projectRoot } from "@/lib/projects";
import { mergeRegisters, parseRegisterFile } from "@/lib/register";

export const runtime = "nodejs";

/**
 * Where Loom projects keep their registers (ADR-0046 §3), plus the location
 * IDEA uses for its own. Both are checked so a project written either way works.
 */
const REGISTER_DIRS = [
  join("observability", "eval-suite", "requirements"),
  join("docs", "requirements"),
];

/** GET /api/projects/[name]/register — the project's requirements board. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { name } = await params;

  let root: string;
  try {
    const project = getProject(await loadProjects(), name);
    if (!project) return jsonError(`no project named "${name}"`, 404, "project_not_found");
    root = projectRoot(process.cwd(), project);
  } catch (e) {
    return serverError(e);
  }

  try {
    const parsed = [];
    const searched: string[] = [];

    for (const rel of REGISTER_DIRS) {
      const dir = join(root, rel);
      searched.push(rel);
      if (!existsSync(dir)) continue;

      for (const entry of await readdir(dir)) {
        if (!entry.toLowerCase().endsWith(".md")) continue;
        // README and index files are not registers; parsing them would produce
        // an error row for every project that documents its own conventions.
        if (/^(readme|index)\.md$/i.test(entry)) continue;
        parsed.push(parseRegisterFile(`${rel}/${entry}`, await readFile(join(dir, entry), "utf8")));
      }
    }

    const board = mergeRegisters(parsed);
    // `searched` matters when the board is empty: "no requirements" is only
    // actionable if you know where we looked.
    return Response.json({ ...board, searched });
  } catch (e) {
    return serverError(e);
  }
}
