import type { Collision, CollisionCategory, SnapshotData } from "./types.js";

/**
 * Every detector module implements this interface. The Scanner runs all
 * detectors in parallel via `Promise.allSettled` with a per-detector timeout.
 *
 * Implementations MUST:
 *  - be stateless across calls (Scanner may invoke `analyze` multiple times),
 *  - never throw synchronously (always return a rejected Promise or empty array),
 *  - return `[]` when no collisions are detected (rather than `null`/`undefined`),
 *  - set `confidence: "unknown"` and `category: "internal-error"` on soft failures
 *    the detector itself can represent, rather than throwing.
 */
export interface Detector {
  readonly category: CollisionCategory;
  analyze(
    current: SnapshotData,
    previous?: SnapshotData,
    signal?: AbortSignal,
  ): Promise<Collision[]>;
}
