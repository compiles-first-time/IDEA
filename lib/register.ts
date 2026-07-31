/**
 * The Requirements & Exceptions register (ADR-0022 columns, ADR-0046 taxonomy).
 *
 * Parses the markdown tables Loom projects already author into a structure a
 * board can render. **This format is not invented here** — it comes from the
 * architect's Credit Validation spreadsheet, was adopted as ADR-0022 in May, and
 * extended into a live test-case registry by ADR-0046 in July. IDEA reads it.
 *
 * A requirement is the ticket; its solution steps and its SE/BE/TR rows are the
 * subtasks. That hierarchy is already in the ids, so nothing extra is stored.
 */

/** ADR-0046 §1. */
export type RowType = "BR" | "TR" | "SE" | "BE" | "solution";

/** ADR-0046 §2 execution field. `pending` is never `pass`. */
export type RowStatus = "pass" | "fail" | "pending" | "blocked";

export interface RegisterRow {
  id: string;
  type: RowType;
  /** The `BR` this row belongs to. A `BR` is its own parent. */
  parentId: string;
  location: string | null;
  usecase: string;
  expectedInput: string | null;
  expectedOutput: string | null;
  actualInput: string | null;
  actualOutput: string | null;
  justification: string | null;
  status: RowStatus;
}

export interface Requirement {
  id: string;
  title: string;
  /** The `BR` row itself, when the table declares one. */
  row: RegisterRow | null;
  solutions: RegisterRow[];
  technical: RegisterRow[];
  exceptions: RegisterRow[];
  /** Rolled up from every row: the worst status wins. */
  status: RowStatus;
  counts: Record<RowStatus, number>;
}

export interface RegisterParseError {
  file: string;
  line: number;
  message: string;
}

export interface ParsedRegister {
  requirements: Requirement[];
  /** Malformed input is reported, never silently skipped. */
  errors: RegisterParseError[];
}

/* -------------------------------------------------------------------------- */

/** Ids are written `BR_06` and `BR-06_SE-01` interchangeably; normalise. */
export function parentOf(id: string): string {
  const m = /^(BR)[-_ ]?(\d+)/i.exec(id.trim());
  return m ? `BR_${m[2].padStart(2, "0")}` : id.trim();
}

function normalizeType(raw: string): RowType | null {
  const t = raw.trim().toUpperCase();
  if (t === "BR") return "BR";
  if (t === "TR") return "TR";
  if (t === "SE") return "SE";
  if (t === "BE") return "BE";
  // The spreadsheet writes a solution step as `---`; markdown tables sometimes
  // arrive with the dashes collapsed or emphasised.
  if (/^-{1,4}$/.test(t) || t === "SOLUTION" || t === "") return "solution";
  return null;
}

/**
 * Read a status cell.
 *
 * Real registers write "✅ pass", "pending", "❌ fail". Anything unrecognised is
 * **pending**, not pass: a row whose state cannot be read has not been shown to
 * work, and defaulting to pass would turn an unparseable board green.
 */
export function normalizeStatus(raw: string | null | undefined): RowStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("blocked")) return "blocked";
  if (s.includes("fail")) return "fail";
  if (s.includes("pass")) return "pass";
  return "pending";
}

/** Worst-first, so a board never looks healthier than its worst row. */
const SEVERITY: RowStatus[] = ["fail", "blocked", "pending", "pass"];

export function rollUp(statuses: readonly RowStatus[]): RowStatus {
  for (const s of SEVERITY) if (statuses.includes(s)) return s;
  return "pending";
}

function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const SEPARATOR = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/** `# BR_06 — Passive agent-reputation projection` → the title after the dash. */
function titleFrom(markdown: string, fallbackId: string): string {
  const m = /^#\s+(.+)$/m.exec(markdown);
  if (!m) return fallbackId;
  const heading = m[1].trim();
  const dash = heading.search(/[—–-]/);
  return dash > 0 ? heading.slice(dash + 1).trim() : heading;
}

