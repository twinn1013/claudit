import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Report } from "../../src/report.js";
import { Scanner } from "../../src/scanner.js";
import { Snapshot } from "../../src/snapshot.js";
import { isolated, mkTmp, writeJson, writeText } from "../snapshot-v2/_helpers.js";

describe("E2E: disabled plugin still yields possible collision", () => {
  it("marks hook interference as possible when one side is disabled", async () => {
    const globalRoot = await mkTmp("e2e-disabled-");
    const pluginRoot = join(
      globalRoot,
      "plugins",
      "cache",
      "omc",
      "oh-my-claudecode",
      "4.11.6",
    );

    await writeJson(join(globalRoot, "settings.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "rtk hook claude" }],
          },
        ],
      },
      enabledPlugins: {
        "oh-my-claudecode@omc": false,
      },
    });
    await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), {
      name: "oh-my-claudecode",
      version: "4.11.6",
    });
    await writeJson(join(pluginRoot, "hooks", "hooks.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "node hooks/pretooluse.mjs" }],
          },
        ],
      },
    });
    await writeText(
      join(pluginRoot, "hooks", "pretooluse.mjs"),
      [
        "updatedInput.command = `omx ${updatedInput.command}`;",
        "console.log(JSON.stringify({ hookSpecificOutput: { updatedInput } }));",
        "",
      ].join("\n"),
    );

    const snapshot = await new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    }).capture();
    const parsed = Report.parse(
      (await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot)).serialize(),
    );
    const collisions = parsed.collisions.filter(
      (collision) => collision.category === "hook-matcher",
    );

    expect(snapshot.plugins[0]?.enabled).toBe(false);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("possible");
    expect(collisions[0].message.toLowerCase()).toContain("disabled");
    expect(collisions[0].message.toLowerCase()).toContain("re-enable");
  });

  it("resolves foo@alpha=false and foo@beta=true independently", async () => {
    const globalRoot = await mkTmp("e2e-disabled-same-name-");
    const alphaRoot = join(
      globalRoot,
      "plugins",
      "cache",
      "alpha",
      "foo",
      "1.0.0",
    );
    const betaRoot = join(
      globalRoot,
      "plugins",
      "cache",
      "beta",
      "foo",
      "1.0.0",
    );

    await writeJson(join(globalRoot, "settings.json"), {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "rtk hook claude" }],
          },
        ],
      },
      enabledPlugins: {
        "foo@alpha": false,
        "foo@beta": true,
      },
    });

    for (const pluginRoot of [alphaRoot, betaRoot]) {
      await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), {
        name: "foo",
        version: "1.0.0",
      });
      await writeJson(join(pluginRoot, "hooks", "hooks.json"), {
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "node hooks/pretooluse.mjs" }],
            },
          ],
        },
      });
      await writeText(
        join(pluginRoot, "hooks", "pretooluse.mjs"),
        [
          "updatedInput.command = `omx ${updatedInput.command}`;",
          "console.log(JSON.stringify({ hookSpecificOutput: { updatedInput } }));",
          "",
        ].join("\n"),
      );
    }

    const snapshot = await new Snapshot({
      globalRoot,
      pathOverride: "",
      ...isolated(),
    }).capture();
    const enabledByQualified = new Map(
      snapshot.plugins.map((plugin) => [plugin.qualifiedName, plugin.enabled]),
    );
    expect(enabledByQualified.get("foo@alpha")).toBe(false);
    expect(enabledByQualified.get("foo@beta")).toBe(true);

    const parsed = Report.parse(
      (await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot)).serialize(),
    );
    const hookCollisions = parsed.collisions.filter(
      (collision) => collision.category === "hook-matcher",
    );

    expect(
      hookCollisions.some(
        (collision) =>
          collision.confidence === "definite" &&
          collision.entities_involved.includes("foo@beta:PreToolUse:*"),
      ),
    ).toBe(true);
    expect(
      hookCollisions.some(
        (collision) =>
          collision.confidence === "possible" &&
          collision.entities_involved.includes("foo@alpha:PreToolUse:*"),
      ),
    ).toBe(true);
  });
});
