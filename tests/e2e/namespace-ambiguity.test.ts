import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Report } from "../../src/report.js";
import { Scanner } from "../../src/scanner.js";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson, writeText } from "../snapshot-v2/_helpers.js";

describe("E2E: namespace ambiguity via real plugin cache fixtures", () => {
  it("downgrades duplicate slash commands to info/possible", async () => {
    const globalRoot = await mkTmp("e2e-namespace-");
    for (const [marketplace, plugin, version] of [
      ["alpha-market", "alpha-tools", "1.0.0"],
      ["beta-market", "beta-tools", "2.0.0"],
    ]) {
      const pluginRoot = join(
        globalRoot,
        "plugins",
        "cache",
        marketplace,
        plugin,
        version,
      );
      await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), {
        name: plugin,
        version,
        commands: ["./commands/scan.md"],
      });
      await writeText(
        join(pluginRoot, "commands", "scan.md"),
        "---\ndescription: scan\n---\nscan\n",
      );
    }

    const snapshot = await new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    }).capture();
    const parsed = Report.parse(
      (await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot)).serialize(),
    );
    const collisions = parsed.collisions.filter(
      (collision) => collision.category === "slash-command",
    );

    expect(collisions).toHaveLength(1);
    expect(collisions[0].severity).toBe("info");
    expect(collisions[0].confidence).toBe("possible");
    expect(collisions[0].entities_involved).toEqual([
      "alpha-tools:/scan",
      "beta-tools:/scan",
    ]);
    expect(collisions[0].message).toContain("/alpha-tools:scan");
    expect(collisions[0].message).toContain("/beta-tools:scan");
  });
});
