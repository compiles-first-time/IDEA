import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

import { auth } from "@/auth";
import { jsonError, serverError, unauthorized } from "@/lib/api";
import { loadProjects } from "@/lib/project-store";
import { getProject, projectRoot } from "@/lib/projects";

export const runtime = "nodejs";

/** Never worth listing, and expensive enough to matter. */
const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "__pycache__"]);
/** A tree larger than this is not browsable anyway; the model searches instead. */
const MAX_FILES = 4000;
/** A single attached file above this is context-window abuse, not context. */
const MAX_FILE_BYTES = 256 * 1024;

/**
 * The selected project's files, read from disk.
 *
 * The chat sidebar used to list the user's **GitHub repositories**, entirely
 * independently of the selected project. Two controls that both look like
 * "choose what we are working on", and only one of them affected the answer —
 * so opening a repo in the sidebar felt like picking a project and did nothing.
 * This is what makes the sidebar mean the same thing as the dropdown.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const session = await auth();
  if (!session) return unauthorized();

  const { name } = await params;
  const path = new URL(req.url).searchParams.get("path");

  let root: string;
  try {
    const project = getProject(await loadProjects(), name);
    if (!project) return jsonError(`no project named "${name}"`, 404, "project_not_found");
    root = projectRoot(process.cwd(), project);
  } catch (e) {
    return serverError(e);
  }

  if (!existsSync(root)) {
    return jsonError(
      `the project directory does not exist: ${root}. It may not be provisioned yet.`,
      404,
      "not_provisioned",
    );
  }

  // `?path=` reads one file; without it, list the tree.
  if (path) return readOne(root, path);

  try {
    const files: Array<{ path: string; size: number }> = [];
    let truncated = false;

    async function walk(dir: string): Promise<void> {
      if (truncated) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // Unreadable directory is skipped, not fatal.
      }
      for (const entry of entries) {
        if (truncated) return;
        if (SKIP.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          let size = 0;
          try {
            size = (await stat(full)).size;
          } catch {
            continue;
          }
          files.push({ path: relative(root, full).replace(/\\/g, "/"), size });
          if (files.length >= MAX_FILES) truncated = true;
        }
      }
    }

    await walk(root);
    files.sort((a, b) => a.path.localeCompare(b.path));
    // Truncation is reported so a partial tree does not read as a small repo.
    return Response.json({ files, truncated, root });
  } catch (e) {
    return serverError(e);
  }
}

async function readOne(root: string, rel: string): Promise<Response> {
  // Confinement is checked on the resolved path, not the string: `a/../../b`
  // looks innocent until it is resolved.
  const abs = join(root, rel);
  const inside = relative(root, abs);
  if (inside.startsWith("..") || inside.includes(`..${"/"}`) || inside.includes("..\\")) {
    return jsonError("refused: path is outside the project", 403, "forbidden_path");
  }

  try {
    const info = await stat(abs);
    if (!info.isFile()) return jsonError("not a file", 400);
    if (info.size > MAX_FILE_BYTES) {
      return jsonError(
        `that file is ${Math.round(info.size / 1024)}KB — too large to attach. Ask about it instead; the model can search and read it.`,
        413,
        "too_large",
      );
    }
    const content = await readFile(abs, "utf8");
    if (content.includes("\0")) return jsonError("that looks like a binary file", 400);
    return Response.json({ path: rel, content, bytes: info.size });
  } catch {
    return jsonError(`could not read ${rel}`, 404);
  }
}
