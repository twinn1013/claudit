import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INSTALL_PATTERNS,
  deletePendingMarker,
  listPendingMarkers,
  matchInstallPattern,
  writePendingMarker,
} from "../src/pending.js";
import { makeTempDir } from "./helpers/fixtures.js";

describe("matchInstallPattern", () => {
  const positive: Array<[string, string]> = [
    ["brew install ripgrep", "brew"],
    ["npm install -g typescript", "npm -g"],
    ["npm i -g tsup", "npm i -g"],
    ["cargo install claudit", "cargo"],
    ["pip install requests", "pip"],
    ["pip3 install numpy", "pip3"],
    ["pipx install ruff", "pipx"],
    ["uv add httpx", "uv add"],
    ["uv tool install black", "uv tool install"],
    ["curl -sSL https://example.com/install.sh | sh", "curl|sh"],
    ["wget -qO- https://example.com/install.sh | bash", "wget|bash"],
    ["rtk init", "rtk init"],
    ["claude plugin install foo", "claude plugin install"],
    ["claude mcp add server", "claude mcp add"],
    ["go install github.com/x/y@latest", "go install"],
  ];
  it.each(positive)("matches %s", (command) => {
    expect(matchInstallPattern(command)).not.toBeNull();
  });

  const negative = [
    "npm install",               // no -g flag
    "npm install --save-dev foo", // no -g
    "ls -la",
    "echo npm install -g foo",   // inside echo — still matches 'npm install -g'
  ];
  it("does not match npm install without -g", () => {
    expect(matchInstallPattern("npm install")).toBeNull();
    expect(matchInstallPattern("npm install --save-dev foo")).toBeNull();
  });
  it("does not match plain shell commands", () => {
    expect(matchInstallPattern("ls -la")).toBeNull();
    expect(matchInstallPattern("cd ~/proj && ls")).toBeNull();
    expect(matchInstallPattern("git status")).toBeNull();
  });

  it("exports exactly 10 regex patterns", () => {
    expect(INSTALL_PATTERNS.length).toBe(10);
  });
});

describe("writePendingMarker / listPendingMarkers / deletePendingMarker", () => {
  it("writes a marker atomically and round-trips it through the listing", async () => {
    const dir = await makeTempDir("pending-");
    const path = await writePendingMarker({
      dir,
      marker: {
        timestamp: "2026-04-20T12:00:00.000Z",
        trigger: "PostToolUse",
        command: "brew install foo",
        matched_pattern: "brew install\\s+\\S",
      },
    });
    expect(path).toContain(dir);
    expect(path.endsWith(".json")).toBe(true);
    const list = await listPendingMarkers({ dir });
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe("brew install foo");
    expect(list[0].timestamp).toBe("2026-04-20T12:00:00.000Z");
  });

  it("creates unique filenames for parallel writes with identical timestamps", async () => {
    const dir = await makeTempDir("parallel-");
    const marker = {
      timestamp: "2026-04-20T12:00:00.000Z",
      trigger: "PostToolUse" as const,
      command: "brew install foo",
      matched_pattern: "brew",
    };
    const results = await Promise.all([
      writePendingMarker({ dir, marker }),
      writePendingMarker({ dir, marker }),
      writePendingMarker({ dir, marker }),
    ]);
    expect(new Set(results).size).toBe(3);
    const list = await listPendingMarkers({ dir });
    expect(list).toHaveLength(3);
  });

  it("skips .tmp files in listings (in-flight writes)", async () => {
    const dir = await makeTempDir("tmp-");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/half.json.tmp`, '{"incomplete":', "utf8");
    const list = await listPendingMarkers({ dir });
    expect(list).toEqual([]);
  });

  it("deletePendingMarker removes the file and returns true, then false on missing", async () => {
    const dir = await makeTempDir("delete-");
    const path = await writePendingMarker({
      dir,
      marker: {
        timestamp: "2026-04-20T12:00:00.000Z",
        trigger: "PostToolUse",
        command: "brew install foo",
        matched_pattern: "brew",
      },
    });
    expect(await deletePendingMarker(path)).toBe(true);
    expect(await deletePendingMarker(path)).toBe(false);
  });

  it("returns [] when the pending directory does not exist", async () => {
    const dir = `/tmp/claudit-never-exists-${Date.now()}-${Math.random()}`;
    const list = await listPendingMarkers({ dir });
    expect(list).toEqual([]);
  });

  it("redacts secrets in command before writing to disk", async () => {
    const dir = await makeTempDir("redact-");
    await writePendingMarker({
      dir,
      marker: {
        timestamp: "2026-04-20T12:00:00.000Z",
        trigger: "PostToolUse",
        command: "GITHUB_TOKEN=abc123 brew install foo",
        matched_pattern: "brew install\\s+\\S",
      },
    });
    const list = await listPendingMarkers({ dir });
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe("GITHUB_TOKEN=<redacted> brew install foo");
    expect(list[0].command).not.toContain("abc123");
  });

  it("redaction is a no-op for commands without secret patterns", async () => {
    const dir = await makeTempDir("redact-noop-");
    await writePendingMarker({
      dir,
      marker: {
        timestamp: "2026-04-20T12:00:00.000Z",
        trigger: "PostToolUse",
        command: "brew install ripgrep",
        matched_pattern: "brew install\\s+\\S",
      },
    });
    const list = await listPendingMarkers({ dir });
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe("brew install ripgrep");
  });
});
