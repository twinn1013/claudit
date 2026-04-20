import type { Detector } from "../detector.js";
import type {
  Collision,
  HookRegistration,
  HookScript,
  SnapshotData,
} from "../types.js";

/**
 * Classification for a hook script relative to `updatedInput` mutation.
 * Exported so tests and the Scanner can reuse the same categorisation.
 */
export type MutationClass = "mutates" | "readonly" | "unknown";

/**
 * Static heuristic: decide whether a hook script mutates `updatedInput`.
 *
 * - `unknown` when we could not resolve or read the script contents.
 * - `mutates` when `updatedInput` appears alongside assignment, mutation,
 *   or the CC `hookSpecificOutput` update convention.
 * - `readonly` otherwise.
 */
export function classifyHookScript(script: HookScript): MutationClass {
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
  // JSON.stringify of updatedInput implies it was just built.
  if (/JSON\.stringify\s*\([^)]*updatedInput/.test(source)) {
    return "mutates";
  }
  return "readonly";
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

interface HookAtMatcher {
  plugin: string;
  event: string;
  matcher: string;
  hookCommand: string;
  scriptPath?: string;
  classification: MutationClass;
}

export class HookMatcherDetector implements Detector {
  readonly category = "hook-matcher" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const groups = groupByEventAndMatcher(current);
    const collisions: Collision[] = [];
    for (const [groupKey, entries] of groups) {
      if (entries.length < 2) continue;
      const mutates = entries.filter((e) => e.classification === "mutates");
      const unknowns = entries.filter((e) => e.classification === "unknown");

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

      const entities = entries.map(
        (e) =>
          `${e.plugin}:${e.event}:${e.matcher}:${e.scriptPath ?? e.hookCommand}`,
      );
      collisions.push({
        category: "hook-matcher",
        severity,
        confidence,
        entities_involved: entities,
        suggested_fix: [
          {
            command: "claude plugin inspect <plugin-name>",
            scope: "plugin",
            safety_level: "safe",
            rationale: `Review the hooks for event ${entries[0].event} with matcher "${entries[0].matcher}" across: ${entries.map((e) => e.plugin).join(", ")}.`,
          },
        ],
        message: `Hook matcher interference on ${entries[0].event}/${entries[0].matcher}: ${explanation}`,
      });
    }
    return collisions;
  }
}

function groupByEventAndMatcher(
  snapshot: SnapshotData,
): Map<string, HookAtMatcher[]> {
  const groups = new Map<string, HookAtMatcher[]>();
  for (const plugin of snapshot.plugins) {
    for (const [event, registrations] of Object.entries(plugin.hookEvents)) {
      for (const reg of registrations) {
        const matcher = normaliseMatcher(reg);
        for (const script of reg.hooks) {
          const key = `${event}::${matcher}`;
          const existing = groups.get(key) ?? [];
          existing.push({
            plugin: plugin.name,
            event,
            matcher,
            hookCommand: script.command,
            scriptPath: script.scriptPath,
            classification: classifyHookScript(script),
          });
          groups.set(key, existing);
        }
      }
    }
  }
  return groups;
}

function normaliseMatcher(reg: HookRegistration): string {
  if (typeof reg.matcher !== "string") return "*";
  return reg.matcher.length === 0 ? "*" : reg.matcher;
}
