# Deep Interview Spec: claudit

## Metadata
- Interview ID: claudit-2026-04-20
- Rounds: 6
- Final Ambiguity Score: 19.5%
- Type: greenfield
- Generated: 2026-04-20
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 0.40 | 0.340 |
| Constraint Clarity | 0.75 | 0.30 | 0.225 |
| Success Criteria | 0.80 | 0.30 | 0.240 |
| **Total Clarity** | | | **0.805** |
| **Ambiguity** | | | **0.195** |

## Goal
claudit는 Claude Code 사용자가 새로운 플러그인/MCP/바이너리를 설치하거나 설정을 수동 변경했을 때, 기존 환경과의 충돌을 자동으로 감지하고 Claude가 파싱 가능한 구조화된 리포트를 생성한다. Claude가 이 리포트를 컨텍스트로 받아 사용자에게 자연어로 설명하고 수정 명령을 제안·실행한다. 사용자는 복붙 없이 승인만으로 문제를 해결한다.

## Constraints
- 언어/런타임: **Node.js + TypeScript**
- 배포 형태: **Claude Code plugin** (marketplace.json 기반, `/plugin install`로 설치 가능)
- OMC 의존성 없음 (OMC 외 사용자층까지 포괄)
- 훅 트리거 2종:
  - `PostToolUse:Bash` — 세션 안에서 실행된 설치 커맨드 감지 (brew/npm/cargo/pip/pipx/uv/curl|sh/rtk init/claude plugin install 등 regex)
  - `SessionStart` — 세션 밖 수동 변경을 스냅샷 diff로 포착
- 감지 방식: **content-aware** (표면 개수 비교가 아닌, 훅 스크립트 정적 분석 + 입력 변조 지점 추적 + PATH ambiguity 교차 체크)
- 아키텍처: **디텍터 모듈 플러그인 패턴** (6개 카테고리 = 6개 독립 모듈, 공통 인터페이스 구현)

## Non-Goals
- claudit 자체가 settings.json/CLAUDE.md/플러그인 설정을 **직접 수정하지 않음** (실행은 Claude 에이전트에게 위임, 안전·감사 추적 보장)
- 사용자가 리포트 내 명령을 **수동 복붙하지 않음** (Claude가 파싱·요약·승인요청·실행)
- 설치 자체를 **차단·블로킹하지 않음** (관찰·알림 툴, 방어막 아님)
- 독립 UI/대시보드 없음 (리포트의 primary channel은 Claude 컨텍스트 주입)
- 추가 런타임/의존 배포 (Python/Rust 미사용, Node만 요구)

## Acceptance Criteria (v0.1)
- [ ] 6개 충돌 카테고리 전부 **content-aware 감지** 구현
  1. 훅 매처 간섭 (같은 matcher에 `updatedInput` 변조하는 훅이 둘 이상 존재하는 경우)
  2. 슬래시 커맨드 이름 중복 (네임스페이스 외에 base name 동일)
  3. 스킬 이름 + 트리거 키워드 중복
  4. 서브에이전트 타입 이름 중복
  5. MCP 서버명 중복 + MCP 툴명 중복 (서버 간)
  6. PATH 바이너리 섀도잉 (같은 커맨드가 여러 경로에 설치됨, 예: rtk/Rust Type Kit)
- [ ] `PostToolUse:Bash` 훅이 설치 패턴 정확히 매칭 (brew install, npm install -g, npm i -g, cargo install, pip install, pipx install, uv add, curl …| sh, rtk init, claude plugin install 등)
- [ ] `SessionStart` 훅이 `~/.claude/` 스냅샷과 이전 스냅샷 diff로 세션 밖 변경 감지
- [ ] 각 Collision은 `{category, severity, entities_involved, suggested_fix[]}` 스키마로 직렬화
- [ ] Claude가 리포트를 파싱해서 자연어로 사용자에게 설명·수정 제안·승인 후 실행하는 E2E 시나리오가 실사례로 검증됨 (예: 이 세션처럼 rtk + OMC 공존 환경)
- [ ] `/claudit scan` 슬래시 커맨드로 수동 스캔 가능 (동일 스캐너 재호출)
- [ ] false positive 정책 명문화: "같은 matcher에 여러 훅 존재" 자체는 충돌 아님, **실제 입력 변조 상호간섭 또는 확정적 이름 충돌**만 conflict
- [ ] 최소 3개 실제 시나리오 End-to-End 테스트 (rtk+OMC, 플러그인 중복 마켓 설치, PATH 섀도잉)

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "훅 충돌만 검사하면 충분" | Round 0 대화 | 6개 카테고리(훅/커맨드/스킬/에이전트/MCP/PATH) 전체로 확장 |
| "리포트는 사용자가 읽고 복붙" | Round 2 ("너가 하면 되지") | Claude-consumable 포맷 → Claude가 해석·실행까지 위임 |
| "Tier 1 중 일부만 MVP로 축소 가능" | Round 4 Contrarian | 모두 중요, 스코프 축소 불가 → 디텍터 모듈 아키텍처로 공통 인터페이스 가져감 |
| "Surface-level(개수 기반) 감지면 충분" | Round 5 (rtk+OMC 실사례) | content-aware 판정 필요, 내용 검사 룰셋 구현 |
| "v0.1에서 descope 가능" | Round 6 Simplifier | 그대로 제대로 하는 게 맞음, 2-4주 감수 |

