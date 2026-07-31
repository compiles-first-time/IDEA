import type { ReactNode } from "react";

/**
 * A small markdown renderer for chat answers.
 *
 * Builds **React elements**, never HTML strings — `dangerouslySetInnerHTML`
 * would let anything a model emits (or anything a repo file contains, since
 * files are quoted back) inject markup into the page. A parser that can only
 * produce elements cannot produce a script tag, whatever the input says.
 *
 * Deliberately small: headings, emphasis, code, links, lists, quotes, rules,
 * and tables. Chat answers do not need the rest, and every construct here is
 * one more thing that can render wrongly.
 */

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

/** `code` · **bold** · *italic* · [text](url), applied in that precedence. */
function inline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  // Code first: its contents must never be re-parsed, or `**` inside a code
  // span would render as bold and change what the code says.
  const pattern =
    /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}i${i++}`;

    if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      out.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      const external = /^https?:\/\//.test(href);
      out.push(
        <a
          key={key}
          href={href}
          // Only http(s) opens in a new tab; anything else stays inert-ish so a
          // `javascript:` URL cannot be dressed up as a normal link.
          {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
          className="text-sky-400 underline decoration-sky-400/40 hover:decoration-sky-400"
        >
          {label}
        </a>,
      );
    }
    last = m.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

const HEADING_SIZES = ["text-lg", "text-base", "text-sm", "text-sm", "text-sm", "text-sm"];

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code. Consumed whole and never inline-parsed — a code block that
    // renders its own contents as markdown is worse than no formatting at all.
    const fence = /^\s*```(\w+)?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end of input — an unclosed fence still renders)
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-2"
        >
          {lang && <div className="mb-1 text-[10px] uppercase text-neutral-600">{lang}</div>}
          <code className="font-mono text-xs text-neutral-200">{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <div
          key={key++}
          className={`mt-3 mb-1 font-semibold ${HEADING_SIZES[level - 1]} text-neutral-100`}
        >
          {inline(heading[2], `h${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-neutral-800" />);
      i++;
      continue;
    }

    // Table: a header row followed by a separator of dashes.
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const cells = (row: string) =>
        row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {head.map((h, hi) => (
                  <th key={hi} className="border border-neutral-800 px-2 py-1 text-left font-medium">
                    {inline(h, `th${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-neutral-800 px-2 py-1 align-top">
                      {inline(c, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={key++} className="my-2 border-l-2 border-neutral-700 pl-3 text-neutral-400">
          {inline(body.join(" "), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
      const cls = "my-1 ml-5 space-y-0.5 " + (ordered ? "list-decimal" : "list-disc");
      blocks.push(
        ordered ? (
          <ol key={key++} className={cls}>
            {items.map((it, ii) => (
              <li key={ii}>{inline(it, `li${key}-${ii}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key++} className={cls}>
            {items.map((it, ii) => (
              <li key={ii}>{inline(it, `li${key}-${ii}`)}</li>
            ))}
          </ul>
        ),
      );
      continue;
    }

    // Paragraph: consecutive non-blank lines that start no other block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(
      <p key={key++} className="my-1 whitespace-pre-wrap">
        {inline(para.join("\n"), `p${key}`)}
      </p>,
    );
  }

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}
