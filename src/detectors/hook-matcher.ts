import type { Detector } from "../detector.js";
import type {
  Collision,
  HookScript,
  HookSource,
  SettingsHookEntry,
  SnapshotData,
} from "../types.js";
import { matchersOverlap, parseMatcher, type MatcherSet } from "../matcher-overlap.js";

/**
 * Classification for a hook script relative to `updatedInput` mutation.
 * Exported so tests and the Scanner can reuse the same categorisation.
 */
export type MutationClass = "mutates" | "readonly" | "unknown";

/**
 * Static heuristic: decide whether a hook script mutates `updatedInput`.
 *
 * - `unknown` when we could not resolve or read the script contents,
 *   OR when `HookScript.kind !== 'command'` (non-command kinds cannot be
 *   statically analysed for updatedInput mutation — Delta 2c).
 * - `mutates` when `updatedInput` appears alongside assignment, mutation,
 *   or the CC `hookSpecificOutput` update convention.
 * - `readonly` otherwise (including standalone JSON.stringify — v0.2 gap #10).
 */
export function classifyHookScript(script: HookScript): MutationClass {
  // Delta 2c: non-command kinds cannot be statically analysed.
  if (script.kind !== "command") return "unknown";

  if (!script.scriptSource || script.scriptSource.length === 0) {
    return "unknown";
  }
  const source = stripComments(script.scriptSource);
  if (!source.includes("updatedInput")) return "readonly";

  // Direct / property / index assignment to updatedInput.
  if (/\bupdatedInput\s*(?:\.\s*[A-Za-z_$][\w$]*)?\s*=[^=]/.test(source)) {
    return "mutates";
  }
  // Explicit updatedInput field in a returned/emitted object literal.
  if (/[{,]\s*updatedInput\s*:/.test(source)) {
    return "mutates";
  }
  // Writing to hookSpecificOutput alongside updatedInput (CC convention).
  if (/hookSpecificOutput[\s\S]{0,400}updatedInput/.test(source)) {
    return "mutates";
  }
  // v0.2 gap #10: standalone JSON.stringify(updatedInput) is read-only
  // serialisation — it does NOT imply the hook is mutating the input.
  // Fall through to readonly.
  return "readonly";
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** Flat entry combining provenance + parsed matcher + mutation class. */
interface HookAtMatcher {
  /** Entity string used in entities_involved. */
  entity: string;
  /** Hook source scope. */
  source: HookSource;
  event: string;
  rawMatcher: string;
  parsedMatcher: MatcherSet;
  hookCommand: string;
  scriptPath?: string;
  classification: MutationClass;
}

export class HookMatcherDetector implements Detector {
  readonly category = "hook-matcher" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const entries = flattenAllHooks(current);
    const groups = groupByOverlap(entries);
    const collisions: Collision[] = [];

    for (const group of groups) {
      if (group.length < 2) continue;
      const mutates = group.filter((e) => e.classification === "mutates");
      const unknowns = group.filter((e) => e.classification === "unknown");

      let confidence: Collision["confidence"] | null = null;
      let severity: Collision["severity"] = "warning";
      let explanation = "";

      if (mutates.length >= 2) {
        confidence = "definite";
        severity = "critical";
        explanation = `${mutates.length} hooks mutate updatedInput on the same event+matcher; later hooks overwrite earlier ones.`;
      } else if (mutates.length >= 1 && unknowns.length >= 1) {
        confidence = "possible";
        explanation =
          "One hook mutates updatedInput while a co-registered hook could not be statically analysed; mutual interference cannot be ruled out.";
      }
      if (!confidence) continue;

      // Collect all matchers in this group for the message.
      const distinctMatchers = [...new Set(group.map((e) => e.rawMatcher))];
      const matcherLabel =
        distinctMatchers.length === 1
          ? distinctMatchers[0]
          : distinctMatchers.join(" ∩ ");

      const event = group[0].event;
      const sources = [...new Set(group.map((e) => e.entity))].join(", ");

      collisions.push({
        category: "hook-matcher",
        severity,
        confidence,
        entities_involved: group.map((e) => e.entity),
        suggested_fix: [
          {
            command: "claude plugin inspect <plugin-name>",
            scope: "plugin",
            safety_level: "safe",
            rationale: `Review the hooks for event ${event} with matcher "${matcherLabel}" across: ${sources}.`,
          },
        ],
        message: `Hook matcher interference on ${event}/${matcherLabel}: ${explanation}`,
      });
    }
    return collisions;
  }
}

/** Flatten plugin-sourced and settings-sourced hooks into a single list. */
function flattenAllHooks(snapshot: SnapshotData): HookAtMatcher[] {
  const entries: HookAtMatcher[] = [];

  // 1. Plugin-sourced hooks: snapshot.plugins[].hookEvents
  for (const plugin of snapshot.plugins) {
    for (const [event, registrations] of Object.entries(plugin.hookEvents)) {
      for (const reg of registrations) {
        const rawMatcher = normaliseRawMatcher(reg.matcher);
        const parsedMatcher = parseMatcher(rawMatcher);
        for (const script of reg.hooks) {
          // Plugin entries: entity = "${plugin.name}:${event}:${matcher}"
          const entity = `${plugin.name}:${event}:${rawMatcher}`;
          entries.push({
            entity,
            source: reg.source,
            event,
            rawMatcher,
            parsedMatcher,
            hookCommand: script.command,
            scriptPath: script.scriptPath,
            classification: classifyHookScript(script),
          });
        }
      }
    }
  }

  // 2. Settings-sourced hooks: snapshot.settingsHooks[]
  for (const entry of snapshot.settingsHooks) {
    const rawMatcher = normaliseRawMatcher(entry.matcher);
    const parsedMatcher = parseMatcher(rawMatcher);
    for (const script of entry.hooks) {
      // Settings entries: entity = "${source}:${event}:${matcher}"
      const entity = `${entry.source}:${entry.event}:${rawMatcher}`;
      entries.push({
        entity,
        source: entry.source,
        event: entry.event,
        rawMatcher,
        parsedMatcher,
        hookCommand: script.command,
        scriptPath: script.scriptPath,
        classification: classifyHookScript(script),
      });
    }
  }

  return entries;
}

function normaliseRawMatcher(matcher: string | undefined): string {
  if (typeof matcher !== "string" || matcher.trim().length === 0) return "*";
  return matcher;
}

/**
 * Group entries by overlapping matchers on the same event using union-find.
 *
 * Algorithm:
 * 1. For each pair (i < j) on the same event, if their matchers overlap,
 *    union them.
 * 2. Extract connected components — each is one group.
 */
function groupByOverlap(entries: HookAtMatcher[]): HookAtMatcher[][] {
  const n = entries.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]!; // path compression
      x = parent[x]!;
    }
    return x;
  }

  function union(a: number, b: number): void {
    parent[find(a)] = find(b);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        entries[i].event === entries[j].event &&
        matchersOverlap(entries[i].parsedMatcher, entries[j].parsedMatcher)
      ) {
        union(i, j);
      }
    }
  }

  // Build component map.
  const components = new Map<number, HookAtMatcher[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const component = components.get(root) ?? [];
    component.push(entries[i]);
    components.set(root, component);
  }

  return [...components.values()];
}
