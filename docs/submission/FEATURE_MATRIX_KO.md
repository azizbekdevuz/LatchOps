# 기존 기능 / 신규 기능 구분표

교수님 피드백("기존 모듈과 새로 구현한 모듈을 명확히 구분")에 따라, 저장소의 모든 관련 모듈을 **기존(재사용)**, **기존(설정만 변경)**, **신규**로 나눕니다.
판단 근거는 Git 이력입니다. 기준 커밋은 `8c1d850 docs: update readme`이며, 그 이후 `git status`에서 신규(`??`) 또는 수정(`M`)으로 표시된 파일만 이번 작업입니다.

## 1. 요약

| 구분 | 위치 | 이번 작업에서의 처리 |
|---|---|---|
| 기존 · 재사용 | `packages/schema`, `packages/state-engine`, `packages/recovery-engine` | 코드 변경 없음. 스냅샷 캡처, 신호 계산, 복구 계획 생성, 복구 검증에 그대로 사용 |
| 기존 · 재사용 | `apps/cli` | 코드 변경 없음. `snapshot` 출력(JSON)을 Recovery Review가 가져오기(import) |
| 기존 · 보존 | `archive/daytona-hacksprint` (`8c1d850`) | Daytona/Nosana 해커톤 데모 전체. 이 브랜치에서 지우기 전에 그 커밋을 브랜치로 고정 |
| 기존 · 이동 | `apps/web/src/lib/isolation` | 해커톤 모듈의 허용 목록, 판정, 로컬 Git 환경, 워크스페이스 스냅샷을 옮김. 동작은 같고 Daytona 작업공간 구현은 포함하지 않음 |
| 기존 · 재사용 | 웹 제품(대시보드, 인증, PostgreSQL Prisma 스키마, incident room) | 라우트와 스키마는 유지. 내비게이션의 Proof 링크와 `/hacksprint`, `/proof`만 제거 |
| 기존 · 설정만 변경 | `apps/web/next.config.js`, `auth.config.ts`, `Header.tsx`, `vitest.config.ts`, `package.json`(web·root) | 새 라우트 공개 경로 등록, 내비게이션 링크, 별도 Prisma 클라이언트 외부화, 테스트 설정·스크립트 추가 |
| 신규 | `apps/web/src/lib/review/*`, `apps/web/src/app/review/*`, `apps/web/src/app/api/review/*`, `apps/web/prisma/review.prisma`, `apps/web/prisma/review-migrations/*`, `apps/web/scripts/review/*`, `apps/web/vitest.review.config.ts`, `docs/submission/*` | Recovery Review 전체 |

## 2. 기능 단위 매트릭스

