# claudit

Claude Code plugin that detects configuration conflicts across installed plugins, hooks, slash commands, skills, subagents, MCP servers, and PATH binaries — then emits a Claude-parsable report so the assistant can explain the problem and propose fixes.

## What it is (and is not)

- ✅ **Static analyzer**. Reads hooks, manifests, and binaries at rest and produces structured reports.
- ✅ **Observer, not gatekeeper**. Never mutates user config; never blocks installs.
- ✅ **Content-aware**. Distinguishes "same matcher with multiple hooks" (fine) from "two hooks mutating `updatedInput` on the same matcher" (collision).
- ❌ Not a hook interceptor. Doesn't watch runtime execution chains.
- ❌ Not a daemon. No background process; hooks fire on PostToolUse and SessionStart.

## Install

```sh
/plugin install claudit         # from the Claude Code plugin marketplace
```

Or from a local clone:

```sh
git clone https://github.com/twinn1013/claudit.git
cd claudit
npm install
npm run build
/plugin install "$(pwd)"
```

## Usage

On-demand scan:

```
/claudit scan
```

Automatic scan: once installed, the `PostToolUse` hook records install-like Bash commands (brew, npm -g, cargo, pip, pipx, uv, curl|sh, rtk init, claude plugin install, go install), and the `SessionStart` hook runs the full 6-detector scan at the beginning of each session. Claude then walks you through any conflicts.

## Architecture

```
PostToolUse:Bash  ── regex match ──▶  ~/.claude/claudit/pending/*.json
                                                  │
                                                  ▼
SessionStart  ──▶  Snapshot (global + project)
                    │
                    ├─ prev snapshot? ─▶ Snapshot.diff
                    │
                    ▼
                   Scanner
                    │
                    ├─ Promise.allSettled(
                    │     HookMatcherDetector,
                    │     SlashCommandDetector,
                    │     SkillNameDetector,
                    │     SubagentTypeDetector,
                    │     McpIdentifierDetector,
                    │     PathBinaryDetector,
                    │   )  — 100ms per-detector timeout
                    │
                    ▼
                   Report
                    │
                    ▼
         hookSpecificOutput.additionalContext:
           <claudit-report>{...}</claudit-report>
                    │
                    ▼
              Claude explains → user approves → Claude executes fix
```

## The 6 detectors

| Category | What it flags | Confidence |
|----------|---------------|------------|
| `hook-matcher` | Two hooks on the same event+matcher both mutating `updatedInput` | definite / possible |
| `slash-command` | Two plugins register the same command base name | definite |
| `skill-name` | Two plugins define the same skill; or trigger keywords overlap | definite / possible |
| `subagent-type` | Two plugins define the same `subagent_type` | definite |
| `mcp-identifier` | Two sources register the same MCP server, or expose the same tool name | definite / possible |
| `path-binary` | Same binary name at multiple `$PATH` locations with distinct content | definite / possible |

Internal errors (detector timeout / throw) surface as `category: "internal-error"` with `confidence: "unknown"`.

## Limitations

claudit is a static analyzer. It does **not**:

- Execute hook scripts or observe runtime behaviour
- Intercept or serialize live hook execution chains
- Access CC's internal plugin resolution / priority logic
- Track post-install config mutations (e.g., lazy skill registration)

These blind spots can produce **false negatives**. The `confidence` field on every Collision signals certainty; treat `possible` and `unknown` as requiring manual verification.

### False-positive policy

*"Same matcher with multiple hooks"* is not a collision. Only confirmed mutual input mutation is reported. Benign system-binary duplicates (`ls`, `cat`, `bash`, …) are allowlisted.

### False-negative policy

Runtime-dependent behaviour (hook execution ordering, dynamic variable expansion, CC's merge/de-dup logic) cannot be statically inferred. Such cases are typically surfaced as `confidence: "possible"` or missed entirely — see `src/policies.ts` for the full list.

## Scan output shape

Reports are a single line wrapped in `<claudit-report>…</claudit-report>`:

```jsonc
{
  "collisions": [
    {
      "category": "slash-command",
      "severity": "warning",
      "confidence": "definite",
      "entities_involved": ["plugin-a:/scan", "plugin-b:/scan"],
      "suggested_fix": [
        { "command": "/plugin uninstall plugin-b", "scope": "global",
          "safety_level": "destructive", "rationale": "…" }
      ],
      "message": "2 plugins register /scan: plugin-a, plugin-b."
    }
  ],
  "metadata": {
    "timestamp": "2026-04-20T10:31:00.000Z",
    "scan_duration_ms": 83,
    "detector_count": 6,
    "error_count": 0
  }
}
```

## Development

```sh
npm install
npm run typecheck          # tsc --noEmit
npm test                   # vitest run
npm run build              # tsup → dist/**/*.mjs
```

Project layout:

```
.claude-plugin/plugin.json    # metadata + commands array (string paths)
hooks/hooks.json              # PostToolUse + SessionStart registrations (matcher: "*")
commands/scan.md              # /claudit scan prompt
src/
  types.ts                    # Collision, Report, snapshot data contracts
  detector.ts                 # async Detector interface
  detectors/*.ts              # 6 detectors
  snapshot.ts                 # state capture + diff + persist
  scanner.ts                  # allSettled + per-detector timeout orchestrator
  report.ts                   # XML-wrapped JSON report
  pending.ts                  # PostToolUse → SessionStart marker protocol
  hooks/                      # compiled hook entry points
  commands/                   # /claudit scan CLI entry
  policies.ts                 # FALSE_POSITIVE_POLICY, FALSE_NEGATIVE_POLICY, budgets
dist/                         # tsup output — .mjs entry points referenced by hooks.json
tests/
  e2e/                        # 3 real-world scenarios
  ralph-verify.test.ts        # install + namespace + idempotency gates
```

## License

MIT.
