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

  it("returns possible when content comparison fails for one of the copies", async () => {
    const dirA = await makeTempDir("unreadable-a-");
    const dirB = await makeTempDir("unreadable-b-");
    await fs.writeFile(join(dirA, "unr"), "a", "utf8");
    await fs.writeFile(join(dirB, "unr"), "a", "utf8");
    const data = await pathSnapshot([dirA, dirB]);
    const detector = new PathBinaryDetector({
      readFile: async (p) => {
        if (p.includes("unreadable-a-")) return Buffer.from("distinct");
        throw new Error("simulated EACCES");
      },
    });
    const collisions = await detector.analyze(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].confidence).toBe("possible");
  });
});
