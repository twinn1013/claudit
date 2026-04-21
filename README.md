# claudit

Claude Code plugin that detects configuration conflicts across installed plugins, hooks, slash commands, skills, subagents, MCP servers, and PATH binaries — then emits a Claude-parsable report so the assistant can explain the problem and propose fixes.

## What it is (and is not)

- ✅ **Static analyzer**. Reads hooks, manifests, and binaries at rest and produces structured reports.
- ✅ **Observer, not gatekeeper**. Never mutates user config; never blocks installs.
- ✅ **Content-aware**. Distinguishes “same matcher with multiple hooks” (fine) from “two hooks mutating `updatedInput` on the same matcher” (collision).
- ❌ Not a hook interceptor. Doesn't watch runtime execution chains.
- ❌ Not a daemon. No background process; hooks fire on PostToolUse and SessionStart.

## Install

These instructions target **claudit v0.2.1**.

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

## Hook + snapshot scope in v0.2

v0.2 preserves seven `HookSource` values:

- `plugin-cache`
- `plugin-marketplace`
- `user-settings`
- `user-settings-local`
- `project-settings`
- `project-settings-local`
- `user-managed`

`HookScript.kind` is also preserved as a discriminator:

- `command`
- `prompt`
- `agent`
- `http`
- `unknown`

That allows claudit to treat statically analyzable command hooks differently from non-command registrations that should remain `possible` / `unknown`.

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
                    │   )  — 500ms default per-detector timeout
                    │
                    ▼
                   Report
                    │
                    ▼
         hookSpecificOutput.additionalContext:
           <claudit-report>BASE64(JSON)</claudit-report>
                    │
                    ▼
              Claude explains → user approves → Claude executes fix
```

## The 6 detectors

| Category | What it flags | Confidence |
|----------|---------------|------------|
| `hook-matcher` | Two hooks on the same event+matcher both mutating `updatedInput` | definite / possible / unknown |
| `slash-command` | Two plugins register the same command base name | possible |
| `skill-name` | Two plugins define the same skill; or trigger keywords overlap | possible |
| `subagent-type` | Two plugins define the same `subagent_type` | possible |
| `mcp-identifier` | Two sources register the same MCP server, or expose the same tool name | definite / possible |
| `path-binary` | Same binary name at multiple `$PATH` locations with distinct content | definite / possible |

Internal errors (detector timeout / throw) surface as `category: "internal-error"` with `confidence: "unknown"`.

## How it was built

v0.2.1 is the first patch release after real-environment validation. It specifically fixed three issues surfaced by live smoke testing: slash-command bootstrap without `CLAUDE_PLUGIN_ROOT`, same-plugin self-overlap hook noise, and `path-binary` detector timeouts on long `$PATH` environments.


v0.2 was rebuilt under a **five-way review lane**:

- `architect`
- `security-reviewer`
- `code-reviewer`
- external Claude review
- external Gemini review

One concrete outcome of that review stack: the Phase 4 `code-reviewer` lane (Erdos) caught a marketplace-qualified plugin identity bug after Stage 8. That review directly led to `[v2-plugin-identity-fix]`, which centralized plugin identity handling and stopped `foo@alpha` / `foo@beta` from collapsing into one enablement decision.

The rebuild also locked the project's flagship proof-case into the suite: claudit now detects the real **rtk + OMC** PreToolUse overlap scenario end-to-end through `Snapshot -> Scanner -> Report`, instead of only through direct detector fixtures.

## Limitations (v0.2.1)

claudit is a static analyzer. It does **not**:

- Execute hook scripts or observe runtime behaviour
- Intercept or serialize live hook execution chains
- Access CC's internal plugin resolution / priority logic
- Track post-install config mutations (e.g., lazy skill registration)
- Fully parse arbitrary YAML or regex-heavy matcher syntax outside the supported subset

These blind spots can produce **false negatives**. The `confidence` field on every Collision signals certainty:

- `definite` — static evidence is strong enough to claim the conflict
- `possible` — claudit sees a real risk, but runtime behaviour still needs confirmation
- `unknown` — overlapping or unresolved conditions exist, but static analysis could not prove mutation

Treat `possible` and `unknown` as requiring manual verification.

### False-positive policy

“Same matcher with multiple hooks” is not a collision by itself. v0.2.1 additionally filters same-owner hook registrations so one plugin's own hook bundle is not reported as a conflict. v0.2.1 reports:

- `critical/definite` only for proven mutual mutation
- `warning/possible` when a disabled-plugin or mixed mutating/opaque case can plausibly interfere
- `info/unknown` when overlapping hooks exist but both sides remain statically opaque

Benign system-binary duplicates (`ls`, `cat`, `bash`, …) are allowlisted.

### False-negative policy

Runtime-dependent behaviour (hook execution ordering, dynamic variable expansion, CC's merge/de-dup logic) cannot be statically inferred. v0.2.1 expands env-var and script-path handling compared with v0.1, but still uses heuristic static analysis rather than runtime interception. Detector time budgets are also policy-based rather than workload-adaptive, so unusually large environments may still need manual tuning via `CLAUDIT_DETECTOR_TIMEOUT_MS`. See `src/policies.ts` for the full list.

## Scan output shape

Reports are wrapped in `<claudit-report>…</claudit-report>`, where the payload inside the tags is **base64-encoded JSON**:

```jsonc
{
  "collisions": [
    {
      "category": "slash-command",
      "severity": "info",
      "confidence": "possible",
      "entities_involved": ["plugin-a:/scan", "plugin-b:/scan"],
      "suggested_fix": [],
      "message": "Multiple plugins define /scan: plugin-a, plugin-b. Use /plugin-a:scan or /plugin-b:scan to disambiguate."
    }
  ],
  "metadata": {
    "timestamp": "2026-04-21T10:31:00.000Z",
    "scan_duration_ms": 83,
    "detector_count": 6,
    "error_count": 0
  }
}
```

## Development

```sh
npm install
npx tsup                    # same build tool as npm run build
npx vitest run              # same test runner as npm test
npm run typecheck           # tsc --noEmit
npm test                    # vitest run
npm run build               # tsup → dist/**/*.mjs
```

Project layout:

```
.claude-plugin/plugin.json    # metadata + commands array (string paths)
.claude-plugin/marketplace.json
hooks/hooks.json              # PostToolUse + SessionStart registrations (matcher: "*")
commands/scan.md              # /claudit scan prompt
src/
  types.ts                    # Collision, Report, snapshot data contracts
  detector.ts                 # async Detector interface
  detectors/*.ts              # 6 detectors
  snapshot.ts                 # state capture + diff + persist
  scanner.ts                  # allSettled + per-detector timeout orchestrator
  report.ts                   # base64 report wrapper
  pending.ts                  # PostToolUse → SessionStart marker protocol + shared redaction pass
  plugin-identity.ts          # marketplace-qualified plugin identity helpers
  hooks/                      # compiled hook entry points
  commands/                   # /claudit scan CLI entry
  policies.ts                 # detector budgets, namespace severity defaults, redaction policy constants
dist/                         # tsup output — .mjs entry points referenced by hooks.json
tests/
  e2e/                        # real-world scenarios
  ralph-verify-v2.test.ts     # Stage 9 six-criterion verification suite
```

## License

MIT.
