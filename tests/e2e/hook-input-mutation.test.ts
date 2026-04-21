import { describe, expect, it } from "vitest";
import { Scanner } from "../../src/scanner.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

/**
 * E2E scenario: two plugins both install PreToolUse hooks on matcher "Bash"
 * that mutate `updatedInput`. Full pipeline must produce a definite
 * hook-matcher Collision with confidence definite.
 */
describe("E2E: two hooks mutating updatedInput on the same matcher", () => {
  it("surfaces a definite hook-matcher Collision with confidence definite", async () => {
    const globalRoot = await makeGlobalRoot([
      {
        name: "plugin-token-killer",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/rewrite.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: {
          "hooks/rewrite.mjs":
            "updatedInput.command = 'rtk ' + updatedInput.command;\nconsole.log(JSON.stringify({ hookSpecificOutput: { updatedInput } }));",
        },
      },
      {
        name: "plugin-security-filter",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/filter.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: {
          "hooks/filter.mjs":
            "if (updatedInput.command.includes('rm -rf /')) updatedInput.command = 'echo blocked';\nconsole.log(JSON.stringify({ hookSpecificOutput: { updatedInput } }));",
        },
      },
    ]);

    const snapshot = await new Snapshot({
      globalRoot,
      pathOverride: "",
    }).capture();
    const report = await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot);
    const collisions = report.collisions.filter(
      (c) => c.category === "hook-matcher",
    );
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].severity).toBe("critical");
    expect(collisions[0].entities_involved).toHaveLength(2);
  });

  it("does not surface a collision when the overlapping hooks belong to the same plugin", async () => {
    const globalRoot = await makeGlobalRoot([
      {
        name: "plugin-omc",
        hookEvents: {
          PermissionRequest: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/rewrite-a.mjs",
                  timeout: 5000,
                },
                {
                  type: "command",
                  command: "node hooks/rewrite-b.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: {
          "hooks/rewrite-a.mjs":
            "updatedInput.command = 'rtk ' + updatedInput.command;\nconsole.log(JSON.stringify({ hookSpecificOutput: { updatedInput } }));",
          "hooks/rewrite-b.mjs":
            "updatedInput.command = 'safe ' + updatedInput.command;\nconsole.log(JSON.stringify({ hookSpecificOutput: { updatedInput } }));",
        },
      },
    ]);

    const snapshot = await new Snapshot({
      globalRoot,
      pathOverride: "",
    }).capture();
    const report = await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot);
    const collisions = report.collisions.filter(
      (c) => c.category === "hook-matcher",
    );
    expect(collisions).toEqual([]);
  });
});
