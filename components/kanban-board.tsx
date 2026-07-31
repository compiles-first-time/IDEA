"use client";

import { useEffect, useState } from "react";

import type { ParsedRegister, Requirement, RegisterRow, RowStatus } from "@/lib/register";

/**
 * The requirements board (ADR-0046).
 *
 * A **BR is the ticket**; its solution steps, technical requirements, and SE/BE
 * exceptions are its subtasks. That is the architect's model, and it is already
 * how the registers are written — so the board reads them rather than asking
 * anyone to maintain a second list.
 *
 * ## Why there is no "In progress" column
 *
 * The register records four states: `pass`, `fail`, `pending`, `blocked`. None
 * of them means "someone is working on this". Adding the column would mean
 * inventing state the data cannot support, and a card that sits in "In progress"
 * because a human dragged it there once is exactly the drift that makes boards
 * lie. The columns are what is *recorded*, not what is felt.
 */

const COLUMNS: Array<{ status: RowStatus; label: string; hint: string; accent: string }> = [
  {
    status: "fail",
    label: "Failing",
    hint: "a linked test ran and did not pass",
    accent: "border-red-900 bg-red-950/20",
  },
  {
    status: "blocked",
    label: "Blocked",
    hint: "waiting on something no agent can clear",
    accent: "border-amber-900 bg-amber-950/20",
  },
  {
    status: "pending",
    label: "Not verified",
    hint: "no actual recorded — never counts as done",
    accent: "border-neutral-800",
  },
  {
    status: "pass",
    label: "Verified",
    hint: "expected and actual agree",
    accent: "border-emerald-900 bg-emerald-950/20",
  },
];

const TYPE_STYLE: Record<RegisterRow["type"], { label: string; cls: string }> = {
  BR: { label: "BR", cls: "bg-sky-950 text-sky-300" },
  solution: { label: "solution", cls: "bg-neutral-800 text-neutral-300" },
  TR: { label: "TR", cls: "bg-violet-950 text-violet-300" },
  SE: { label: "SE", cls: "bg-orange-950 text-orange-300" },
  BE: { label: "BE", cls: "bg-yellow-950 text-yellow-300" },
};

const STATUS_DOT: Record<RowStatus, string> = {
  pass: "bg-emerald-500",
  fail: "bg-red-500",
  pending: "bg-neutral-600",
  blocked: "bg-amber-500",
};

function Sub({ row }: { row: RegisterRow }) {
  return (
    <li className="flex items-start gap-1.5 py-0.5">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[row.status]}`} />
      <span className={`shrink-0 rounded px-1 text-[9px] ${TYPE_STYLE[row.type].cls}`}>
        {TYPE_STYLE[row.type].label}
      </span>
      <span className="min-w-0 flex-1 text-[11px] text-neutral-400">
        {row.usecase || row.id}
        {/* The Justification column is the one people skip and the one a future
            maintainer needs. Show it. */}
        {row.justification && (
          <span className="mt-0.5 block text-[10px] text-neutral-600">{row.justification}</span>
        )}
      </span>
    </li>
  );
}

function Card({ req }: { req: Requirement }) {
  const [open, setOpen] = useState(false);
  const subtasks = [...req.solutions, ...req.technical, ...req.exceptions];
  const done = req.counts.pass;
  const total = subtasks.length + (req.row ? 1 : 0);

  return (
    <li className="rounded border border-neutral-800 bg-neutral-950 p-2">
      <button onClick={() => setOpen(!open)} className="w-full text-left">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-sky-300">{req.id}</span>
          <span className="ml-auto shrink-0 text-[10px] text-neutral-600">
            {done}/{total}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-neutral-200">{req.row?.usecase || req.title}</div>

        <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
          {req.technical.length > 0 && (
            // TR rows are accounts, credentials, and human steps — the things no
            // agent can clear. They belong on the front of the card.
            <span className="rounded bg-violet-950 px-1 text-violet-300">
              {req.technical.length} needs
            </span>
          )}
          {req.exceptions.length > 0 && (
            <span className="rounded bg-neutral-800 px-1 text-neutral-400">
              {req.exceptions.length} exceptions
            </span>
          )}
          {req.counts.fail > 0 && (
            <span className="rounded bg-red-950 px-1 text-red-300">{req.counts.fail} failing</span>
          )}
          {subtasks.length > 0 && (
            <span className="text-neutral-600">{open ? "▾ hide" : "▸ subtasks"}</span>
          )}
        </div>
      </button>

      {open && subtasks.length > 0 && (
        <ul className="mt-1.5 border-t border-neutral-900 pt-1.5">
          {subtasks.map((r) => (
            <Sub key={r.id} row={r} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function KanbanBoard({ project }: { project: string }) {
  const [board, setBoard] = useState<(ParsedRegister & { searched?: string[] }) | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(project)}/register`).then((x) =>
          x.json(),
        );
        if (r.error) setError(r.error);
        else setBoard(r);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [project]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!board) return <p className="text-sm text-neutral-500">Reading the register…</p>;

  if (board.requirements.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-neutral-400">
          No requirements register found for <span className="text-neutral-200">{project}</span>.
        </p>
        <p className="text-xs text-neutral-500">
          Author one with <code className="text-neutral-400">/testcase</code> in the project. Looked
          in: {(board.searched ?? []).join(", ")}
        </p>
        {board.errors.length > 0 && <Errors errors={board.errors} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Parse failures are shown above the board, never swallowed: a register
          that half-loads would show a healthier board than the truth. */}
      {board.errors.length > 0 && <Errors errors={board.errors} />}

      <div className="grid gap-3 md:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = board.requirements.filter((r) => r.status === col.status);
          return (
            <section key={col.status} className={`rounded-lg border p-2 ${col.accent}`}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-medium">{col.label}</h2>
                <span className="text-[10px] text-neutral-600">{items.length}</span>
              </div>
              <p className="mb-2 text-[10px] text-neutral-600">{col.hint}</p>
              <ul className="space-y-2">
                {items.map((r) => (
                  <Card key={r.id} req={r} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Errors({ errors }: { errors: ParsedRegister["errors"] }) {
  return (
    <div className="rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-200">
      <p className="font-medium">{errors.length} row(s) could not be read:</p>
      <ul className="mt-1 space-y-0.5">
        {errors.slice(0, 8).map((e, i) => (
          <li key={i} className="font-mono text-[10px]">
            {e.file}:{e.line} — {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
