import type { Detector } from "./detector.js";
import { HookMatcherDetector } from "./detectors/hook-matcher.js";
import { McpIdentifierDetector } from "./detectors/mcp-identifier.js";
import { PathBinaryDetector } from "./detectors/path-binary.js";
import { SkillNameDetector } from "./detectors/skill-name.js";
import { SlashCommandDetector } from "./detectors/slash-command.js";
import { SubagentTypeDetector } from "./detectors/subagent-type.js";
import { DETECTOR_TIMEOUT_MS } from "./policies.js";
import { Report } from "./report.js";
import type { Collision, SnapshotData } from "./types.js";

/** @deprecated use DETECTOR_TIMEOUT_MS from ./policies instead. */
export const DEFAULT_DETECTOR_TIMEOUT_MS = DETECTOR_TIMEOUT_MS;

export interface ScannerOptions {
  detectors?: Detector[];
  /** Per-detector wall-clock budget in ms. Defaults to 100. */
  detectorTimeoutMs?: number;
  /** Wall-clock supplier for tests. */
  now?: () => number;
}

/**
 * Orchestrates the six detectors behind `Promise.allSettled` with a
 * per-detector `AbortSignal.timeout()` budget. One slow or failing detector
 * does not block the rest; its failure is reported as an `internal-error`
 * Collision with `confidence: "unknown"`.
 */
export class Scanner {
  readonly detectors: Detector[];
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: ScannerOptions = {}) {
    this.detectors = options.detectors ?? defaultDetectors();
    this.timeoutMs = options.detectorTimeoutMs ?? DEFAULT_DETECTOR_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async run(current: SnapshotData, previous?: SnapshotData): Promise<Report> {
    const start = this.now();
    const settled = await Promise.allSettled(
      this.detectors.map((d) => this.runOne(d, current, previous)),
    );
    const collisions: Collision[] = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const detector = this.detectors[i];
      if (result.status === "fulfilled") {
        collisions.push(...result.value);
      } else {
        collisions.push(buildErrorCollision(detector, result.reason, this.timeoutMs));
      }
    }
    const duration = this.now() - start;
    const cleaned = sortCollisions(dedupCollisions(collisions));
    return Report.fromCollisions(cleaned, {
      scan_duration_ms: duration,
      detector_count: this.detectors.length,
      error_count: cleaned.filter((c) => c.category === "internal-error").length,
    });
  }

  private async runOne(
    detector: Detector,
    current: SnapshotData,
    previous: SnapshotData | undefined,
  ): Promise<Collision[]> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    return await Promise.race([
      detector.analyze(current, previous, signal),
      this.rejectOnAbort(signal, detector),
    ]);
  }

  private rejectOnAbort(
    signal: AbortSignal,
    detector: Detector,
  ): Promise<never> {
    return new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(new DetectorTimeoutError(detector.category, this.timeoutMs));
        return;
      }
      signal.addEventListener(
        "abort",
        () =>
          reject(new DetectorTimeoutError(detector.category, this.timeoutMs)),
        { once: true },
      );
    });
  }
}

export function defaultDetectors(): Detector[] {
  return [
    new HookMatcherDetector(),
    new SlashCommandDetector(),
    new SkillNameDetector(),
    new SubagentTypeDetector(),
    new McpIdentifierDetector(),
    new PathBinaryDetector(),
  ];
}

export class DetectorTimeoutError extends Error {
  constructor(
    readonly detector: string,
    readonly timeoutMs: number,
  ) {
    super(`${detector} detector exceeded ${timeoutMs}ms timeout`);
    this.name = "DetectorTimeoutError";
  }
}

function buildErrorCollision(
  detector: Detector,
  reason: unknown,
  timeoutMs: number,
): Collision {
  const isTimeout =
    reason instanceof DetectorTimeoutError ||
    (reason instanceof Error && reason.name === "DetectorTimeoutError") ||
    (reason instanceof Error && reason.name === "TimeoutError");
  const message = isTimeout
    ? `${detector.category} detector exceeded ${timeoutMs}ms timeout`
    : `${detector.category} detector threw: ${errorMessage(reason)}`;
  return {
    category: "internal-error",
    severity: "info",
    confidence: "unknown",
    entities_involved: [detector.category],
    suggested_fix: [],
    message,
  };
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function dedupCollisions(list: Collision[]): Collision[] {
  const seen = new Set<string>();
  const out: Collision[] = [];
  for (const c of list) {
    const key = `${c.category}::${[...c.entities_involved].sort().join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

const severityRank: Record<Collision["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
const confidenceRank: Record<Collision["confidence"], number> = {
  definite: 0,
  possible: 1,
  unknown: 2,
};

function sortCollisions(list: Collision[]): Collision[] {
  return [...list].sort((a, b) => {
    const sev = severityRank[a.severity] - severityRank[b.severity];
    if (sev !== 0) return sev;
    const conf = confidenceRank[a.confidence] - confidenceRank[b.confidence];
    if (conf !== 0) return conf;
    return a.category.localeCompare(b.category);
  });
}
