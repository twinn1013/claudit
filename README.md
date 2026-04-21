# claudit

[English README](./README.en.md)

설치된 Claude Code 플러그인, 훅, 슬래시 커맨드, 스킬, 서브에이전트, MCP 서버, PATH 바이너리 사이의 설정 충돌을 찾아내고, Claude가 바로 해석할 수 있는 리포트로 내보내는 플러그인입니다.

## 왜 필요한가?

- Claude Code 플러그인을 여러 개 쓰기 시작하면 설정 충돌이 꽤 쉽게 발생합니다.
- Claude Code 자체는 이런 충돌을 자동으로 감지해주지 않습니다.
- claudit은 **SessionStart** 시점에 스냅샷과 이전 상태를 비교해 충돌을 감지합니다.
- 실전 예시: `user-settings`의 `rtk` `PreToolUse:Bash` 훅과 플러그인 범위의 `oh-my-claudecode` `PreToolUse:*` 훅이 겹칠 수 있습니다.
- 제 환경에서는 실제 스캔에서 **19 collisions**를 **124ms** 만에 감지했습니다.

## 무엇이고, 무엇이 아닌가

- ✅ **정적 분석기**입니다. 저장된 훅, 매니페스트, 바이너리를 읽고 구조화된 결과를 만듭니다.
- ✅ **관찰자**입니다. 사용자 설정을 수정하지 않고, 설치를 막지도 않습니다.
- ✅ **내용 인지형**입니다. “같은 matcher에 훅이 여러 개 있음”과 “같은 matcher에서 두 훅이 `updatedInput`을 실제로 변경함”을 구분합니다.
- ❌ 런타임 훅 인터셉터는 아닙니다. 실제 실행 체인을 추적하지 않습니다.
- ❌ 데몬이 아닙니다. 백그라운드 프로세스 없이 `PostToolUse`와 `SessionStart`에서만 동작합니다.

## 설치

현재 기준 **claudit v0.2.1** 문서입니다.

현재 실제로 동작하는 설치 방법은 아래 한 가지입니다.

```sh
git clone https://github.com/twinn1013/claudit.git
cd claudit
npm install
npm run build
claude --plugin-dir .
```

> 마켓플레이스 릴리즈는 **v0.3**에서 계획 중입니다.

## 사용법

수동 스캔:

```
/claudit scan
```

자동 스캔: 설치 후 `PostToolUse` 훅이 install 계열 Bash 명령(brew, npm -g, cargo, pip, pipx, uv, curl|sh, rtk init, claude plugin install, go install)을 기록하고, `SessionStart` 훅이 세션 시작 시 전체 6-detector 스캔을 실행합니다. 이후 Claude가 충돌 내용을 자연어로 설명해줍니다.

## v0.2 기준 Hook + Snapshot 범위

v0.2는 다음 7개의 `HookSource` 값을 유지합니다.

- `plugin-cache`
- `plugin-marketplace`
- `user-settings`
- `user-settings-local`
- `project-settings`
- `project-settings-local`
- `user-managed`

또한 `HookScript.kind` discriminator를 보존합니다.

- `command`
- `prompt`
- `agent`
- `http`
- `unknown`

이 덕분에 정적으로 분석 가능한 command 훅과, `possible` / `unknown`으로 남겨야 하는 비-command 훅을 구분할 수 있습니다.

## 아키텍처

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
                    │   )  — detector 기본 timeout 500ms
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

## 6개 detector

| Category | 무엇을 잡는가 | Confidence |
|----------|---------------|------------|
| `hook-matcher` | 같은 event+matcher에서 두 훅이 모두 `updatedInput`을 변경하는 경우 | definite / possible / unknown |
| `slash-command` | 두 플러그인이 같은 command base name을 등록한 경우 | possible |
| `skill-name` | 두 플러그인이 같은 skill을 정의하거나 trigger keyword가 겹치는 경우 | possible |
| `subagent-type` | 두 플러그인이 같은 `subagent_type`을 정의한 경우 | possible |
| `mcp-identifier` | 두 소스가 같은 MCP 서버를 등록하거나 같은 tool name을 노출하는 경우 | definite / possible |
| `path-binary` | 같은 바이너리 이름이 `$PATH` 여러 위치에 있고 내용이 다른 경우 | definite / possible |

Detector timeout/throw 같은 내부 오류는 `category: "internal-error"`, `confidence: "unknown"`으로 표시됩니다.

