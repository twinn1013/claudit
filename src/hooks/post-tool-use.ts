import {
  buildHookOutput,
  parsePostToolUseStdin,
  readStdin,
  writeHookOutput,
} from "../hook-io.js";
import {
  matchInstallPattern,
  redactPendingCommand,
  writePendingMarker,
} from "../pending.js";

const HOOK_EVENT_NAME = "PostToolUse";

/**
 * PostToolUse trigger hook. Does the bare minimum so the hook stays well
 * under its latency budget: parse stdin, filter for Bash, regex-match the
 * command, and on match, write a single pending marker file. All scanning
 * work is deferred to the SessionStart hook.
 */
export async function main(
  args: {
    stdin?: string;
    pendingDir?: string;
    now?: () => string;
  } = {},
): Promise<void> {
  const stdin = args.stdin ?? (await readStdin());
  let parsed;
  try {
    parsed = parsePostToolUseStdin(stdin);
  } catch {
    writeHookOutput(buildHookOutput({ hookEventName: HOOK_EVENT_NAME }));
    return;
  }

  if (parsed.toolName !== "Bash" || !parsed.command) {
    writeHookOutput(buildHookOutput({ hookEventName: HOOK_EVENT_NAME }));
    return;
  }

  const match = matchInstallPattern(parsed.command);
  if (!match) {
    writeHookOutput(buildHookOutput({ hookEventName: HOOK_EVENT_NAME }));
    return;
  }

  const timestamp = (args.now ?? (() => new Date().toISOString()))();
  const redactedCommand = redactPendingCommand(parsed.command);
  try {
    await writePendingMarker({
      dir: args.pendingDir,
      marker: {
        timestamp,
        trigger: "PostToolUse",
        command: parsed.command,
        matched_pattern: match.pattern,
      },
    });
  } catch {
    // swallow: the hook must not fail the tool that triggered it.
  }

  writeHookOutput(
    buildHookOutput({
      hookEventName: HOOK_EVENT_NAME,
      additionalContext: `<claudit-pending>install detected: ${redactedCommand}</claudit-pending>`,
    }),
  );
}

// Only run main() if this module is the entry point. Vitest imports this
// module under `node:vitest` so `import.meta.url !== argv[1]`, and we
// want tests to be able to import `main` without side effects.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    // Fallback: make sure CC still gets a valid continue signal.
    process.stdout.write(JSON.stringify({ continue: true }) + "\n");
  });
}
