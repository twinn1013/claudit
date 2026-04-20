import type { Collision, ReportData, ReportMetadata } from "./types.js";

const REPORT_OPEN = "<claudit-report>";
const REPORT_CLOSE = "</claudit-report>";
const REPORT_RE = /<claudit-report>([\s\S]*?)<\/claudit-report>/;

/**
 * A claudit report — the JSON payload Claude consumes via `additionalContext`.
 * Serialized as a single-line JSON blob wrapped in `<claudit-report>` tags so
 * it can be extracted even if surrounding text is present.
 */
export class Report {
  constructor(public readonly data: ReportData) {}

  static fromCollisions(
    collisions: Collision[],
    meta: Partial<ReportMetadata> = {},
  ): Report {
    const now = new Date().toISOString();
    const errorCount =
      meta.error_count ??
      collisions.filter((c) => c.category === "internal-error").length;
    return new Report({
      collisions,
      metadata: {
        timestamp: meta.timestamp ?? now,
        scan_duration_ms: meta.scan_duration_ms ?? 0,
        detector_count: meta.detector_count ?? 0,
        error_count: errorCount,
      },
    });
  }

  get collisions(): Collision[] {
    return this.data.collisions;
  }

  get metadata(): ReportMetadata {
    return this.data.metadata;
  }

  serialize(): string {
    return `${REPORT_OPEN}${JSON.stringify(this.data)}${REPORT_CLOSE}`;
  }

  /** Extract the first `<claudit-report>` block from a wrapped string. */
  static parse(wrapped: string): Report {
    const match = REPORT_RE.exec(wrapped);
    if (!match) {
      throw new Error("Report.parse: no <claudit-report> block found");
    }
    const parsed = JSON.parse(match[1]) as ReportData;
    return new Report(parsed);
  }
}
