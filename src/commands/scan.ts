import { Scanner } from "../scanner.js";
import { Snapshot } from "../snapshot.js";
import type { Report } from "../report.js";

export interface RunScanOptions {
  globalRoot?: string;
  projectRoot?: string;
  storageRoot?: string;
  pathOverride?: string;
  detectorTimeoutMs?: number;
  scannerFactory?: () => Scanner;
}

/**
 * Run the same scan pipeline the SessionStart hook uses, without any
 * pending-marker interaction. Used by the `/claudit scan` command and by
 * tests that want a one-shot report.
 */
export async function runScan(options: RunScanOptions = {}): Promise<Report> {
  const snapshot = new Snapshot({
    globalRoot: options.globalRoot,
    projectRoot: options.projectRoot,
    storageRoot: options.storageRoot,
    pathOverride: options.pathOverride,
  });
  await snapshot.capture();
  const previous = await Snapshot.loadLatest(options.storageRoot).catch(
    () => null,
  );
  const scanner = (options.scannerFactory ??
    (() => new Scanner({ detectorTimeoutMs: options.detectorTimeoutMs })))();
  return await scanner.run(snapshot.data, previous?.data);
}

export async function main(options: RunScanOptions = {}): Promise<void> {
  const report = await runScan(options);
  process.stdout.write(report.serialize() + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`claudit scan failed: ${message}\n`);
    process.exit(1);
  });
}
