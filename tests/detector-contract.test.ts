import { describe, expect, it } from "vitest";
import type { Detector } from "../src/detector.js";
import type { Collision, SnapshotData } from "../src/types.js";

/**
 * This test is a compile-time contract check dressed up as a runtime test.
 * If someone changes the Detector interface in an incompatible way (e.g.
 * removes the `category` field or changes `analyze` to sync), this file
 * stops type-checking.
 */

class MockDetector implements Detector {
  readonly category = "slash-command" as const;
  async analyze(
    _current: SnapshotData,
    _previous?: SnapshotData,
  ): Promise<Collision[]> {
    return [];
  }
}

const emptySnapshot: SnapshotData = {
  globalRoot: "/tmp/fake",
  plugins: [],
  settingsMcpServers: [],
  pathBinaries: {},
  capturedAt: "2026-04-20T00:00:00.000Z",
  fingerprint: "empty",
};

describe("Detector interface contract", () => {
  it("mock detector conforms to Detector and returns Promise<Collision[]>", async () => {
    const detector: Detector = new MockDetector();
    const result = detector.analyze(emptySnapshot);
    expect(result).toBeInstanceOf(Promise);
    const collisions = await result;
    expect(Array.isArray(collisions)).toBe(true);
    expect(detector.category).toBe("slash-command");
  });

  it("detector receives previous snapshot as optional argument", async () => {
    const detector: Detector = new MockDetector();
    await expect(
      detector.analyze(emptySnapshot, emptySnapshot),
    ).resolves.toEqual([]);
    await expect(detector.analyze(emptySnapshot)).resolves.toEqual([]);
  });
});
