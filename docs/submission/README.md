# LatchOps Recovery Review — 최종 제출물

Git 병합 충돌 사고 한 종류를 대상으로 **증거 → 근거 있는 AI 설명 → 사람의 명시적 승인 → 격리 실행** 순서를 강제하는 로컬 전용 검토 도구입니다.

## 문서 목록

| 문서 | 내용 |
|---|---|
| [FINAL_REPORT_KO.md](./FINAL_REPORT_KO.md) | 최종 보고서 (문제, 설계, RAG 정당화, 보안, 평가, 수용 기준 결과, 한계) |
| [FEATURE_MATRIX_KO.md](./FEATURE_MATRIX_KO.md) | 기존 모듈 / 신규 모듈 구분표 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 아키텍처·시퀀스·데이터 모델·신뢰 경계 다이어그램(Mermaid), 실행 정책 |
| [EVALUATION_KO.md](./EVALUATION_KO.md) | 평가 방법, 시나리오 목록, 측정 결과, 재현 명령 |
| [DEMO_SCRIPT_KO.md](./DEMO_SCRIPT_KO.md) | 시연 녹화 대본 (녹화 파일은 포함되어 있지 않음) |
| [SUBMISSION_CHECKLIST_KO.md](./SUBMISSION_CHECKLIST_KO.md) | 제출 체크리스트 |
| [REFERENCES_KO.md](./REFERENCES_KO.md) | 참고문헌 (국내 법령·지침·연구 포함, 링크 확인) |
| [results/](./results/) | 평가 하네스가 자동 생성한 원본 결과(JSON/Markdown). 손으로 고친 수치 없음 |
| [screenshots/](./screenshots/) | UI 캡처 |

## 빠른 실행

```powershell
pnpm install
pnpm review:setup        # 엔진 빌드 + review Prisma 클라이언트 생성
pnpm review:dev          # http://127.0.0.1:3000/review
```

로컬 모델 설명을 쓰려면 [Ollama](https://ollama.com)를 설치하고 `ollama pull qwen2.5:3b`를 실행합니다. 모델이 없어도 증거·승인·격리 실행은 모두 동작합니다.
