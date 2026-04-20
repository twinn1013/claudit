import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { mkTmp, writeJson } from "./_helpers.js";

describe("Delta 2a — managed-settings probe", () => {
  it("tags hooks from the managed-settings path with source='user-managed'", async () => {
    const tmpRoot = await mkTmp("delta2a-");
    const globalRoot = join(tmpRoot, ".claude");
    await writeJson(join(globalRoot, "settings.json"), {});
    const managedPath = join(tmpRoot, "managed-settings.json");
    await writeJson(managedPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "node policy.mjs" }],
          },
        ],
      },
    });

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/home.json",
      managedSettingsPath: managedPath,
    });
    const data = await snap.capture();
    const managed = data.settingsHooks.filter(
      (e) => e.source === "user-managed",
    );
    expect(managed).toHaveLength(1);
    expect(managed[0].event).toBe("PreToolUse");
    expect(managed[0].hooks[0].command).toBe("node policy.mjs");
  });

  it("capture() proceeds when the managed path is missing", async () => {
    const globalRoot = await mkTmp("delta2a-missing-");
    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      homeMcpConfigPath: "/nonexistent/home.json",
      managedSettingsPath: "/nonexistent/managed.json",
    });
    const data = await snap.capture();
    expect(data.settingsHooks).toEqual([]);
  });
});
