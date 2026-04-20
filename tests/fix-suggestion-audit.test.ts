/**
 * Cross-detector FixSuggestion audit.
 *
 * For every detector that can produce collisions, build a minimal snapshot
 * that triggers at least one collision and verify invariants on all
 * FixSuggestion entries:
 *   - command does NOT contain '#' (no pseudo-comments)
 *   - if command === "", then safety_level === "manual-review"
 *   - safety_level is one of "safe" | "destructive" | "manual-review"
 *   - for categories slash-command | skill-name | subagent-type with
 *     severity: "info", safety_level is NOT "destructive"
 */
import { describe, expect, it } from "vitest";
import { HookMatcherDetector } from "../src/detectors/hook-matcher.js";
import { McpIdentifierDetector } from "../src/detectors/mcp-identifier.js";
import { PathBinaryDetector } from "../src/detectors/path-binary.js";
import { SkillNameDetector } from "../src/detectors/skill-name.js";
import { SlashCommandDetector } from "../src/detectors/slash-command.js";
import { SubagentTypeDetector } from "../src/detectors/subagent-type.js";
import type {
  Collision,
  McpServer,
  PluginSummary,
  SnapshotData,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Minimal snapshot builder helpers
// ---------------------------------------------------------------------------

function emptySnapshot(): SnapshotData {
  return {
    globalRoot: "/tmp/claudit-audit-test",
    capturedAt: "2026-04-20T00:00:00.000Z",
    fingerprint: "audit-test",
    plugins: [],
    settingsHooks: [],
    settingsMcpServers: [],
    projectMcpServers: [],
    pathBinaries: {},
  };
}

function makePlugin(
  name: string,
  overrides: Partial<Omit<PluginSummary, "name">> = {},
): PluginSummary {
  return {
    name,
    pluginRoot: `/tmp/plugins/${name}`,
    source: "plugin-cache",
    enabled: true,
    commands: [],
    skills: [],
    agents: [],
    mcpServers: [],
    hookEvents: {},
    ...overrides,
  };
}

function mcpServer(name: string, tools: string[] = []): McpServer {
  return { name, tools, source: "plugin" };
}

// ---------------------------------------------------------------------------
// Shared assertion
// ---------------------------------------------------------------------------

const VALID_SAFETY_LEVELS = new Set(["safe", "destructive", "manual-review"]);
const NAMESPACE_CATEGORIES = new Set(["slash-command", "skill-name", "subagent-type"]);

function assertFixSuggestions(collisions: Collision[], detectorName: string): void {
  for (const collision of collisions) {
    for (const fix of collision.suggested_fix) {
      expect(
        fix.command.includes("#"),
        `${detectorName}: fix command must not contain '#': ${JSON.stringify(fix.command)}`,
      ).toBe(false);

      expect(
        VALID_SAFETY_LEVELS.has(fix.safety_level),
        `${detectorName}: safety_level must be one of safe|destructive|manual-review, got: ${fix.safety_level}`,
      ).toBe(true);

      if (fix.command === "") {
        expect(
          fix.safety_level,
          `${detectorName}: empty command must have safety_level=manual-review`,
        ).toBe("manual-review");
      }

      if (
        NAMESPACE_CATEGORIES.has(collision.category) &&
        collision.severity === "info"
      ) {
        expect(
          fix.safety_level,
          `${detectorName}: namespace-ambiguity collision must not be destructive`,
        ).not.toBe("destructive");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// HookMatcherDetector
// ---------------------------------------------------------------------------
describe("FixSuggestion audit — HookMatcherDetector", () => {
  it("produces valid FixSuggestions for mutual-mutation collision", async () => {
    const snapshot: SnapshotData = {
      ...emptySnapshot(),
      plugins: [
        makePlugin("plugin-a", {
          hookEvents: {
            PostToolUse: [
              {
                matcher: "*",
                source: "plugin-cache",
                hooks: [
                  {
                    command: "node /a/hook.js",
                    kind: "command",
                    scriptSource:
                      "const updatedInput = JSON.parse(stdin); updatedInput.x = 1; process.stdout.write(JSON.stringify({ updatedInput }));",
                  },
                ],
              },
            ],
          },
        }),
        makePlugin("plugin-b", {
          hookEvents: {
            PostToolUse: [
              {
                matcher: "*",
                source: "plugin-cache",
                hooks: [
                  {
                    command: "node /b/hook.js",
                    kind: "command",
                    scriptSource:
                      "const updatedInput = {}; updatedInput.y = 2; process.stdout.write(JSON.stringify({ updatedInput }));",
                  },
                ],
              },
            ],
          },
        }),
      ],
    };
    const detector = new HookMatcherDetector();
    const collisions = await detector.analyze(snapshot as any);
    expect(collisions.length).toBeGreaterThan(0);
    assertFixSuggestions(collisions, "HookMatcherDetector");
  });
});

// ---------------------------------------------------------------------------
// SlashCommandDetector
// ---------------------------------------------------------------------------
describe("FixSuggestion audit — SlashCommandDetector", () => {
  it("produces valid FixSuggestions (empty suggested_fix) for slash-command collision", async () => {
    const snapshot: SnapshotData = {
      ...emptySnapshot(),
      plugins: [
        makePlugin("plugin-a", { commands: [{ name: "scan" }] }),
        makePlugin("plugin-b", { commands: [{ name: "scan" }] }),
      ],
    };
    const detector = new SlashCommandDetector();
    const collisions = await detector.analyze(snapshot);
    expect(collisions.length).toBeGreaterThan(0);
    for (const c of collisions) {
      expect(c.severity).toBe("info");
      expect(c.suggested_fix).toEqual([]);
    }
    assertFixSuggestions(collisions, "SlashCommandDetector");
  });
});

// ---------------------------------------------------------------------------
// SkillNameDetector
// ---------------------------------------------------------------------------
describe("FixSuggestion audit — SkillNameDetector", () => {
  it("produces valid FixSuggestions for skill name collision", async () => {
    const snapshot: SnapshotData = {
      ...emptySnapshot(),
      plugins: [
        makePlugin("plugin-a", {
          skills: [{ name: "analyze", triggerKeywords: ["analyze"] }],
        }),
        makePlugin("plugin-b", {
          skills: [{ name: "analyze", triggerKeywords: ["analyze"] }],
        }),
      ],
    };
    const detector = new SkillNameDetector();
    const collisions = await detector.analyze(snapshot);
    expect(collisions.length).toBeGreaterThan(0);
    for (const c of collisions) {
      expect(c.severity).toBe("info");
    }
    assertFixSuggestions(collisions, "SkillNameDetector");
  });
});

// ---------------------------------------------------------------------------
// SubagentTypeDetector
// ---------------------------------------------------------------------------
describe("FixSuggestion audit — SubagentTypeDetector", () => {
  it("produces valid FixSuggestions for subagent name collision", async () => {
    const snapshot: SnapshotData = {
      ...emptySnapshot(),
      plugins: [
        makePlugin("plugin-a", { agents: [{ name: "executor" }] }),
        makePlugin("plugin-b", { agents: [{ name: "executor" }] }),
      ],
    };
    const detector = new SubagentTypeDetector();
    const collisions = await detector.analyze(snapshot);
    expect(collisions.length).toBeGreaterThan(0);
    for (const c of collisions) {
      expect(c.severity).toBe("info");
    }
    assertFixSuggestions(collisions, "SubagentTypeDetector");
  });
});

// ---------------------------------------------------------------------------
// McpIdentifierDetector
// ---------------------------------------------------------------------------
describe("FixSuggestion audit — McpIdentifierDetector", () => {
  it("produces valid FixSuggestions for MCP server name collision", async () => {
    const snapshot: SnapshotData = {
      ...emptySnapshot(),
      plugins: [makePlugin("plugin-a", { mcpServers: [mcpServer("filesystem")] })],
      settingsMcpServers: [{ name: "filesystem", tools: [], source: "settings" }],
    };
    const detector = new McpIdentifierDetector();
    const collisions = await detector.analyze(snapshot);
    expect(collisions.length).toBeGreaterThan(0);
    assertFixSuggestions(collisions, "McpIdentifierDetector");
  });
});

// ---------------------------------------------------------------------------
// PathBinaryDetector
// ---------------------------------------------------------------------------
describe("FixSuggestion audit — PathBinaryDetector", () => {
  it("produces valid FixSuggestions for path binary collision", async () => {
    const snapshot: SnapshotData = {
      ...emptySnapshot(),
      pathBinaries: {
        node: ["/usr/local/bin/node", "/usr/bin/node"],
      },
    };
    const detector = new PathBinaryDetector({
      stat: async (_p: string) =>
        ({
          isFile: () => true,
          mode: 0o755,
        }) as any,
      realpath: async (p: string) => p,
      readFile: async (p: string) => Buffer.from(`binary-content-${p}`),
    });
    const collisions = await detector.analyze(snapshot);
    expect(collisions.length).toBeGreaterThan(0);
    assertFixSuggestions(collisions, "PathBinaryDetector");
  });
});
