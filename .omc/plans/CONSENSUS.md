# Ralplan Consensus — 2026-04-20

**Status:** APPROVED on iteration 2 of 3 max.

## Pipeline
- Deep Interview: 6 rounds, final ambiguity 19.5% (passed 20% threshold)
- Spec: `.omc/specs/deep-interview-claudit.md`
- Ralplan iteration 1: Planner → Architect (APPROVE_WITH_CONCERNS, 8 revisions) → Critic (ITERATE, 1 CRITICAL + 5 MAJOR + 8 required revisions)
- Ralplan iteration 2: Planner (revised) → Architect (APPROVE) → Critic (APPROVE)

## Final Plan
**Primary artifact:** `.omc/plans/iteration-2/01-planner-revised.md` (625 lines, 16 stages)

## Consensus Decisions
- Node.js + TypeScript, tsup build, .mjs hooks
- 16-stage pipeline with stage-prefix commits + push
- Trigger+defer hook architecture: PostToolUse matches install regex → pending marker → SessionStart consumes + scans
- 6 detectors via Promise.allSettled + 100ms per-detector timeout + AbortController
- Collision schema with `confidence: 'definite' | 'possible' | 'unknown'`
- Snapshot scope: `~/.claude/` (global) + project `.claude/` (when present)
- Hook stdout: ecosystem convention `{continue, hookSpecificOutput:{hookEventName, additionalContext}}` with claudit report XML-wrapped in `additionalContext`
- Distribution: Claude Code plugin marketplace only (v0.1)
- OS: macOS + Linux (Windows/WSL deferred)
- `/plugin install` registration via commands array in plugin.json

## Remaining /ccg Flag
- **Stage 11 pending marker**: location/format/lifecycle concrete default chosen (file per event in `~/.claude/claudit/pending/`), but genuine 3-option fork (file vs JSON field vs env var). Executor may invoke `/ccg` if this default hits friction.

## Verified Convention Deviations (executor to fix at Stage 1)
1. SessionStart matcher should be `"*"` not `""`
2. Commands array uses string paths (`"./commands/scan.md"`), not object format

## Next Step
Hand off to `oh-my-claudecode:autopilot` with the consensus plan as Phase 0+1 output. Autopilot skips Expansion + Planning, starts at Phase 2 (Execution).