## Technical Context
- **언어/런타임**: Node.js 20+ / TypeScript 5+
- **배포**: Claude Code plugin marketplace.json, 사용자는 `/plugin install`로 설치
- **훅 스크립트**: `.mjs` 또는 컴파일된 `.js`로 hooks.json에서 호출
- **아키텍처 스켈레톤**:
  ```
  src/
    scanner.ts          # 메인 엔트리, 디텍터 오케스트레이션
    detectors/
      hook-matcher.ts
      slash-command.ts
      skill-name.ts
      subagent-type.ts
      mcp-identifier.ts
      path-binary.ts
    detector.ts         # 공통 인터페이스
    snapshot.ts         # ~/.claude/ 상태 스냅샷·diff
    report.ts           # Collision 스키마·직렬화
    hooks/
      post-tool-use-bash.mjs
      session-start.mjs
    commands/
      scan.md           # /claudit scan 슬래시 커맨드
  ```

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| InstallEvent | core | trigger_source (hook \| snapshot-diff), command, timestamp | triggers Scanner |
| Scanner | core | detectors[], snapshot_current, snapshot_prev | owns DetectorModule[], emits Report |
| DetectorModule | core | category, rule_set, analyze(snapshot) → Collision[] | implements Detector interface, used by Scanner |
| DetectionRule | supporting | content_pattern, false_positive_filter, severity_fn | applied by DetectorModule |
| Collision | core | category, severity, entities_involved, suggested_fix[] | contained in Report |
| FixSuggestion | supporting | command, scope, safety_level, rationale | part of Collision |
| Report | core | collisions[], claude_readable_format, metadata | consumed by Claude via hook context |
| Snapshot | supporting | claude_dir_state, hash, timestamp | compared by Scanner |
| ApprovalFlow | supporting | claude_explains → user_approves → claude_executes | orchestrates Report use |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 5 | 5 | - | - | N/A |
| 2 | 7 | 2 (FixSuggestion, ApprovalFlow) | 0 | 5 | 71% |
| 3 | 7 | 0 | 0 | 7 | 100% |
| 4 | 8 | 1 (DetectorModule) | 0 | 7 | 87.5% |
| 5 | 9 | 1 (DetectionRule) | 0 | 8 | 89% |
| 6 | 9 | 0 | 0 | 9 | 100% |

2라운드 연속 100% stability로 도메인 모델 수렴 완료.

## Open Questions (실행 단계에서 해소)
1. **배포 채널**: plugin marketplace 단독 vs + GitHub release + npm 패키지 (3중 배포)
2. **OS 타깃**: macOS + Linux만 vs Windows/WSL 포함
3. **성능 예산**: `PostToolUse:Bash` 훅 레이턴시 허용치 (<100ms? <500ms?)
4. **리포트 포맷 구체**: JSON vs Markdown-sectioned vs XML-tagged (Claude 파싱 안정성 기준 선택)
5. **DetectorModule 인터페이스 시그니처**: `analyze(snapshot) → Collision[]` 동기 vs 비동기, 에러 처리 정책
6. **스냅샷 저장 위치**: `~/.claude/claudit/snapshots/` 등 정확한 경로 확정
7. **설치 커맨드 regex 초기 셋**: 최소 어디까지 커버? (패턴 테스트 필요)

이 7개는 전부 ralplan Architect/Critic 또는 autopilot Phase 1 Planning 단계에서 해소하기 적합한 세부사항. deep-interview 범위 밖.

## Interview Transcript

### Round 1
**Q:** claudit의 value moment — 사용자가 충돌 정보를 처음 받아보는 시점은?
**A:** "설치 직후 + 세션 시작 시" 두 개로 충분
**Ambiguity:** 60.5%

### Round 2
**Q:** 충돌 감지 시 어디까지 개입하는가?
**A:** 인폼+액션 제안. 단 사용자 복붙이 아니라 Claude가 실행
**Ambiguity:** 45.0%

### Round 3
**Q:** 언어/런타임?
**A:** Node.js + TypeScript
**Ambiguity:** 36.0%

### Round 4 (Contrarian)
**Q:** 강제로 1개 유형만 고르면?
**A:** "다 중요해서 못 고르겠음" → 6개 전부 v0.1 스코프 확정
**Ambiguity:** 33.0%

### Round 5
**Q:** 실사례(rtk+OMC 공존)는 충돌인가 아닌가?
**A:** 내용 검사 후 판단 (content-aware)
**Ambiguity:** 28.5%

### Round 6 (Simplifier)
**Q:** v0.1에서 가장 단순한 버전은?
**A:** 전부 content-aware — 제대로 한 번에
**Ambiguity:** 19.5% ✅
