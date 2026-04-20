import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Scanner } from "../../src/scanner.js";
import { Snapshot } from "../../src/snapshot.js";
import { makeGlobalRoot, makeTempDir } from "../helpers/fixtures.js";

/**
 * E2E scenario: rtk is installed at ~/.cargo/bin (stub Rust Type Kit) and at
 * /usr/local/bin (real Rust Token Killer). Different binary contents → shadow.
 * The full pipeline (Snapshot → Scanner → Report) must surface a definite
 * path-binary collision listing both absolute paths.
 */
describe("E2E: rtk PATH shadowing (cargo vs local)", () => {
  it("surfaces a definite path-binary Collision naming both rtk locations", async () => {
    const cargoBin = await makeTempDir("e2e-cargo-bin-");
    const localBin = await makeTempDir("e2e-local-bin-");

    // Two different rtk binaries — Rust Type Kit vs Rust Token Killer.
    await fs.writeFile(
      join(cargoBin, "rtk"),
      "#!/bin/sh\n# Rust Type Kit stub\necho 'rtk type kit'\n",
      { mode: 0o755 },
    );
    await fs.writeFile(
      join(localBin, "rtk"),
      "#!/bin/sh\n# Rust Token Killer stub\necho 'rtk token killer'\n",
      { mode: 0o755 },
    );

    const globalRoot = await makeGlobalRoot([]);
    const snapshot = await new Snapshot({
      globalRoot,
      pathOverride: `${cargoBin}:${localBin}`,
    }).capture();

    const report = await new Scanner({ detectorTimeoutMs: 500 }).run(snapshot);
    const pathCollisions = report.collisions.filter(
      (c) => c.category === "path-binary",
    );
    expect(pathCollisions).toHaveLength(1);
    expect(pathCollisions[0].confidence).toBe("definite");
    expect(pathCollisions[0].entities_involved.sort()).toEqual(
      [join(cargoBin, "rtk"), join(localBin, "rtk")].sort(),
    );
    expect(pathCollisions[0].message).toContain("rtk");
  });
});
