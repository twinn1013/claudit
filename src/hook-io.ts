import type { HookOutput, PostToolUseStdin } from "./types.js";
import { Report } from "./report.js";

/** Parsed result from a PostToolUse hook's stdin payload. */
export interface ParsedPostToolUse {
  toolName?: string;
  command?: string;
  raw: PostToolUseStdin;
}

/**
 * Parse the JSON stdin delivered by Claude Code to a PostToolUse hook.
 * Missing fields are tolerated — callers decide whether to short-circuit.
 *
 * Throws if the input is not valid JSON.
 */
export function parsePostToolUseStdin(input: string): ParsedPostToolUse {
  const trimmed = input.trim();
  const parsed = (trimmed ? JSON.parse(trimmed) : {}) as PostToolUseStdin;
  const rawCommand = parsed.tool_input?.command;
  return {
    toolName: parsed.tool_name,
    command: typeof rawCommand === "string" ? rawCommand : undefined,
    raw: parsed,
  };
}

export interface BuildHookOutputOptions {
  hookEventName: string;
  /** Report whose serialization becomes `additionalContext`. */
  report?: Report;
  /** Raw string used instead of a Report (already XML-wrapped). */
  additionalContext?: string;
  /** Defaults to `true`. */
  continue?: boolean;
  suppressOutput?: boolean;
}

/**
 * Build the JSON object a hook prints to stdout, following CC convention:
 *
 *   { "continue": true,
 *     "hookSpecificOutput": {
 *       "hookEventName": "...",
 *       "additionalContext": "<claudit-report>{ ... }</claudit-report>"
 *     } }
 */
export function buildHookOutput(options: BuildHookOutputOptions): HookOutput {
  const output: HookOutput = { continue: options.continue ?? true };
  if (options.suppressOutput !== undefined) {
    output.suppressOutput = options.suppressOutput;
  }
  const ctx = options.additionalContext ?? options.report?.serialize();
  if (ctx !== undefined) {
    output.hookSpecificOutput = {
      hookEventName: options.hookEventName,
      additionalContext: ctx,
    };
  }
  return output;
}

/** Read all of stdin as UTF-8. Used from compiled hook entry points. */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer),
    );
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Stringify a HookOutput as a single line on stdout (the CC expected shape). */
export function writeHookOutput(output: HookOutput): void {
  process.stdout.write(JSON.stringify(output) + "\n");
}
