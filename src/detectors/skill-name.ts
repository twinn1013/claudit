import type { Detector } from "../detector.js";
import type { Collision, SnapshotData } from "../types.js";

/**
 * Detects duplicate skill names across plugins (definite) and overlapping
 * trigger keywords (possible — activation precedence is runtime-dependent).
 */
export class SkillNameDetector implements Detector {
  readonly category = "skill-name" as const;

  async analyze(current: SnapshotData): Promise<Collision[]> {
    const collisions: Collision[] = [];

    const nameIndex = new Map<string, string[]>();
    const keywordIndex = new Map<string, Array<{ plugin: string; skill: string }>>();
    for (const plugin of current.plugins) {
      for (const skill of plugin.skills) {
        const pluginsForName = nameIndex.get(skill.name) ?? [];
        pluginsForName.push(plugin.name);
        nameIndex.set(skill.name, pluginsForName);
        for (const kw of skill.triggerKeywords) {
          const normalized = kw.toLowerCase().trim();
          if (!normalized) continue;
          const holders = keywordIndex.get(normalized) ?? [];
          holders.push({ plugin: plugin.name, skill: skill.name });
          keywordIndex.set(normalized, holders);
        }
      }
    }

    for (const [name, plugins] of nameIndex) {
      const unique = [...new Set(plugins)].sort();
      if (unique.length < 2) continue;
      collisions.push({
        category: "skill-name",
        severity: "warning",
        confidence: "definite",
        entities_involved: unique.map((p) => `${p}:skill:${name}`),
        suggested_fix: [
          {
            command: `# rename the skill inside one of: ${unique.join(", ")}`,
            scope: "plugin",
            safety_level: "manual-review",
            rationale: `Skill name "${name}" is defined by ${unique.length} plugins; trigger resolution becomes order-dependent.`,
          },
        ],
        message: `${unique.length} plugins define a skill named "${name}": ${unique.join(", ")}.`,
      });
    }

    for (const [keyword, holders] of keywordIndex) {
      const uniquePairs = new Map<string, { plugin: string; skill: string }>();
      for (const h of holders) uniquePairs.set(`${h.plugin}::${h.skill}`, h);
      const entries = [...uniquePairs.values()];
      const distinctSkills = new Set(entries.map((e) => `${e.plugin}:${e.skill}`));
      if (distinctSkills.size < 2) continue;
      collisions.push({
        category: "skill-name",
        severity: "info",
        confidence: "possible",
        entities_involved: entries.map(
          (e) => `${e.plugin}:skill:${e.skill}:trigger:${keyword}`,
        ),
        suggested_fix: [
          {
            command: `# refine trigger keywords to avoid "${keyword}" in one of the skills`,
            scope: "plugin",
            safety_level: "manual-review",
            rationale: `Trigger keyword "${keyword}" is shared by multiple skills; activation precedence is runtime-dependent and may surprise users.`,
          },
        ],
        message: `Trigger keyword "${keyword}" is shared by ${distinctSkills.size} skills: ${[...distinctSkills].join(", ")}.`,
      });
    }

    return collisions;
  }
}