## 한계 (v0.2.1)

claudit은 정적 분석기이므로 다음은 하지 못합니다.

- 훅 스크립트를 실제로 실행하거나 런타임 동작을 관찰하지 않음
- 실제 훅 실행 체인을 인터셉트하거나 serialize하지 않음
- Claude Code 내부의 플러그인 우선순위 / resolution 로직에 접근하지 않음
- 설치 후 설정이 동적으로 바뀌는 경우(예: lazy skill registration)를 추적하지 않음
- 지원하는 subset 밖의 임의 YAML / regex-heavy matcher를 완전하게 파싱하지 않음

이런 블라인드 스팟은 **false negative**를 만들 수 있습니다. 각 Collision의 `confidence`는 다음 의미를 가집니다.

- `definite` — 정적 증거만으로 충돌을 주장할 수 있음
- `possible` — 실제 위험은 보이지만 런타임 확인이 더 필요함
- `unknown` — 겹치거나 미해결된 조건은 있으나 정적 분석만으로 mutation을 증명하지 못함

`possible`과 `unknown`은 수동 검증이 필요하다고 보는 게 맞습니다.

### False-positive 정책

“같은 matcher에 훅이 여러 개 있다”는 사실만으로는 충돌이 아닙니다. v0.2.1은 추가로 same-owner hook registration을 필터링해서, 한 플러그인 내부 훅 묶음을 충돌로 보고하지 않습니다. 현재 기준:

- 증명된 상호 mutation만 `critical/definite`
- disabled plugin 또는 mutating/opaque 혼합은 `warning/possible`
- 둘 다 정적으로 불투명하면 `info/unknown`

또한 `ls`, `cat`, `bash` 같은 benign system binary duplicate는 allowlist로 제외합니다.

### False-negative 정책

훅 실행 순서, 동적 변수 확장, Claude Code 내부 merge/de-dup 로직 같은 런타임 의존 동작은 정적으로 확정할 수 없습니다. v0.2.1은 v0.1보다 env-var / script-path 처리를 넓혔지만, 여전히 런타임 인터셉션이 아니라 heuristic static analysis를 사용합니다. 아주 큰 환경에서는 `CLAUDIT_DETECTOR_TIMEOUT_MS`로 detector budget을 조절해야 할 수도 있습니다. 자세한 정책은 `src/policies.ts`를 참고하세요.

## 스캔 출력 형식

리포트는 `<claudit-report>…</claudit-report>` 태그로 감싸지며, 태그 안 payload는 **base64-encoded JSON** 입니다.

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

## 개발

```sh
npm install
npx tsup                    # npm run build와 동일
npx vitest run              # npm test와 동일
npm run typecheck           # tsc --noEmit
npm test                    # vitest run
npm run build               # tsup → dist/**/*.mjs
```

프로젝트 구조:

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
  policies.ts                 # detector budget, namespace severity 기본값, redaction policy constants
dist/                         # tsup output — .mjs entry points referenced by hooks.json
tests/
  e2e/                        # 실전 시나리오 테스트
  ralph-verify-v2.test.ts     # Stage 9 six-criterion verification suite
```

## 어떻게 만들어졌나

v0.2.1은 실환경 검증 이후 나온 첫 패치 릴리즈입니다. 실제 스모크 테스트에서 드러난 세 가지 문제를 고쳤습니다.

- `CLAUDE_PLUGIN_ROOT` 없이 `/claudit scan` bootstrap 실패
- same-plugin self-overlap hook noise
- 긴 `$PATH` 환경에서 `path-binary` detector timeout

v0.2 자체는 **5-way review**로 리빌드했습니다.

- `architect`
- `security-reviewer`
- `code-reviewer`
- external Claude review
- external Gemini review

그 과정에서 Phase 4의 `code-reviewer` lane(Erdos)가 marketplace-qualified plugin identity 버그를 잡아냈고, 그 결과 `[v2-plugin-identity-fix]`가 들어가 `foo@alpha` / `foo@beta`가 하나의 enablement decision으로 붕괴되는 문제를 막았습니다.

또한 이 리빌드는 프로젝트의 flagship proof-case를 테스트에 고정했습니다. 이제 claudit은 실제 **rtk + OMC** `PreToolUse` overlap 시나리오를 `Snapshot -> Scanner -> Report` 전체 파이프라인으로 감지합니다.

## License

MIT.
