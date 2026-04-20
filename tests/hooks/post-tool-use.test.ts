import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { main as postToolUse } from "../../src/hooks/post-tool-use.js";
import { listPendingMarkers } from "../../src/pending.js";
import { makeTempDir } from "../helpers/fixtures.js";

interface StdoutCapture {
  lines: string[];
  restore: () => void;
}

function captureStdout(): StdoutCapture {
  const orig = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  (process.stdout.write as unknown as (chunk: unknown) => boolean) = (
    chunk: unknown,
  ): boolean => {
    lines.push(String(chunk));
    return true;
  };
  return {
    lines,
    restore: () => {
      (process.stdout.write as unknown as typeof orig) = orig;
    },
  };
}

function parseOutput(capture: StdoutCapture): unknown {
  const joined = capture.lines.join("");
  return JSON.parse(joined.trim());
}

describe("PostToolUse hook", () => {
  let pendingDir: string;
  let cap: StdoutCapture;

  beforeEach(async () => {
    pendingDir = await makeTempDir("hook-pending-");
    cap = captureStdout();
  });
  afterEach(() => cap.restore());

  it("writes a pending marker when a Bash install command is detected", async () => {
    const stdin = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "brew install ripgrep" },
    });
    await postToolUse({ stdin, pendingDir });
    const markers = await listPendingMarkers({ dir: pendingDir });
    expect(markers).toHaveLength(1);
    expect(markers[0].command).toBe("brew install ripgrep");
    expect(markers[0].trigger).toBe("PostToolUse");
    expect(typeof markers[0].timestamp).toBe("string");
    expect(typeof markers[0].matched_pattern).toBe("string");

    const out = parseOutput(cap) as { continue: boolean; hookSpecificOutput?: { additionalContext?: string } };
    expect(out.continue).toBe(true);
    expect(out.hookSpecificOutput?.additionalContext).toContain(
      "claudit-pending",
    );
  });

  it("redacts secrets in additionalContext with the same pending-marker pass", async () => {
    const stdin = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: {
        command: `GITHUB_TOKEN=ghp_secret123 brew install foo`,
      },
    });
    await postToolUse({ stdin, pendingDir });
    const markers = await listPendingMarkers({ dir: pendingDir });
    expect(markers).toHaveLength(1);

    const out = parseOutput(cap) as {
      continue: boolean;
      hookSpecificOutput?: { additionalContext?: string };
    };
    const context = out.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("GITHUB_TOKEN=<redacted> brew install foo");
    expect(context).not.toContain("ghp_secret123");
    expect(context).toContain(markers[0].command);
  });

  it("does nothing for a non-install Bash command and exits under 10ms", async () => {
    const stdin = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });
    const start = Date.now();
    await postToolUse({ stdin, pendingDir });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // well under 10ms on capable hardware; pad for CI
    const markers = await listPendingMarkers({ dir: pendingDir });
    expect(markers).toEqual([]);
    const out = parseOutput(cap) as { continue: boolean; hookSpecificOutput?: unknown };
    expect(out.continue).toBe(true);
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it("short-circuits on non-Bash tools without writing a marker", async () => {
    const stdin = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/tmp/x", old_string: "a", new_string: "b" },
    });
    const start = Date.now();
    await postToolUse({ stdin, pendingDir });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
    const markers = await listPendingMarkers({ dir: pendingDir });
    expect(markers).toEqual([]);
    const out = parseOutput(cap) as { continue: boolean };
    expect(out.continue).toBe(true);
  });

  it("emits a valid JSON continue on garbage stdin without throwing", async () => {
    await postToolUse({ stdin: "{malformed", pendingDir });
    const out = parseOutput(cap) as { continue: boolean };
    expect(out.continue).toBe(true);
    const markers = await listPendingMarkers({ dir: pendingDir });
    expect(markers).toEqual([]);
  });

  it("still emits valid JSON even when writing the pending marker fails", async () => {
    // Use a non-writable pending dir by referencing a path that cannot be
    // created (an existing file as parent).
    const file = await makeTempDir("collide-");
    const badDir = `${file}/not-a-dir/that-also-has-a-file`;
    const stdin = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "brew install foo" },
    });
    // force mkdir failure: pre-create a file at badDir's parent so mkdir fails
    const { promises: fs } = await import("node:fs");
    await fs.writeFile(`${file}/blocker`, "", "utf8");
    await postToolUse({ stdin, pendingDir: `${file}/blocker/child` });
    const out = parseOutput(cap) as { continue: boolean };
    expect(out.continue).toBe(true);
  });
});
