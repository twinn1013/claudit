import type { Detector } from "../detector.js";
import { pluginOrigin } from "../plugin-identity.js";
import type { Collision, SnapshotData } from "../types.js";
import { formatDisambiguationMessage } from "./namespace-util.js";

/**
 * Detects duplicate slash-command base names across plugins.
 *
 * v0.2: same base name across plugins = info/possible per namespace-aware
 * semantics. CC disambiguates via `plugin:name`, so nothing is broken —
 * but unqualified `/name` invocations are ambiguous.
 */
export class SlashCommandDetector implements Detector {
  readonly category = "slash-command" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const byName = new Map<string, Array<{ plugin: string; publicName: string; enabled: boolean }>>();
    for (const plugin of current.plugins) {
      for (const cmd of plugin.commands) {
        const entries = byName.get(cmd.name) ?? [];
        entries.push({
          plugin: pluginOrigin(plugin),
          publicName: plugin.name,
          enabled: plugin.enabled,
        });
        byName.set(cmd.name, entries);
      }
    }

    const collisions: Collision[] = [];
    for (const [name, entries] of byName) {
      // Dedupe by plugin name, keeping the enabled flag (false wins if any entry is disabled).
      const pluginMap = new Map<string, { enabled: boolean; publicName: string }>();
      for (const e of entries) {
        const currentEntry = pluginMap.get(e.plugin);
        pluginMap.set(e.plugin, {
          enabled: (currentEntry?.enabled ?? true) && e.enabled,
          publicName: currentEntry?.publicName ?? e.publicName,
        });
      }
      if (pluginMap.size < 2) continue;

      const plugins = [...pluginMap.entries()]
        .map(([n, info]) => ({
          name: n,
          publicName: info.publicName,
          enabled: info.enabled,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      collisions.push({
        category: "slash-command",
        severity: "info",
        confidence: "possible",
        entities_involved: plugins.map((p) => `${p.name}:/${name}`),
        suggested_fix: [],
        message: formatDisambiguationMessage("command", name, plugins),
      });
    }
    return collisions;
  }
}