/**
 * Parse one register file.
 *
 * Tolerant of column order: the header row is read for names rather than
 * assuming positions, because these files are hand-edited and a shifted column
 * would otherwise silently populate the wrong field.
 */
export function parseRegisterFile(file: string, markdown: string): ParsedRegister {
  const errors: RegisterParseError[] = [];
  const rows: RegisterRow[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("|") || i + 1 >= lines.length || !SEPARATOR.test(lines[i + 1])) continue;

    const header = cells(lines[i]).map((h) => h.toLowerCase());
    const at = (...names: string[]) => {
      for (const n of names) {
        const idx = header.findIndex((h) => h.includes(n));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const col = {
      id: at("id"),
      type: at("type"),
      location: at("framework location", "location"),
      usecase: at("usecase", "use case", "condition"),
      expectedInput: at("expected input"),
      expectedOutput: at("expected output"),
      actualInput: at("actual input"),
      actualOutput: at("actual output"),
      justification: at("justification", "why"),
      status: at("status"),
    };

    // Without an id there is no row to speak of, and no way to link a subtask.
    if (col.id < 0 || col.type < 0) {
      i++;
      continue;
    }

    for (let j = i + 2; j < lines.length && lines[j].includes("|") && lines[j].trim(); j++) {
      const c = cells(lines[j]);
      const id = (c[col.id] ?? "").replace(/`/g, "").trim();
      if (!id) continue;

      const type = normalizeType(c[col.type] ?? "");
      if (!type) {
        errors.push({
          file,
          line: j + 1,
          message: `unknown Type "${c[col.type]}" for ${id} — expected BR, TR, SE, BE or ---`,
        });
        continue;
      }

      const pick = (idx: number) => (idx >= 0 ? (c[idx] ?? "").trim() || null : null);
      const strip = (v: string | null) => (v && v !== "—" && v !== "-" ? v : null);

      rows.push({
        id,
        type,
        parentId: parentOf(id),
        location: strip(pick(col.location)),
        usecase: pick(col.usecase) ?? "",
        expectedInput: strip(pick(col.expectedInput)),
        expectedOutput: strip(pick(col.expectedOutput)),
        actualInput: strip(pick(col.actualInput)),
        actualOutput: strip(pick(col.actualOutput)),
        justification: strip(pick(col.justification)),
        status: normalizeStatus(pick(col.status)),
      });
      i = j;
    }
  }

  if (rows.length === 0) {
    errors.push({ file, line: 1, message: "no ADR-0022 register table found in this file" });
  }

  return { requirements: assemble(rows, markdown, file), errors };
}

function assemble(rows: RegisterRow[], markdown: string, file: string): Requirement[] {
  const byParent = new Map<string, RegisterRow[]>();
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? [];
    list.push(r);
    byParent.set(r.parentId, list);
  }

  const fallbackId = file.replace(/.*[\\/]/, "").replace(/\.md$/i, "");

  return [...byParent.entries()].map(([id, group]) => {
    const counts: Record<RowStatus, number> = { pass: 0, fail: 0, pending: 0, blocked: 0 };
    for (const r of group) counts[r.status] += 1;

    return {
      id,
      title: titleFrom(markdown, fallbackId),
      row: group.find((r) => r.type === "BR") ?? null,
      solutions: group.filter((r) => r.type === "solution"),
      technical: group.filter((r) => r.type === "TR"),
      exceptions: group.filter((r) => r.type === "SE" || r.type === "BE"),
      status: rollUp(group.map((r) => r.status)),
      counts,
    };
  });
}

/** Merge several files into one board, newest requirement id last. */
export function mergeRegisters(parsed: readonly ParsedRegister[]): ParsedRegister {
  return {
    requirements: parsed.flatMap((p) => p.requirements).sort((a, b) => a.id.localeCompare(b.id)),
    errors: parsed.flatMap((p) => p.errors),
  };
}
