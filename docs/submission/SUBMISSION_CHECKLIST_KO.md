# 제출 체크리스트

`[x]`는 이 저장소에서 확인한 항목, `[ ]`는 제출자가 직접 해야 하는 항목입니다.

## 1. 코드·실행

- [x] 기존 엔진·CLI·hacksprint 모듈 코드 무수정 (`git diff 8c1d850 --stat -- packages/schema/src packages/state-engine/src packages/recovery-engine/src apps/cli/src apps/web/src/lib/hacksprint`가 비어 있음)
- [x] 범위 유지: 사고 유형 1개(`merge_conflict`), 로컬 전용, Next.js/TypeScript/Prisma
- [x] `pnpm review:setup` 후 `pnpm review:dev`로 `/review` 동작 확인 (시나리오 열기 → 동의 → 승인 → 격리 실행 VERIFIED, 감사 체인 정상)
- [x] 자동 push/merge 없음: 격리 저장소에 원격이 없음을 실행 전 확인, 거부 목록에 `push`/`fetch`/`remote` 등 포함
- [x] AI 생성 명령 실행 불가: 인가 함수 입력에 모델 출력이 없음, 실행 명령은 결정적 계획에서만 나옴
- [x] 타입 검사 통과 (`apps/web`: `npx tsc --noEmit -p .`)
- [x] Recovery Review 단위 테스트, 20개 시나리오 E2E 테스트 통과 (결과는 `EVALUATION_KO.md` §5)
- [x] 기존 테스트 스위트 실행 결과 기록 (`EVALUATION_KO.md` §5, 기존 플래키 테스트 1건 명시)

## 2. 평가·정직성

- [x] 15개 이상 재현 가능한 시나리오: 20개 (`apps/web/src/lib/review/scenarios.ts`)
- [x] 기준선 vs 최종 측정 결과가 하네스에서 자동 생성됨 (`results/EVAL_DETERMINISTIC.md`)
- [x] RAG vs 직접 주입 비교(정확도·토큰·지연·가정 비용) 실측 (`results/EVAL_LLM_qwen2.5_3b.md`)
- [x] 수용 기준은 "목표"로 표기하고, 달성 여부를 측정값 그대로 보고 (미달 항목 포함)
- [x] 인터뷰·설문·사용자 연구를 수행하지 않았음을 명시, 수치 조작 없음
- [x] 참고문헌은 링크로 존재를 확인한 자료만 인용

## 3. 문서

- [x] 최종 보고서(한국어) `FINAL_REPORT_KO.md`
- [x] 기존/신규 기능 구분표 `FEATURE_MATRIX_KO.md`
- [x] 아키텍처 다이어그램 `ARCHITECTURE.md`
- [x] README/설치 방법 (루트 `README.md`의 "Recovery Review" 절, 이 폴더의 `README.md`)
- [x] 데모 시나리오(픽스처) 20개와 고정 모델 출력 픽스처(`fixture-responses.ts`)
- [x] 녹화 대본 `DEMO_SCRIPT_KO.md`

## 4. 제출자가 직접 할 일

- [ ] 중간 발표 제안서(6쪽)와 이 보고서의 목표·범위 표현이 일치하는지 대조 (제안서 원문은 저장소에 없어 과제 요구사항 문서를 기준으로 작성함)
- [ ] `DEMO_SCRIPT_KO.md`에 따라 시연 영상 녹화 (CPU 환경에서는 모델 응답 대기 구간 편집 시 자막으로 표시)
- [ ] 제출 형식(PDF/HWP)이 필요하면 `FINAL_REPORT_KO.md`를 변환하고 Mermaid 다이어그램을 이미지로 내보내기
- [ ] 보고서 표지(학번·이름·과목·담당 교수) 작성
- [ ] 제출 직전 `pnpm review:test`와 `pnpm review:eval`을 한 번 더 실행해 결과 파일 날짜 갱신 (선택)
- [ ] `apps/web/.env.local`은 제출물에 포함하지 않기 (토큰 포함 가능, `.gitignore` 대상)
