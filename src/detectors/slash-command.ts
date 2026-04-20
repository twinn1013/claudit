import type { Detector } from "../detector.js";
import type { Collision, SnapshotData } from "../types.js";

/**
 * Detects duplicate slash-command base names across plugins.
 * Two plugins registering `/<name>` where the base name matches exactly
 * produce a `definite` collision — CC has no resolution order guaranteed
 * across plugins, so either one may win depending on install order.
 */
export class SlashCommandDetector implements Detector {
  readonly category = "slash-command" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const byName = new Map<string, { plugin: string; path?: string }[]>();
    for (const plugin of current.plugins) {
      for (const cmd of plugin.commands) {
        const entries = byName.get(cmd.name) ?? [];
        entries.push({ plugin: plugin.name, path: cmd.path });
        byName.set(cmd.name, entries);
      }
    }

    const collisions: Collision[] = [];
    for (const [name, entries] of byName) {
      const uniquePlugins = new Set(entries.map((e) => e.plugin));
      if (uniquePlugins.size < 2) continue;
      const involvedPlugins = [...uniquePlugins].sort();
      collisions.push({
        category: "slash-command",
        severity: "warning",
        confidence: "definite",
        entities_involved: involvedPlugins.map((p) => `${p}:/${name}`),
        suggested_fix: [
          {
            command: `claude plugin uninstall ${involvedPlugins[involvedPlugins.length - 1]}`,
            scope: "global",
            safety_level: "destructive",
            rationale: `Remove the duplicate /${name} registration from one of the plugins. Pick whichever implementation you do not rely on.`,
          },
          {
            command: `# or rename the command inside the plugin that is yours to edit`,
            scope: "plugin",
            safety_level: "manual-review",
            rationale: `Rename /${name} inside one of ${involvedPlugins.join(", ")} so the namespaces do not collide.`,
          },
        ],
        message: `${involvedPlugins.length} plugins register /${name}: ${involvedPlugins.join(", ")}.`,
      });
    }
    return collisions;
  }
}
