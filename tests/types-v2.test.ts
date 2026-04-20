import { describe, expect, it } from "vitest";
import {
  HOOK_SOURCES,
  type HookSource,
  type HookScript,
  type HookRegistration,
  type PluginAgent,
  type PluginSummary,
} from "../src/types.js";

describe("v0.2 type schema", () => {
  it("HookSource has exactly 7 values including user-managed", () => {
    expect(HOOK_SOURCES.length).toBe(7);
    const expected = [
      "plugin-cache",
      "plugin-marketplace",
      "user-settings",
      "user-settings-local",
      "project-settings",
      "project-settings-local",
      "user-managed",
    ] as const;
    for (const s of expected) {
      expect(HOOK_SOURCES).toContain(s);
    }
  });

  it("PluginAgent uses name field (compile-time check via satisfies)", () => {
    const agent = { name: "researcher" } satisfies PluginAgent;
    expect(agent.name).toBe("researcher");
  });

  it("PluginSummary requires source and enabled fields", () => {
    const summary = {
      name: "my-plugin",
      pluginRoot: "/tmp/my-plugin",
      hookEvents: {},
      commands: [],
      skills: [],
      agents: [],
      mcpServers: [],
      source: "plugin-cache" as HookSource,
      enabled: true,
    } satisfies PluginSummary;
    expect(summary.source).toBe("plugin-cache");
    expect(summary.enabled).toBe(true);
  });

  it("HookRegistration requires source field", () => {
    const reg = {
      hooks: [],
      source: "plugin-cache" as HookSource,
    } satisfies HookRegistration;
    expect(reg.source).toBe("plugin-cache");
  });

  it("HookScript requires kind field; rawConfig is optional", () => {
    const script = {
      command: "node hooks/scan.mjs",
      kind: "command" as const,
    } satisfies HookScript;
    expect(script.kind).toBe("command");

    const withRaw = {
      command: "node hooks/prompt.mjs",
      kind: "prompt" as const,
      rawConfig: { someKey: "someValue" },
    } satisfies HookScript;
    expect(withRaw.kind).toBe("prompt");
    expect(withRaw.rawConfig).toBeDefined();
  });
});
