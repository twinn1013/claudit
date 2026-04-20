import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson } from "./_helpers.js";

describe("captureProjectSettings", () => {
  it("captures hooks from project settings.json and settings.local.json", async () => {
    const globalRoot = await mkTmp("gr-");
    const projectRoot = await mkTmp("proj-");
    await writeJson(join(projectRoot, ".claude", "settings.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "node .claude/scan.mjs" }],
          },
        ],
      },
    });
    await writeJson(join(projectRoot, ".claude", "settings.local.json"), {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: "echo project-local" }],
          },
        ],
      },
    });

    const snap = new Snapshot({
      globalRoot,
      projectRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();

    const bySource = new Map(data.settingsHooks.map((e) => [e.source, e]));
    expect(bySource.get("project-settings")?.event).toBe("PreToolUse");
    expect(bySource.get("project-settings-local")?.event).toBe("PostToolUse");
    expect(bySource.get("project-settings-local")?.matcher).toBe("Edit");
  });
});
