# claudit — Project Conventions

**What it is:** A Claude Code plugin that detects configuration conflicts (hooks, commands, skills, agents, MCP servers, PATH binaries) and emits Claude-parsable reports.

## Architecture

- Trigger-and-defer: `PostToolUse:Bash` hook does lightweight regex matching and writes a pending marker. `SessionStart` consumes markers + snapshot diff, then runs the full scanner.
- 6 detectors behind a common async `Detector` interface, executed via `Promise.allSettled` with a 100ms per-detector timeout.
- Read-only observer — claudit never mutates user config.

## Snapshot contracts

- `HookScript.kind` is a discriminator: `command | prompt | agent | http | unknown`.
- `HookSource` has 7 values:
  - `plugin-cache`
  - `plugin-marketplace`
  - `user-settings`
  - `user-settings-local`
  - `project-settings`
  - `project-settings-local`
  - `user-managed`
- Plugin identity may be marketplace-qualified (`plugin@marketplace`) when claudit needs a unique internal origin for enablement or collision reporting.

## Redaction policy

- Install-command redaction is shared through the pending-marker flow.
- The same redaction pass is applied to:
  - pending markers written to disk
  - hook `additionalContext` emitted back to Claude
- Report payloads themselves are wrapped as base64 JSON inside `<claudit-report>...</claudit-report>`.

## Layout

- `.claude-plugin/plugin.json` — plugin metadata (name, commands array with string paths)
- `.claude-plugin/marketplace.json` — marketplace metadata
- `hooks/hooks.json` — CC-auto-discovered hook registration
- `commands/*.md` — slash command definitions
- `src/` — TypeScript source (scanner, detector interface, 6 detectors, snapshot, report, hook I/O, hooks, pending, plugin identity, policies)
- `dist/` — tsup-compiled `.mjs` output (build artifact, gitignored)
- `tests/` — vitest unit + e2e + verification tests

## Scripts

- `npm run build` — tsup build to `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest run
- `npx tsup` — equivalent direct build command
- `npx vitest run` — equivalent direct test command

## Conventions

- Node 20+, TypeScript 5+, ESM only (`"type": "module"`, `.mjs` output).
- Hook stdout shape: `{ "continue": true, "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }`.
- Report serialized as base64 JSON wrapped in `<claudit-report>...</claudit-report>` placed inside `additionalContext`.
- PostToolUse matcher: `"*"` (filtering to Bash done internally via stdin `tool_name` check).
- `Collision.confidence: 'definite' | 'possible' | 'unknown'`.
- Commit messages: `[stage-token] <summary>`. No AI attribution.
