import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson, writeText } from "./_helpers.js";

describe("YAML block-list triggers parse correctly", () => {
  it("parses block-list triggers: [deep dive, deep-dive]", async () => {
    const globalRoot = await mkTmp("yaml-block-");
    const pRoot = join(globalRoot, "plugins", "omc");
    await writeJson(join(pRoot, ".claude-plugin", "plugin.json"), {
      name: "omc",
    });
    const skillMd = [
      "---",
      "name: deep-dive",
      'description: "Two-stage pipeline"',
      "triggers:",
      '  - "deep dive"',
      '  - "deep-dive"',
      "---",
      "body",
      "",
    ].join("\n");
    await writeText(join(pRoot, "skills", "deep-dive", "SKILL.md"), skillMd);

    const snap = new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    });
    const data = await snap.capture();
    const p = data.plugins.find((pp) => pp.name === "omc");
    expect(p?.skills).toHaveLength(1);
    expect(p?.skills[0].name).toBe("deep-dive");
    expect(p?.skills[0].triggerKeywords).toEqual(["deep dive", "deep-dive"]);
    expect(p?.skills[0].parseWarnings ?? []).toEqual([]);
  });
});
