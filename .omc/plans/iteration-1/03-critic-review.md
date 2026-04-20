# Critic Review — Iteration 1

## Verdict: ITERATE

## Pre-Commitment Predictions (all confirmed)
1. Hook output format misunderstanding — CONFIRMED (real schema is `{continue, hookSpecificOutput:{hookEventName, additionalContext}}`)
2. Latency vs content-aware tension — CONFIRMED
3. Plugin registration convention guessed — PARTIALLY CONFIRMED (commands at `.claude-plugin/plugin.json` level, not marketplace entry)
4. PostToolUse:Bash matcher specificity — CONFIRMED (no existing plugin uses PostToolUse with `"Bash"` matcher; all use `"*"`. `PermissionRequest` uses `"Bash"` matcher)
5. Snapshot missing project-level — CONFIRMED

## Findings: 1 CRITICAL + 5 MAJOR

### CRITICAL: Stage 11 P3/P5 Conflict (as-written unimplementable)
Plan says PostToolUse:Bash does scanning; content-aware @ 200ms impossible. Architect's trigger+deferred synthesis is correct fix but plan not updated.

### MAJOR 1: Hook stdout JSON shape contradiction
Plan: "JSON+XML wrapper, /ccg required" (contradictory).
Real convention from OMC keyword-detector.mjs:616-623:
```json
{"continue": true, "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "..."}}
```
XML wrapping within `additionalContext` string is acceptable (follows `<system-reminder>` pattern).

### MAJOR 2: $CLAUDE_PLUGIN_ROOT resolution strategy missing
Every hook uses it. Claudit's detectors must resolve it when analyzing OTHER plugins' hook scripts. No policy in plan.

### MAJOR 3: Static analysis fallback for dynamic content undefined
Hook scripts use dynamic vars (`$CLAUDE_PLUGIN_ROOT`, `$HOME`, etc). Without resolution: zero hook scripts meaningfully analyzable. Plan needs: (a) known env var resolution at analysis time, (b) `confidence` field on Collision for unresolvable cases, (c) skip policy for parse failures.

### MAJOR 4: Deferred scan (Architect's fix) introduces unmitigated risks
- Pending-scan file corruption if CC crashes between write and next SessionStart
- User restarts before deferred scan runs
- Race condition on rapid installs (batching policy undefined)
- Pending marker format/location/lifecycle all unspecified — three valid options (file vs JSON field vs env var) = 3+ option fork → /ccg eligible

### MAJOR 5: Namespace verification insufficient
"Grep for 'scan'" is not enough. Must:
1. Parse all installed plugins' plugin.json for commands + skills arrays
2. Parse claudit's own plugin.json
3. Assert zero intersection
Evidence: Vercel registers 5 commands (bootstrap/deploy/env/marketplace/status).

## Missing Items

1. Hook stdin format: PostToolUse receives stdin with tool input + output; claudit must parse this to match install regex. Not specified.
2. $CLAUDE_PLUGIN_ROOT resolution policy (detectors analyzing other plugins' hooks).
3. Hook execution order across plugins — claudit's hook runs where? Not addressed.
4. Snapshot storage size budget — could be several MB uncontrolled.
5. Build pipeline: .mjs vs .ts vs compiled (OMC uses .mjs pre-compiled; Vercel compiles .mts→.mjs via tsup).
6. package.json creation: project has plugin.json but no package.json. Stage 1 must add.

## 8 Required Revisions for Iteration 2

1. **Stage 11**: Rewrite for trigger+deferred. Specify pending marker file location, format, cleanup policy, and batching behavior for rapid installs.
2. **Stage 2**: Add hook stdin parsing to detector interface design. Specify `$CLAUDE_PLUGIN_ROOT` resolution strategy (process.env for own hooks; computed from plugin install paths for analyzing others).
3. **Stage 2**: Add `confidence: 'definite' | 'possible' | 'unknown'` field to Collision schema. Document when each applies.
4. **Stages 3-10**: Add explicit binary exit criteria for each stage (not only 2 + 14).
5. **Open Q4, Q5, Q7**: Resolve contradiction — pick "resolved" (no /ccg) OR "/ccg required" (not resolved). Cannot be both.
6. **Stage 1**: Specify exact scaffold deliverables: package.json, tsconfig.json, updated plugin.json (with commands array), hooks/hooks.json skeleton, build script choice, directory structure. Flag for /ccg on commands-vs-skills convention.
7. **Ralph-verify install test**: Add hooks.json convention path verification. Namespace test must programmatically enumerate all installed plugin identifiers (commands + skills + agents + MCP names), not grep single string.
8. **Add "Limitations" section**: Explicitly scope static-analysis capability. Provide false-negative policy alongside false-positive policy from spec.

## Ambiguity Risks

- "content-aware detection" — static analysis (plan intent) vs runtime monitoring (not ruled out). Different architectures.
- "detector module plugin pattern" — importable module (plan intent) vs separate process. Process form worsens 100ms timeout.
- "pending marker" — 3 valid implementations (file / JSON field / env var). Different failure modes each.

## Verdict Justification

Plan is architecturally sound. Architect review is high quality and catches real issues. Plan needs one iteration to incorporate Architect's 8 revisions + these 8 additional gaps. Completeness problem, not direction problem.
