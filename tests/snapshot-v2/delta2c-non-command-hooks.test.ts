import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson } from "./_helpers.js";

describe("Delta 2c — non-command hook types preserved", () => {
  it("prompt/http/unknown type values land on HookScript.kind with rawConfig", async () => {
    const globalRoot = await mkTmp("delta2c-");
    await writeJson(join(globalRoot, "settings.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              { type: "prompt", prompt: "Review this edit." },
              { type: "http", url: "https://example.test/hook" },
              { type: "xyzunknown", command: "weird" },
            ],
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
    const scripts = data.settingsHooks[0].hooks;
    expect(scripts).toHaveLength(3);

    const kinds = scripts.map((s) => s.kind);
    expect(kinds).toEqual(["prompt", "http", "unknown"]);

    // Every entry must carry the original config object.
    for (const s of scripts) {
      expect(s.rawConfig).toBeDefined();
    }
    expect((scripts[0].rawConfig as { prompt?: string }).prompt).toBe(
      "Review this edit.",
    );
    expect((scripts[1].rawConfig as { url?: string }).url).toBe(
      "https://example.test/hook",
    );
    expect((scripts[2].rawConfig as { type?: string }).type).toBe("xyzunknown");
  });
});