| 기능 | 기존 (중간 발표 시점) | 신규 (최종) | 구현 위치 |
|---|---|---|---|
| Git 상태 스냅샷 | ✅ `captureSnapshot` | 재사용 | `packages/state-engine` [기존] |
| 상태 분류(merge_conflict 등) | ✅ `computeRepoSignals` | 재사용 | `packages/state-engine` [기존] |
| 결정적 복구 계획 | ✅ `generateRecoveryPlan` | 재사용 | `packages/recovery-engine` [기존] |
| 복구 검증 | ✅ `verifyRecovery` | 재사용 | `packages/recovery-engine` [기존] |
| VERIFIED/FAILED 판정 | ✅ `decideVerdict` | 재사용, 인가 거부 시 `BLOCKED` 추가 | `isolation/verdict.ts` [기존에서 이동], `review/isolated.ts` [신규] |
| 실행 명령 허용 목록 | ✅ `isExecutablePlanCommand` (구조적 허용 목록) | 재사용 + **거부 목록**(push/fetch/clean/reset/checkout/--force/--hard 등) 추가 | `isolation/commands.ts` [기존에서 이동], `review/authorize.ts` [신규] |
| 격리 실행 환경 | ✅ 로컬 임시 디렉터리. Daytona 샌드박스는 해커톤 전용 | 로컬 임시 저장소만 사용, 원격 없음 확인, 고정 커밋 날짜. Daytona 구현은 이 브랜치에서 제거 | `isolation/workspace.ts` [기존에서 이동], `review/isolated.ts` [신규] |
| 사고 재현 시나리오 | 1개 (checkout-service `deploy.env`) | **20개** (저장소 12 + 안전 통제 8) | `review/scenarios.ts` [신규] |
| 증거 스냅샷 | 단일 JSON 요약(`buildLegacyExplanationEvidence`, 옛 이름 `buildNosanaEvidence`) | **번호가 매겨진 증거 항목(E1..En)**, 신뢰 불가 표시, 잘림 기록, 커버리지 공백 항목, SHA-256 해시 | `review/legacy-evidence.ts` [기준선용으로 보존], `review/evidence.ts` [신규] |
| 비밀값 마스킹 | `scrub()` 정규식 3개 — **충돌 본문(ours/theirs)에는 미적용** | 13종 규칙, 모든 증거 항목에 적용, 재검사(`verifiedClean`), 프롬프트 직전 재검사 | `review/legacy-evidence.ts` [옛 규칙 보존], `review/redact.ts` [신규] |
| 모델 전송 동의 | 없음 (키가 있으면 자동 호출) | 증거 해시 + 제공자에 바인딩된 동의/철회, 동의 없으면 호출 차단(409) | `review/service.ts` [신규] |
| LLM 설명 | Nosana 원격 API, 자유 형식 5필드, 인용 없음. 그 코드는 아카이브 브랜치에만 있음 | **로컬 Ollama**, JSON 스키마 강제, 주장별 인용·유형·신뢰도·불확실성 | `review/llm.ts`, `prompt.ts` [신규] |
| 근거 검색 | 없음 | BM25 RAG(고정 핵심 + 상위 6 증거 + 상위 3 런북) vs 직접 주입 비교 | `review/retrieval.ts`, `knowledge.ts` [신규] |
| 설명 검증 | 형식 파싱 + `scrub()` | **fail-closed 검증기**: 스키마, 인용 존재, 엔티티 근거, 개수 일치, 금지 내용, 핵심 주장 규칙 | `review/validate.ts` [신규] |
| 사람의 승인 | 없음 (버튼 클릭 시 즉시 실행) | 역할(viewer/requester/approver), 4-eyes, 사유 필수, 30분 TTL, 1회용 | `review/authorize.ts`, `service.ts` [신규] |
| 실행 인가 | 허용 목록만 | 13개 조건의 결정적 인가 함수(해시·지문·재캡처·커버리지 포함) | `review/authorize.ts` [신규] |
| 감사 기록 | 없음 | 해시 체인 감사 로그 + 변조 탐지 | `review/audit.ts` [신규] |
| 영속 저장 | 해커톤 증명 결과는 DB에 저장하지 않았음 (기존 제품의 incident는 PostgreSQL) | SQLite: 사고·스냅샷·동의·설명·결정·실행·감사 | `prisma/review.prisma` [신규] |
| CLI 스냅샷 검토 | CLI `send`로 웹 incident room 전송 | CLI `snapshot` JSON 가져오기 → 검토 전용(실행 불가) | `apps/cli` [기존], `review/service.ts#importCliSnapshot` [신규] |
| 검토 UI | `/hacksprint` 단일 버튼 데모 (아카이브 브랜치) | `/review` 목록·시나리오·가져오기, `/review/[id]` 증거/설명/결정/실행/감사 화면 | `app/review/*` [신규] |
| 평가 | 단위 테스트 | 기준선 vs 최종 20개 시나리오 비교, LLM direct vs RAG vs 기존 프롬프트 비교 | `scripts/review/evaluate.eval.ts` [신규] |

## 3. 기존 모듈을 고치지 않은 이유와 예외

- 기존 엔진과 CLI는 이미 테스트가 있고 정상 동작하므로, 요구사항("작동하는 기능을 다시 쓰지 말 것")에 따라 **import만** 했습니다.
- 기존 `scrub()`을 고쳐서 새 규칙과 섞지 않은 이유: 기준선 측정이 옛 동작을 그대로 재현해야 하기 때문입니다. 그 함수는 `review/legacy-evidence.ts`에 있고, 한계(충돌 본문 미적용, AWS 키·`ghp_` 토큰·URL 자격증명 미탐지)는 평가 수치로 남아 있습니다.
- 해커톤 전용 파일(Daytona 클라이언트, Nosana 호출, 접근 토큰, `/hacksprint`, `/proof`)은 재사용 코드를 옮긴 뒤에 이 브랜치에서 삭제했습니다. 원본은 `archive/daytona-hacksprint`에서 체크아웃할 수 있습니다.
- 스냅샷이 미병합 파일을 5개, 충돌 블록을 3개에서 자르던 상한은 불완전한 증거였습니다. 상한을 파일 20개, 블록 8개로 올리고, 그 이상이면 빠진 개수를 기록한 뒤 실행을 막습니다(S21). 상태 엔진과 검토용 캡처가 같은 상한을 씁니다.
