import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PathBinaryDetector } from "../../src/detectors/path-binary.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot, makeTempDir } from "../helpers/fixtures.js";

async function pathSnapshot(pathDirs: string[]) {
  const root = await makeGlobalRoot([]);
  return new Snapshot({
    globalRoot: root,
    pathOverride: pathDirs.join(":"),
  }).capture();
}

describe("PathBinaryDetector", () => {
  it("flags rtk installed at two PATH locations with different content as definite", async () => {
    const dirA = await makeTempDir("bin-a-");
    const dirB = await makeTempDir("bin-b-");
    await fs.writeFile(join(dirA, "rtk"), "#!/bin/sh\necho local\n", "utf8");
    await fs.writeFile(join(dirB, "rtk"), "#!/bin/sh\necho cargo\n", "utf8");
    await fs.chmod(join(dirA, "rtk"), 0o755);
    await fs.chmod(join(dirB, "rtk"), 0o755);

    const data = await pathSnapshot([dirA, dirB]);
    const collisions = await new PathBinaryDetector().analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
    expect(collisions[0].category).toBe("path-binary");
    expect(collisions[0].entities_involved.sort()).toEqual(
      [join(dirA, "rtk"), join(dirB, "rtk")].sort(),
    );
  });

  it("does not flag allowlisted system binaries even if present in multiple dirs", async () => {
    const dirA = await makeTempDir("sys-a-");
    const dirB = await makeTempDir("sys-b-");
    await fs.writeFile(join(dirA, "ls"), "bin-a-contents", "utf8");
    await fs.writeFile(join(dirB, "ls"), "bin-b-contents", "utf8");

    const data = await pathSnapshot([dirA, dirB]);
    const collisions = await new PathBinaryDetector().analyze(data);
    expect(collisions).toEqual([]);
  });

  it("does not flag binaries that appear in only one PATH directory", async () => {
    const dir = await makeTempDir("only-");
    await fs.writeFile(join(dir, "my-tool"), "content", "utf8");
    const data = await pathSnapshot([dir]);
    const collisions = await new PathBinaryDetector().analyze(data);
    expect(collisions).toEqual([]);
  });

  it("does not flag byte-identical duplicates (likely hard links)", async () => {
    const dirA = await makeTempDir("same-a-");
    const dirB = await makeTempDir("same-b-");
    const content = "identical";
    await fs.writeFile(join(dirA, "tool"), content, "utf8");
    await fs.writeFile(join(dirB, "tool"), content, "utf8");
    const data = await pathSnapshot([dirA, dirB]);
    const collisions = await new PathBinaryDetector().analyze(data);
    expect(collisions).toEqual([]);
  });

  it("silently drops unreadable copy — only 1 readable remains → no collision", async () => {
    const dirA = await makeTempDir("unreadable-a-");
    const dirB = await makeTempDir("unreadable-b-");
    await fs.writeFile(join(dirA, "unr"), "a", "utf8");
    await fs.writeFile(join(dirB, "unr"), "a", "utf8");
    await fs.chmod(join(dirA, "unr"), 0o755);
    await fs.chmod(join(dirB, "unr"), 0o755);
    const data = await pathSnapshot([dirA, dirB]);
    const detector = new PathBinaryDetector({
      readFile: async (p) => {
        if (p.includes("unreadable-a-")) return Buffer.from("distinct");
        throw new Error("simulated EACCES");
      },
    });
    // dirB entry is unreadable → filtered; only 1 valid copy remains → no collision
    const collisions = await detector.analyze(data);
    expect(collisions).toEqual([]);
  });

  it("definite collision when 2 readable copies differ and 1 is unreadable", async () => {
    const dirA = await makeTempDir("multi-a-");
    const dirB = await makeTempDir("multi-b-");
    const dirC = await makeTempDir("multi-c-");
    await fs.writeFile(join(dirA, "mtool"), "version-a", "utf8");
    await fs.writeFile(join(dirB, "mtool"), "version-b", "utf8");
    await fs.writeFile(join(dirC, "mtool"), "version-c", "utf8");
    await fs.chmod(join(dirA, "mtool"), 0o755);
    await fs.chmod(join(dirB, "mtool"), 0o755);
    await fs.chmod(join(dirC, "mtool"), 0o755);
    const data = await pathSnapshot([dirA, dirB, dirC]);
    const detector = new PathBinaryDetector({
      readFile: async (p) => {
        if (p.includes("multi-a-")) return Buffer.from("content-x");
        if (p.includes("multi-b-")) return Buffer.from("content-y");
        throw new Error("simulated EACCES");
      },
    });
    // dirC unreadable → filtered; dirA and dirB have different content → definite
    const collisions = await detector.analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("definite");
  });
});
