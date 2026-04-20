/**
 * Set algebra for hook matcher overlap.
 *
 * Matcher grammar subset (per ground-truth docs, Limitation 5):
 *   - "*" or "" or whitespace-only  → wildcard (matches everything)
 *   - "ToolName"                     → singleton set
 *   - "A|B|C"                        → union of pipe-separated literals
 *
 * Unknown / unparseable matchers widen to wildcard (conservative).
 */

export type MatcherSet =
  | { wildcard: true }
  | { wildcard: false; tools: Set<string> };

/**
 * Parse a raw matcher string into a MatcherSet.
 *
 * - undefined / empty / whitespace-only → wildcard
 * - "*" → wildcard
 * - "A|B|C" → {A, B, C} (empty alternation pieces skipped)
 */
export function parseMatcher(raw: string | undefined): MatcherSet {
  if (raw === undefined) return { wildcard: true };
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*") return { wildcard: true };

  const pieces = trimmed.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
  if (pieces.length === 0) return { wildcard: true };

  return { wildcard: false, tools: new Set(pieces) };
}

/**
 * Return true iff the two MatcherSets have at least one tool in common.
 *
 * Rules:
 * - wildcard overlaps with everything (including another wildcard).
 * - two non-wildcard sets overlap iff their tool-name sets intersect.
 */
export function matchersOverlap(a: MatcherSet, b: MatcherSet): boolean {
  if (a.wildcard || b.wildcard) return true;
  for (const tool of a.tools) {
    if (b.tools.has(tool)) return true;
  }
  return false;
}
