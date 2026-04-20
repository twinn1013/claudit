import type { Collision, ReportData, ReportMetadata } from "./types.js";

const REPORT_OPEN = "<claudit-report>";
const REPORT_CLOSE = "</claudit-report>";
/** Matches only base64 characters inside the tags, preventing XML-tag injection. */
const REPORT_RE = /<claudit-report>([A-Za-z0-9+/=]+)<\/claudit-report>/;

/**
 * A claudit report — the JSON payload Claude consumes via `additionalContext`.
 * Serialized as a base64-encoded JSON blob wrapped in `<claudit-report>` tags
 * so the payload cannot contain the sentinel string, making extraction safe
 * regardless of what strings appear inside the report data.
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
    const json = JSON.stringify(this.data);
    const b64 = Buffer.from(json).toString("base64");
    return `${REPORT_OPEN}${b64}${REPORT_CLOSE}`;
  }

  /** Extract the first `<claudit-report>` block from a wrapped string and decode it. */
  static parse(wrapped: string): Report {
    const match = REPORT_RE.exec(wrapped);
    if (!match) {
      throw new Error("Report.parse: no <claudit-report> block found");
    }
    const b64 = match[1];
    let json: string;
    try {
      json = Buffer.from(b64, "base64").toString("utf8");
    } catch {
      throw new Error("Report.parse: payload is not valid base64");
    }
    let parsed: ReportData;
    try {
      parsed = JSON.parse(json) as ReportData;
    } catch {
      throw new Error("Report.parse: base64 payload decoded to invalid JSON");
    }
    return new Report(parsed);
  }
}
