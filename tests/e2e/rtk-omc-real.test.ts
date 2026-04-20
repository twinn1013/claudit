import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Report } from "../../src/report.js";
import { Scanner } from "../../src/scanner.js";
import { Snapshot } from "../../src/snapshot.js";
import { isolated } from "../snapshot-v2/_helpers.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/rtk-omc", import.meta.url));

describe("E2E: flagship RTK + OMC fixture", () => {
  it("detects cross-source PreToolUse interference from user settings and plugin cache", async () => {
    const snapshot = await new Snapshot({
      globalRoot: fixtureRoot,
      pathOverride: "",
      ...isolated(),
    }).capture();

    const report = await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot);
    const parsed = Report.parse(report.serialize());
    const collisions = parsed.collisions.filter(
      (collision) => collision.category === "hook-matcher",
    );

    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].entities_involved).toContain("user-settings:PreToolUse:*");
    expect(collisions[0].entities_involved).toContain(
      "oh-my-claudecode@omc:PreToolUse:*",
    );
    expect(snapshot.plugins[0]?.pluginRoot).toBe(
      join(
        fixtureRoot,
        "plugins",
        "cache",
        "omc",
        "oh-my-claudecode",
        "4.11.6",
      ),
    );
  });
});
