import { describe, expect, it } from "vitest";
import {
  buildHookOutput,
  parsePostToolUseStdin,
} from "../src/hook-io.js";
import { Report } from "../src/report.js";
import type { Collision } from "../src/types.js";

describe("parsePostToolUseStdin", () => {
  it("extracts tool_name and command when present", () => {
    const input = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "brew install ripgrep" },
      tool_output: { stdout: "", stderr: "", exit_code: 0 },
    });
    const parsed = parsePostToolUseStdin(input);
    expect(parsed.toolName).toBe("Bash");
    expect(parsed.command).toBe("brew install ripgrep");
  });

  it("returns undefined command when tool is not Bash", () => {
    const input = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/tmp/x", old_string: "a", new_string: "b" },
    });
    const parsed = parsePostToolUseStdin(input);
    expect(parsed.toolName).toBe("Edit");
    expect(parsed.command).toBeUndefined();
  });

  it("handles empty input gracefully", () => {
    const parsed = parsePostToolUseStdin("");
    expect(parsed.toolName).toBeUndefined();
    expect(parsed.command).toBeUndefined();
    expect(parsed.raw).toEqual({});
  });

  it("throws on non-JSON input", () => {
    expect(() => parsePostToolUseStdin("{not json")).toThrow();
  });
});

describe("buildHookOutput", () => {
  const sample: Collision = {
    category: "slash-command",
    severity: "warning",
    confidence: "definite",
    entities_involved: ["a", "b"],
    suggested_fix: [],
    message: "dup",
  };

  it("produces the convention shape with a serialized report", () => {
    const report = Report.fromCollisions([sample]);
    const out = buildHookOutput({
      hookEventName: "PostToolUse",
      report,
    });
    expect(out).toMatchObject({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringContaining("<claudit-report>"),
      },
    });
  });

  it("emits only `{continue: true}` when neither report nor context are given", () => {
    const out = buildHookOutput({ hookEventName: "SessionStart" });
    expect(out).toEqual({ continue: true });
  });

  it("prefers an explicit additionalContext over a report", () => {
    const report = Report.fromCollisions([sample]);
    const out = buildHookOutput({
      hookEventName: "PostToolUse",
      report,
      additionalContext: "<claudit-pending>raw</claudit-pending>",
    });
    expect(out.hookSpecificOutput?.additionalContext).toBe(
      "<claudit-pending>raw</claudit-pending>",
    );
  });

  it("supports continue:false and suppressOutput overrides", () => {
    const out = buildHookOutput({
      hookEventName: "PostToolUse",
      continue: false,
      suppressOutput: true,
    });
    expect(out.continue).toBe(false);
    expect(out.suppressOutput).toBe(true);
  });
});
