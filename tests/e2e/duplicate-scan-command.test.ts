import { describe, expect, it } from "vitest";
import { Scanner } from "../../src/scanner.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

/**
 * E2E scenario: two plugins register /scan independently. The full pipeline
 * must produce a definite slash-command collision listing both plugins.
 */
describe("E2E: duplicate /scan command across two plugins", () => {
  it("surfaces a definite slash-command Collision via the full Scanner pipeline", async () => {
    const globalRoot = await makeGlobalRoot([
      { name: "claudit", commands: ["scan.md", "status.md"] },
      { name: "other-audit", commands: ["scan.md"] },
    ]);
    const snapshot = await new Snapshot({
      globalRoot,
      pathOverride: "",
    }).capture();
    const report = await new Scanner().run(snapshot);
    const collisions = report.collisions.filter(
      (c) => c.category === "slash-command",
    );
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].entities_involved.sort()).toEqual([
      "claudit:/scan",
      "other-audit:/scan",
    ]);
  });
});
