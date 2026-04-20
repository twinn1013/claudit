/**
 * Vendored YAML subset parser — zero runtime dependency.
 *
 * Supports exactly three constructs observed in Claude Code frontmatter:
 *   1. Scalar `key: value`  (string / number / bool coerced loosely)
 *   2. Inline list `key: [a, b, c]`
 *   3. Block list under `key:` with indented `- item` lines
 *
 * Any unsupported construct (folded `>`, literal `|`, flow mapping `{a:1}`,
 * anchors `&foo`, aliases `*foo`, merge keys `<<:`) surfaces as a
 * human-readable warning in `parseWarnings` AND on stderr via `console.warn`.
 * The parser never throws — upstream callers (skill/agent capture) must be
 * able to surface warnings without losing the rest of the frontmatter.
 *
 * Design note: this is deliberately NOT a general YAML parser. It is tuned
 * for the shapes that appear in SKILL.md / agent.md frontmatter. If a new
 * shape appears in the wild, extend the explicit branches and add a test.
 */

export interface ParsedFrontmatter {
  fields: Record<string, unknown>;
  parseWarnings: string[];
}

/**
 * Return the text between the first `---` line and the next `---`, or
 * `null` if the file does not start with a frontmatter block.
 */
export function extractFrontmatter(fileContents: string): string | null {
  if (typeof fileContents !== "string" || fileContents.length === 0) return null;
  // Must start with `---` (optionally with a leading BOM, which we tolerate).
  const src = fileContents.startsWith("\uFEFF")
    ? fileContents.slice(1)
    : fileContents;
  if (!src.startsWith("---")) return null;
  const afterFirst = src.indexOf("\n", 3);
  if (afterFirst === -1) return null;
  const end = src.indexOf("\n---", afterFirst);
  if (end === -1) return null;
  return src.slice(afterFirst + 1, end);
}

/**
 * Parse the YAML subset described in the module docstring. Never throws.
 */
export function parseYamlSubset(src: string): ParsedFrontmatter {
  const fields: Record<string, unknown> = {};
  const parseWarnings: string[] = [];

  const warn = (msg: string): void => {
    parseWarnings.push(msg);
    try {
      console.warn(`[claudit yaml] ${msg}`);
    } catch {
      // stderr write failure is non-fatal; the warning is still in the array.
    }
  };

  if (typeof src !== "string" || src.length === 0) {
    return { fields, parseWarnings };
  }

  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");
    // Skip pure blank lines and comments.
    if (line.trim().length === 0 || /^\s*#/.test(line)) {
      i++;
      continue;
    }

    // Top-level lines have zero indent. Anything else at this loop level
    // is an orphan indent and gets a warning; we still advance to avoid
    // infinite loops.
    if (/^\s/.test(line)) {
      warn(`orphan indented line ignored: ${truncate(line)}`);
      i++;
      continue;
    }

    // YAML merge key `<<:` — explicitly unsupported; the key-name regex
    // below won't match it so we detect it here and advance.
    if (/^<<\s*:/.test(line)) {
      warn(`unsupported YAML merge key \`<<:\` ignored`);
      i++;
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      warn(`unrecognized top-level line: ${truncate(line)}`);
      i++;
      continue;
    }
    const key = kv[1];
    const rest = kv[2];

    if (rest.length === 0) {
      // Either an empty scalar or the start of a block list / block map.
      // Peek ahead for indented `- item` lines.
      const blockItems: string[] = [];
      let j = i + 1;
      let isBlockList = false;
      while (j < lines.length) {
        const peek = lines[j];
        if (peek.trim().length === 0) {
          j++;
          continue;
        }
        const indentMatch = /^(\s+)(.*)$/.exec(peek);
        if (!indentMatch) break; // dedent -> next top-level key
        const body = indentMatch[2];
        const dash = /^-\s*(.*)$/.exec(body);
        if (!dash) {
          // Indented non-list content under an empty scalar: treat as
          // unsupported block-map and warn.
          warn(
            `unsupported block-map under \`${key}\`: ${truncate(body)}`,
          );
          j++;
          continue;
        }
        isBlockList = true;
        blockItems.push(stripInlineQuotes(dash[1]));
        j++;
      }
      if (isBlockList) {
        fields[key] = blockItems;
      } else {
        fields[key] = "";
      }
      i = j;
      continue;
    }

    // A value is present on the same line as the key.
    // Reject explicitly unsupported constructs BEFORE attempting to coerce.
    if (rest === ">" || rest === "|" || /^[>|][-+]?\s*$/.test(rest)) {
      warn(
        `unsupported multiline scalar indicator \`${rest}\` on key \`${key}\``,
      );
      // Still consume any indented continuation lines so the outer loop
      // doesn't treat them as top-level junk.
      let j = i + 1;
      while (j < lines.length && /^\s/.test(lines[j]) && lines[j].trim().length > 0) {
        j++;
      }
      fields[key] = "";
      i = j;
      continue;
    }

    if (/^\{.*\}\s*$/.test(rest)) {
      warn(
        `unsupported flow mapping on key \`${key}\`: ${truncate(rest)}`,
      );
      fields[key] = rest;
      i++;
      continue;
    }

    if (/^[&*]/.test(rest)) {
      warn(`unsupported YAML anchor/alias on key \`${key}\`: ${truncate(rest)}`);
      fields[key] = rest;
      i++;
      continue;
    }

    // Inline list `[a, b, c]`
    const inlineList = /^\[\s*(.*?)\s*\]\s*$/.exec(rest);
    if (inlineList) {
      const inner = inlineList[1];
      fields[key] = splitInlineList(inner);
      i++;
      continue;
    }

    // Plain scalar.
    fields[key] = coerceScalar(stripInlineQuotes(rest));
    i++;
  }

  return { fields, parseWarnings };
}

// ---------------------------------------------------------------------

function splitInlineList(inner: string): string[] {
  if (inner.trim().length === 0) return [];
  // Split on commas outside of quotes. Simple state machine.
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ",") {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0 || out.length > 0) {
    out.push(current.trim());
  }
  return out.map(stripInlineQuotes).filter((s) => s.length > 0);
}

function stripInlineQuotes(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length < 2) return trimmed;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function coerceScalar(s: string): unknown {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^-?\d*\.\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

function truncate(s: string, max = 80): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}
