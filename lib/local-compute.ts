/**
 * The tier below the cheapest model: answers that need no inference at all.
 *
 * The architect's example was "1 + 1 does not need Fable or any model and can
 * rely purely on basic programming". That is true, and it is also the most
 * dangerous tier in the system — because the failure mode is not "we spent a
 * cent unnecessarily", it is **a confident wrong answer with no model in the
 * loop to catch it**.
 *
 * So the boundary is drawn as narrowly as it can usefully be drawn:
 *
 *   **The entire message must be one complete arithmetic expression over
 *   literal numbers, and nothing else.**
 *
 * `1 + 1` qualifies. `(3 + 4) / 2` qualifies. Everything below does not, and
 * each exclusion is a case where a plausible-looking shortcut would be wrong:
 *
 * - `what is 15% of my invoice total` — needs a value we do not have.
 * - `convert 5 tons to kg` — short, long, or metric ton? Three right answers.
 * - `how many days until Friday` — depends on today, and on the reader's zone.
 * - `1 + 1 and then explain why` — the arithmetic is the easy half.
 * - `is 7 > 3` — a comparison is a claim, and the phrasing may be rhetorical.
 *
 * Anything not certain is handed to a model. Failing closed here costs a
 * fraction of a cent; failing open costs trust.
 */

export interface ComputeResult {
  /** The normalised expression that was evaluated. */
  expression: string;
  value: number;
  /** Formatted for display, without floating-point noise. */
  answer: string;
}

/** Guards against a pathological input burning CPU in a "free" tier. */
const MAX_LENGTH = 120;
const MAX_TOKENS = 60;
/** `9 ** 9 ** 9` is a denial of service written in three characters. */
const MAX_EXPONENT = 64;

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "%" | "^" }
  | { kind: "lparen" }
  | { kind: "rparen" };

/**
 * Strip only the framing this recogniser is confident about.
 *
 * "what is 2+2" and "2+2?" are the same question. Anything richer than that is
 * left alone so it fails the whole-message test and goes to a model.
 */
function normalize(input: string): string {
  return input
    .trim()
    .replace(/^(?:what(?:'s| is)|calculate|compute|eval(?:uate)?)\s+/i, "")
    .replace(/[?.\s]+$/, "")
    .replace(/[×✕]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/,(?=\d{3}\b)/g, "") // thousands separators only
    .trim();
}

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === " ") {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if ("+-*/%^".includes(c)) {
      // `**` is exponentiation in most languages people type.
      if (c === "*" && src[i + 1] === "*") {
        tokens.push({ kind: "op", value: "^" });
        i += 2;
        continue;
      }
      tokens.push({ kind: "op", value: c as "+" });
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+/.exec(src.slice(i));
      if (!m) return null;
      const value = Number(m[0]);
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: "number", value });
      i += m[0].length;
      continue;
    }
    // A letter, a comparison, a currency symbol — anything else means this is
    // not a bare arithmetic expression.
    return null;
  }

  return tokens.length > 0 && tokens.length <= MAX_TOKENS ? tokens : null;
}

/**
 * Recursive-descent evaluation.
 *
 * Written out rather than handed to `eval` or `Function`: this runs on text a
 * user typed, and building a code path that executes arbitrary strings to save
 * forty lines would be indefensible whatever the sandboxing story.
 */
function evaluate(tokens: Token[]): number | null {
  let pos = 0;
  let failed = false;

  const peek = () => tokens[pos];
  const fail = () => {
    failed = true;
    return 0;
  };

  function primary(): number {
    if (failed) return 0;
    const t = peek();
    if (!t) return fail();

    if (t.kind === "op" && (t.value === "-" || t.value === "+")) {
      pos++;
      const v = primary();
      return t.value === "-" ? -v : v;
    }
    if (t.kind === "number") {
      pos++;
      return t.value;
    }
    if (t.kind === "lparen") {
      pos++;
      const v = additive();
      const close = peek();
      if (!close || close.kind !== "rparen") return fail();
      pos++;
      return v;
    }
    return fail();
  }

  function power(): number {
    const base = primary();
    if (failed) return 0;
    const t = peek();
    if (t && t.kind === "op" && t.value === "^") {
      pos++;
      const exp = power(); // right-associative
      if (failed) return 0;
      if (Math.abs(exp) > MAX_EXPONENT) return fail();
      return base ** exp;
    }
    return base;
  }

  function multiplicative(): number {
    let left = power();
    while (!failed) {
      const t = peek();
      if (!t || t.kind !== "op" || !"*/%".includes(t.value)) break;
      pos++;
      const right = power();
      if (failed) return 0;
      if ((t.value === "/" || t.value === "%") && right === 0) return fail(); // undefined, not Infinity
      left = t.value === "*" ? left * right : t.value === "/" ? left / right : left % right;
    }
    return left;
  }

  function additive(): number {
    let left = multiplicative();
    while (!failed) {
      const t = peek();
      if (!t || t.kind !== "op" || (t.value !== "+" && t.value !== "-")) break;
      pos++;
      const right = multiplicative();
      if (failed) return 0;
      left = t.value === "+" ? left + right : left - right;
    }
    return left;
  }

  const result = additive();
  // Trailing tokens mean the whole message was not one expression.
  if (failed || pos !== tokens.length || !Number.isFinite(result)) return null;
  return result;
}

/** Trim floating-point noise without misrepresenting the value. */
function format(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const rounded = Number(n.toFixed(10));
  return String(rounded);
}

/**
 * Can this be answered with certainty, without a model?
 *
 * Returns null for everything it is not sure about — which is nearly everything.
 * That is the design, not a limitation.
 */
export function tryCompute(prompt: string): ComputeResult | null {
  if (typeof prompt !== "string") return null;
  if (prompt.length > MAX_LENGTH) return null;

  const expression = normalize(prompt);
  if (!expression) return null;

  // At least one operator: a bare "42" is not a question, and echoing it back
  // as an answer would be a strange thing to do.
  if (!/[+\-*/%^]/.test(expression)) return null;

  const tokens = tokenize(expression);
  if (!tokens) return null;

  const value = evaluate(tokens);
  if (value === null) return null;

  return { expression, value, answer: format(value) };
}
