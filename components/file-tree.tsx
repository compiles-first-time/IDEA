"use client";

import { useMemo, useState } from "react";

/**
 * A collapsible repo file tree.
 *
 * The sidebar used to render every path as a flat list — up to 800 rows, all
 * expanded, so finding one file meant scrolling past the whole repository. Folders
 * start **closed**: a tree that opens fully is a flat list with indentation.
 *
 * Filtering is the exception. When you type a filter you have already said what
 * you are looking for, so matching folders open automatically — a filter that
 * hides its own results behind closed folders is useless.
 */

export interface TreeFile {
  path: string;
}

interface Dir {
  name: string;
  path: string;
  dirs: Map<string, Dir>;
  files: TreeFile[];
}

function emptyDir(name: string, path: string): Dir {
  return { name, path, dirs: new Map(), files: [] };
}

/** Build a nested tree from flat paths. Exported for tests. */
export function buildTree(files: readonly TreeFile[]): Dir {
  const root = emptyDir("", "");
  for (const file of files) {
    const parts = file.path.split("/");
    const name = parts.pop();
    if (!name) continue;

    let node = root;
    let sofar = "";
    for (const part of parts) {
      sofar = sofar ? `${sofar}/${part}` : part;
      let next = node.dirs.get(part);
      if (!next) {
        next = emptyDir(part, sofar);
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.push(file);
  }
  return root;
}

/** Every directory path in the tree — used to auto-open while filtering. */
function allDirPaths(dir: Dir, into: Set<string> = new Set()): Set<string> {
  for (const child of dir.dirs.values()) {
    into.add(child.path);
    allDirPaths(child, into);
  }
  return into;
}

export function FileTree({
  files,
  attached,
  onToggle,
  filtering,
}: {
  files: readonly TreeFile[];
  attached: Record<string, unknown>;
  onToggle: (path: string) => void;
  /** True when a filter is active — matching folders open on their own. */
  filtering: boolean;
}) {
  const root = useMemo(() => buildTree(files), [files]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // While filtering, treat everything as open unless explicitly closed.
  const forced = useMemo(
    () => (filtering ? allDirPaths(root) : new Set<string>()),
    [filtering, root],
  );

  function isOpen(path: string): boolean {
    if (path in open) return open[path];
    return forced.has(path);
  }

  function render(dir: Dir, depth: number): React.ReactNode {
    const dirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    const files = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));

    return (
      <>
        {dirs.map((child) => {
          const expanded = isOpen(child.path);
          const count = countFiles(child);
          return (
            <div key={child.path}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [child.path]: !expanded }))}
                aria-expanded={expanded}
                className="flex w-full items-center gap-1 px-3 py-1 text-left font-mono text-xs text-neutral-400 hover:bg-neutral-900"
                style={{ paddingLeft: `${12 + depth * 12}px` }}
                title={child.path}
              >
                <span className="w-3 shrink-0 text-neutral-600">{expanded ? "▾" : "▸"}</span>
                <span className="truncate">{child.name}</span>
                <span className="ml-auto shrink-0 pl-2 text-[10px] text-neutral-600">{count}</span>
              </button>
              {expanded && render(child, depth + 1)}
            </div>
          );
        })}

        {files.map((f) => {
          const name = f.path.slice(f.path.lastIndexOf("/") + 1);
          const on = Boolean(attached[f.path]);
          return (
            <button
              key={f.path}
              onClick={() => onToggle(f.path)}
              className={`block w-full truncate px-3 py-1 text-left font-mono text-xs hover:bg-neutral-900 ${
                on ? "text-emerald-400" : "text-neutral-300"
              }`}
              style={{ paddingLeft: `${24 + depth * 12}px` }}
              title={f.path}
            >
              {on ? "✓ " : ""}
              {name}
            </button>
          );
        })}
      </>
    );
  }

  if (files.length === 0) return null;
  return <div>{render(root, 0)}</div>;
}

function countFiles(dir: Dir): number {
  let n = dir.files.length;
  for (const child of dir.dirs.values()) n += countFiles(child);
  return n;
}
