import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { main, runScan } from "../../src/commands/scan.js";
import { Report } from "../../src/report.js";
import { makeGlobalRoot, makeTempDir } from "../helpers/fixtures.js";

const execFileAsync = promisify(execFile);

describe("/claudit scan command", () => {
  it("runScan() returns a Report whose collisions match SessionStart output for the same snapshot", async () => {
    const globalRoot = await makeGlobalRoot([
      { name: "plugin-a", commands: ["scan.md"] },
      { name: "plugin-b", commands: ["scan.md"] }, // duplicate
    ]);
    const storageRoot = await makeTempDir("cli-store-");
    const report = await runScan({
      globalRoot,
      storageRoot,
      pathOverride: "",
    });
    expect(report).toBeInstanceOf(Report);
    const categories = report.collisions.map((c) => c.category);
    expect(categories).toContain("slash-command");
    expect(report.metadata.detector_count).toBe(6);
  });

  it("main() prints a single XML-wrapped report to stdout", async () => {
    const globalRoot = await makeGlobalRoot([
      { name: "plugin-a", commands: ["scan.md"] },
    ]);
    const storageRoot = await makeTempDir("cli-store-");
    const orig = process.stdout.write.bind(process.stdout);
    const lines: string[] = [];
    (process.stdout.write as unknown as (chunk: unknown) => boolean) = (
      chunk: unknown,
    ): boolean => {
      lines.push(String(chunk));
      return true;
    };
    try {
      await main({ globalRoot, storageRoot, pathOverride: "" });
    } finally {
      (process.stdout.write as unknown as typeof orig) = orig;
    }
    const combined = lines.join("");
    expect(combined).toContain("<claudit-report>");
    expect(combined).toContain("</claudit-report>");
    const parsed = Report.parse(combined);
    expect(parsed.metadata.detector_count).toBe(6);
  });

  it("scan.md command falls back to the cwd plugin root when CLAUDE_PLUGIN_ROOT is unset", async () => {
    const markdown = await fs.readFile("commands/scan.md", "utf8");
    const shell = markdown.match(/```bash\n([\s\S]*?)```/)?.[1];
    expect(shell).toBeTruthy();

    const { stdout } = await execFileAsync(
      "/bin/bash",
      ["-lc", shell!],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: "",
        },
        maxBuffer: 1024 * 1024 * 2,
      },
    );

    expect(stdout).toContain("<claudit-report>");
    expect(stdout).toContain("</claudit-report>");
  });
});
