import {
  buildHookOutput,
  readStdin,
  writeHookOutput,
} from "../hook-io.js";
import { Scanner } from "../scanner.js";
import { Snapshot, defaultSnapshotStorage } from "../snapshot.js";
import {
  defaultPendingDir,
  deletePendingMarker,
  listPendingMarkers,
} from "../pending.js";

const HOOK_EVENT_NAME = "SessionStart";

export interface SessionStartArgs {
  stdin?: string;
  globalRoot?: string;
  projectRoot?: string;
  storageRoot?: string;
  pendingDir?: string;
  /** Override PATH scanning; defaults to `process.env.PATH`. Pass "" to skip. */
  pathOverride?: string;
  /** Detector timeout override; forwarded to Scanner. */
  detectorTimeoutMs?: number;
  /** Scanner override for tests. */
  scannerFactory?: () => Scanner;
}

/**
 * SessionStart hook. Reads pending markers dropped by the PostToolUse trigger,
 * captures a fresh snapshot, diffs against the last saved one, and runs the
 * full scanner only when something is worth scanning. When nothing changed,
 * the hook returns `{continue: true}` without an `additionalContext` to keep
 * the cold-path budget tight.
 */
export async function main(args: SessionStartArgs = {}): Promise<void> {
  // We don't use stdin content for SessionStart, but CC still sends JSON we
  // must consume and acknowledge.
  if (args.stdin === undefined) {
    await readStdin().catch(() => "");
  }

  const storageRoot = args.storageRoot ?? defaultSnapshotStorage();
  const pendingDir = args.pendingDir ?? defaultPendingDir();

  const pending = await listPendingMarkers({ dir: pendingDir });

  const snapshot = new Snapshot({
    globalRoot: args.globalRoot,
    projectRoot: args.projectRoot,
    pathOverride: args.pathOverride,
    storageRoot,
  });
  try {
    await snapshot.capture();
  } catch {
    writeHookOutput(buildHookOutput({ hookEventName: HOOK_EVENT_NAME }));
    return;
  }

  const previous = await Snapshot.loadLatest(storageRoot).catch(() => null);
  const diff = previous
    ? Snapshot.diff(previous.data, snapshot.data)
    : null;

  const shouldScan = pending.length > 0 || !previous || (diff?.hasChanges ?? false);
  if (!shouldScan) {
    writeHookOutput(buildHookOutput({ hookEventName: HOOK_EVENT_NAME }));
    return;
  }

  const scanner = (args.scannerFactory ?? (() => new Scanner({ detectorTimeoutMs: args.detectorTimeoutMs })))();
  let scanSucceeded = false;
  try {
    const report = await scanner.run(snapshot.data, previous?.data);
    writeHookOutput(
      buildHookOutput({ hookEventName: HOOK_EVENT_NAME, report }),
    );
    scanSucceeded = true;
  } catch {
    // Scanner errors are internal-error Collisions, so a thrown error here
    // is unusual — still emit a safe continue.
    writeHookOutput(buildHookOutput({ hookEventName: HOOK_EVENT_NAME }));
  }

  if (scanSucceeded) {
    try {
      await snapshot.save();
    } catch {
      // do not fail the hook on storage issues
    }
    await Promise.all(
      pending.map((m) => deletePendingMarker(m.path).catch(() => false)),
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({ continue: true }) + "\n");
  });
}
