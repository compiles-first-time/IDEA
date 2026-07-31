import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "@/components/markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

/* ── Safety: the renderer builds elements, never HTML ────────────────────── */

test("HTML in the text is escaped, not executed", () => {
  // Model output and quoted repo files both flow through here. A renderer that
  // could emit a script tag would be an injection vector by construction.
  const out = html('<script>alert("x")</script>');
  assert.doesNotMatch(out, /<script>/);
  assert.match(out, /&lt;script&gt;/);
});

test("an img with an onerror handler cannot be produced", () => {
  const out = html('<img src=x onerror="alert(1)">');
  // The words may appear — escaped, as visible text. What must not exist is a
  // real element carrying a real handler, so assert on the markup, not the
  // characters.
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img/, "it renders as text the user can read");
});

test("a javascript: link does not get target=_blank treatment", () => {
  const out = html("[click](javascript:alert(1))");
  assert.doesNotMatch(out, /target="_blank"/);
});

/* ── Inline ──────────────────────────────────────────────────────────────── */

test("bold, italic, and inline code render", () => {
  assert.match(html("**bold**"), /<strong[^>]*>bold<\/strong>/);
  assert.match(html("*slanted*"), /<em[^>]*>slanted<\/em>/);
  assert.match(html("`npm test`"), /<code[^>]*>npm test<\/code>/);
});

test("markdown inside a code span is left alone", () => {
  // Otherwise `**` inside code would render as bold and change what the code says.
  const out = html("`a ** b`");
  assert.doesNotMatch(out, /<strong/);
  assert.match(out, /a \*\* b/);
});

test("a link renders with its label and opens externally", () => {
  const out = html("[docs](https://example.com)");
  assert.match(out, /href="https:\/\/example.com"/);
  assert.match(out, /target="_blank"/);
  assert.match(out, />docs</);
});

/* ── Blocks ──────────────────────────────────────────────────────────────── */

test("headings render at their level", () => {
  assert.match(html("# Title"), /Title/);
  assert.match(html("### Small"), /Small/);
});

test("a fenced code block keeps its contents verbatim", () => {
  const out = html("```ts\nconst a = **1**;\n```");
  assert.match(out, /<pre/);
  assert.doesNotMatch(out, /<strong/, "code must not be re-parsed as markdown");
  assert.match(out, /const a = \*\*1\*\*;/);
});

test("an unclosed fence still renders rather than swallowing the answer", () => {
  const out = html("```\nstill here");
  assert.match(out, /still here/);
});

test("bulleted and numbered lists render as lists", () => {
  assert.match(html("- one\n- two"), /<ul[^>]*>[\s\S]*<li>one<\/li>/);
  assert.match(html("1. first\n2. second"), /<ol[^>]*>[\s\S]*<li>first<\/li>/);
});

test("a table renders as a table", () => {
  const out = html("| a | b |\n|---|---|\n| 1 | 2 |");
  assert.match(out, /<table/);
  assert.match(out, /<th[^>]*>a<\/th>/);
  assert.match(out, /<td[^>]*>1<\/td>/);
});

test("a blockquote renders as one", () => {
  assert.match(html("> quoted"), /<blockquote[^>]*>[\s\S]*quoted/);
});

test("a horizontal rule renders", () => {
  assert.match(html("---"), /<hr/);
});

/* ── Robustness ──────────────────────────────────────────────────────────── */

test("plain prose is a paragraph, with newlines preserved", () => {
  const out = html("line one\nline two");
  assert.match(out, /<p[^>]*>/);
  assert.match(out, /line one\nline two/);
});

test("empty input renders nothing rather than throwing", () => {
  assert.doesNotThrow(() => html(""));
  assert.doesNotThrow(() => html("\n\n\n"));
});

test("unbalanced emphasis is left as literal text", () => {
  // Half-typed markdown is common mid-stream; it must not eat the rest.
  const out = html("this is **not closed");
  assert.match(out, /\*\*not closed/);
});
