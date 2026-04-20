import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson, writeText } from "./_helpers.js";

describe("capturePluginsFromCache — 3-level walk", () => {
  it("discovers plugins at cache/<marketplace>/<plugin>/<version>/", async () => {
    const globalRoot = await mkTmp("cache-depth-");
    // ~/.claude/plugins/cache/omc/oh-my-claudecode/4.11.6/.claude-plugin/plugin.json
    const versionDir = join(
      globalRoot,
      "plugins",
      "cache",
      "omc",
      "oh-my-claudecode",
      "4.11.6",
    );
    await writeJson(
      join(versionDir, ".claude-plugin", "plugin.json"),
      { name: "oh-my-claudecode", version: "4.11.6" },
    );
    await writeJson(join(versionDir, "hooks", "hooks.json"), {
      hooks: {
        PostToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "node hooks/h.mjs" }],
          },
        ],
      },
    });
    await writeText(join(versionDir, "hooks", "h.mjs"), "console.log('x')\n");

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    expect(data.plugins).toHaveLength(1);
    const p = data.plugins[0];
    expect(p.name).toBe("oh-my-claudecode");
    expect(p.source).toBe("plugin-cache");
    expect(p.enabled).toBe(true);
    expect(Object.keys(p.hookEvents)).toEqual(["PostToolUse"]);
    expect(p.hookEvents.PostToolUse[0].source).toBe("plugin-cache");
    expect(p.hookEvents.PostToolUse[0].hooks[0].kind).toBe("command");
  });

  it("ignores plugins at the wrong depth (cache/<m>/<p>/ without version)", async () => {
    const globalRoot = await mkTmp("cache-depth-wrong-");
    const wrongDepth = join(globalRoot, "plugins", "cache", "omc", "oh-my-claudecode");
    await writeJson(
      join(wrongDepth, ".claude-plugin", "plugin.json"),
      { name: "oh-my-claudecode" },
    );
    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    // The 3-level walker refuses the 2-level layout. The legacy walker
    // also skips `cache/` so this plugin is not discovered. (Users should
    // use the proper versioned cache layout.)
    expect(data.plugins).toHaveLength(0);
  });
});
