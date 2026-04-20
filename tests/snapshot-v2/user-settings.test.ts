import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson } from "./_helpers.js";

describe("captureUserSettings", () => {
  it("captures rtk hook from user settings.json with source='user-settings'", async () => {
    const globalRoot = await mkTmp("user-settings-");
    await writeJson(join(globalRoot, "settings.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "rtk hook claude" }],
          },
        ],
      },
    });

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();

    expect(data.settingsHooks).toHaveLength(1);
    const entry = data.settingsHooks[0];
    expect(entry.event).toBe("PreToolUse");
    expect(entry.matcher).toBe("Bash");
    expect(entry.source).toBe("user-settings");
    expect(entry.hooks).toHaveLength(1);
    expect(entry.hooks[0].command).toBe("rtk hook claude");
    expect(entry.hooks[0].kind).toBe("command");
  });

  it("tags settings.local.json entries with source='user-settings-local'", async () => {
    const globalRoot = await mkTmp("user-settings-local-");
    await writeJson(join(globalRoot, "settings.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "node hooks/u.mjs" }],
          },
        ],
      },
    });
    await writeJson(join(globalRoot, "settings.local.json"), {
      hooks: {
        PostToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "node hooks/local.mjs" }],
          },
        ],
      },
    });

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    const bySource = new Map(data.settingsHooks.map((e) => [e.source, e]));
    expect(bySource.get("user-settings")?.event).toBe("PreToolUse");
    expect(bySource.get("user-settings-local")?.event).toBe("PostToolUse");
  });

  it("reads mcpServers from settings.json", async () => {
    const globalRoot = await mkTmp("user-mcp-");
    await writeJson(join(globalRoot, "settings.json"), {
      mcpServers: {
        github: { tools: ["issues"] },
      },
    });
    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    expect(data.settingsMcpServers.map((m) => m.name)).toEqual(["github"]);
  });
});
