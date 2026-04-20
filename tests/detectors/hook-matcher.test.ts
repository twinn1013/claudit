import { describe, expect, it } from "vitest";
import {
  HookMatcherDetector,
  classifyHookScript,
} from "../../src/detectors/hook-matcher.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot } from "../helpers/fixtures.js";

describe("classifyHookScript", () => {
  it("flags direct updatedInput assignment as mutating", () => {
    expect(
      classifyHookScript({
        command: "x",
        kind: "command",
        scriptSource: "const updatedInput = { x: 1 };\nprocess.stdout.write(updatedInput);",
      }),
    ).toBe("mutates");
  });

  it("flags property assignment as mutating", () => {
    expect(
      classifyHookScript({
        command: "x",
        kind: "command",
        scriptSource: "updatedInput.command = 'echo 1';",
      }),
    ).toBe("mutates");
  });

  it("flags bracket assignment as mutating", () => {
    expect(
      classifyHookScript({
        command: "x",
        kind: "command",
        scriptSource: `updatedInput["command"] = "echo 1";`,
      }),
    ).toBe("mutates");
  });

  it("flags deep property-chain assignment as mutating", () => {
    expect(
      classifyHookScript({
        command: "x",
        kind: "command",
        scriptSource: "updatedInput.tool.payload.command = 'echo 1';",
      }),
    ).toBe("mutates");
  });

  it("flags hookSpecificOutput updatedInput emission as mutating", () => {
    expect(
      classifyHookScript({
        command: "x",
        kind: "command",
        scriptSource:
          "const out = { hookSpecificOutput: { updatedInput: { cmd: 'x' } } };",
      }),
    ).toBe("mutates");
  });

  it("treats scripts that never mention updatedInput as readonly", () => {
    expect(
      classifyHookScript({
        command: "x",
        kind: "command",
        scriptSource: "console.log('noop');",
      }),
    ).toBe("readonly");
  });

  it("treats missing scriptSource as unknown", () => {
    expect(
      classifyHookScript({ command: "x", kind: "command", scriptSource: "" }),
    ).toBe("unknown");
  });
});

const mutatingScript = `updatedInput.command = 'rewritten';\nconsole.log(JSON.stringify({ hookSpecificOutput: { updatedInput } }));`;
const readOnlyScript = `console.log("no mutation");`;

describe("HookMatcherDetector.analyze", () => {
  it("returns definite collision when two hooks both mutate updatedInput on same matcher", async () => {
    const root = await makeGlobalRoot([
      {
        name: "plugin-a",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/mutator-a.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: { "hooks/mutator-a.mjs": mutatingScript },
      },
      {
        name: "plugin-b",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/mutator-b.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: { "hooks/mutator-b.mjs": mutatingScript },
      },
    ]);
    const data = await new Snapshot({
      globalRoot: root,
      pathOverride: "",
    }).capture();
    const detector = new HookMatcherDetector();
    const collisions = await detector.analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].category).toBe("hook-matcher");
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].severity).toBe("critical");
    expect(collisions[0].entities_involved).toHaveLength(2);
  });

  it("returns no collision when one hook mutates and the other is read-only", async () => {
    const root = await makeGlobalRoot([
      {
        name: "plugin-a",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/mutator.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: { "hooks/mutator.mjs": mutatingScript },
      },
      {
        name: "plugin-b",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/readonly.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: { "hooks/readonly.mjs": readOnlyScript },
      },
    ]);
    const data = await new Snapshot({
      globalRoot: root,
      pathOverride: "",
    }).capture();
    const collisions = await new HookMatcherDetector().analyze(data);
    expect(collisions).toEqual([]);
  });

  it("returns possible collision when one mutates and the other is unknown (source unavailable)", async () => {
    const root = await makeGlobalRoot([
      {
        name: "plugin-a",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/mutator.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: { "hooks/mutator.mjs": mutatingScript },
      },
      {
        name: "plugin-b",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "external-binary --watch",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        // no hookScripts — unresolvable
      },
    ]);
    const data = await new Snapshot({
      globalRoot: root,
      pathOverride: "",
    }).capture();
    const collisions = await new HookMatcherDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("possible");
  });

  it("returns unknown/info when two overlapping hooks are both unresolved", async () => {
    const root = await makeGlobalRoot([
      {
        name: "plugin-a",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "external-a --watch",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
      },
      {
        name: "plugin-b",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "external-b --watch",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
      },
    ]);
    const data = await new Snapshot({
      globalRoot: root,
      pathOverride: "",
    }).capture();
    const collisions = await new HookMatcherDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("unknown");
    expect(collisions[0].severity).toBe("info");
  });

  it("detects collisions when mutating scripts use bracket and deep-property writes", async () => {
    const root = await makeGlobalRoot([
      {
        name: "plugin-a",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/mutator-a.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: {
          "hooks/mutator-a.mjs": `updatedInput["command"] = "echo a";`,
        },
      },
      {
        name: "plugin-b",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/mutator-b.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: {
          "hooks/mutator-b.mjs": `updatedInput.tool.payload.command = "echo b";`,
        },
      },
    ]);
    const data = await new Snapshot({
      globalRoot: root,
      pathOverride: "",
    }).capture();
    const collisions = await new HookMatcherDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
  });

  it("returns no collision when hooks have different matchers on the same event", async () => {
    const root = await makeGlobalRoot([
      {
        name: "plugin-a",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/a.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: { "hooks/a.mjs": mutatingScript },
      },
      {
        name: "plugin-b",
        hookEvents: {
          PreToolUse: [
            {
              matcher: "Edit",
              hooks: [
                {
                  type: "command",
                  command: "node hooks/b.mjs",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
        hookScripts: { "hooks/b.mjs": mutatingScript },
      },
    ]);
    const data = await new Snapshot({
      globalRoot: root,
      pathOverride: "",
    }).capture();
    const collisions = await new HookMatcherDetector().analyze(data);
    expect(collisions).toEqual([]);
  });
});
