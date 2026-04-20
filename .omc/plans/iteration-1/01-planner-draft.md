# claudit v0.1 — Implementation Plan (Iteration 1 Draft)

## 1. PipelineStage Breakdown

### Stage 1: `scaffold`
- Goal: project skeleton (tsconfig, package.json, plugin.json update, marketplace.json, directory layout, .gitignore, CLAUDE.md)
- Effort: S
- /ccg: No
- Exit: npm install + tsc --noEmit pass, directory structure correct

### Stage 2: `detector-interface`
- Goal: common Detector interface, Snapshot type, Collision schema, Report structure
- Deliverables: src/types.ts, src/detector.ts (async analyze signature), src/report.ts, unit tests
- Effort: M
- /ccg: YES — interface signature, Collision schema, Report format (3 schema decisions)
- Exit: types compile, mock detector round-trips

### Stage 3: `snapshot`
- Goal: ~/.claude state capture + diff util + persist/load
- Effort: M
- /ccg: No
- Exit: captures all 6 category sources; diff correct; round-trips to disk

### Stages 4-9: 6 detectors (hook-matcher, slash-command, skill-name, subagent-type, mcp-identifier, path-binary)
- Each: own file in src/detectors/, own test file, content-aware logic
- Efforts: S/M each
- /ccg: No per detector; schema /ccg covers them via Stage 2

### Stage 10: `scanner-orchestrator`
- Goal: wire 6 detectors into Scanner, aggregate Collisions into Report
- Effort: S, /ccg: No

### Stage 11: `hook-post-tool-use-bash`
- Goal: PostToolUse:Bash hook detecting install commands + triggering scan
- Deliverables: src/hooks/post-tool-use-bash.mjs, hooks/hooks.json entry
- Effort: M
- /ccg: YES — install regex initial set + hook timing
- Exit: matches brew/npm-g/cargo/pip/pipx/uv/curl-pipe/rtk-init/claude-plugin-install; does NOT fire on local npm install

### Stage 12: `hook-session-start`
- Goal: SessionStart hook runs snapshot diff, scans on changes
- Effort: S, /ccg: No
- Exit: injects report when diff shows changes; silent otherwise

### Stage 13: `slash-command-scan`
- Goal: /claudit scan manual trigger skill
- Effort: S, /ccg: No

### Stage 14: `verify-harness`
- Goal: test harness covering 3 ralph-verify criteria + 3 E2E scenarios
- Effort: L, /ccg: No
- 3 E2E: rtk-type-kit PATH shadowing, duplicate /scan slash command, two hooks mutating PreToolUse:Bash updatedInput

### Stage 15: `marketplace-registration`
- Goal: marketplace.json finalized, dist/ builds, minimal README, /plugin install testable
- Effort: S, /ccg: No

## 2. RALPLAN-DR Summary

**Principles (5):**
1. claudit never mutates user config directly
2. Each detector = pluggable module on common interface
3. v0.1 ships all 6 categories content-aware (no descoping)
4. OMC-independent
5. Hook latency bounded: <200ms PostToolUse:Bash, <500ms SessionStart

**Decision Drivers (3):**
1. Claude-parsability of reports
2. Plugin ecosystem conventions
3. Content-aware detection fidelity (low false positive)

**Viable Options — Report Format:**
- A) JSON (machine-parsable, schema-validatable)
- B) Markdown-sectioned (human-readable, Claude parses natively, fragile if content has headers)
- C) XML-tagged (Claude handles well, verbose, not idiomatic)
- Recommendation: JSON with XML wrapper for system-reminder injection. /ccg required.

**Single-option invalidation:** async Detector interface is mandatory.

## 3. Resolved Open Questions

1. Distribution: plugin marketplace only (v0.1).
2. OS: macOS + Linux.
3. Performance: <200ms PostToolUse:Bash, <500ms SessionStart.
4. Report format: JSON w/ XML wrapper `<claudit-report>JSON</claudit-report>`. /ccg required.
5. Detector signature: `analyze(current, previous?): Promise<Collision[]>`, per-detector error isolation. /ccg required.
6. Snapshot location: `~/.claude/claudit/snapshots/`, keep last 2.
7. Install regex (10 patterns). /ccg required.

## 4. ralph-verify Plan

- install: validate plugin.json, hooks.json schema, hook script files executable, simulate hook exec mock stdin, manual /plugin install step.
- namespace: enumerate claudit IDs (plugin name, /claudit scan, skill "scan", matchers). Read ~/.claude/plugins/ IDs. Assert no overlap.
- idempotency: run setup 2x, hooks.json has exactly 2 entries, no duplicate snapshots, plugin.json unchanged.

E2E: rtk+OMC PATH shadowing; duplicate /scan across plugins; two hooks mutating PreToolUse:Bash input.
