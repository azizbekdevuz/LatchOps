# 시연 녹화 스크립트 (약 7분)

> 이 문서는 녹화 **대본**입니다. 녹화 파일은 저장소에 포함되어 있지 않으며, 제출자가 아래 절차대로 직접 녹화해야 합니다.
> 화면에 보이는 수치(해시, 시간, 지연)는 실행할 때마다 달라질 수 있습니다. 대본에 적힌 값은 예시가 아니라 "어디를 가리킬지"입니다.

## 0. 사전 준비 (녹화 전, 화면 밖)

```powershell
cd D:\Workplace\Web\LatchOps
pnpm install
pnpm review:setup                 # 엔진 3개 빌드 + review Prisma 클라이언트 생성
ollama pull qwen2.5:3b            # 최초 1회
ollama serve                      # 이미 실행 중이면 생략
pnpm review:dev                   # http://127.0.0.1:3000 에서만 수신
```

- 브라우저에서 `http://localhost:3000/review`를 미리 한 번 열어 컴파일을 끝내 둡니다(첫 컴파일은 10–20초 걸림).
- 이전 데모 데이터를 지우려면 서버를 끈 뒤 `apps/web/.review-data/` 폴더를 삭제합니다.
- CPU 전용 환경에서 로컬 모델 설명 1회는 수 분이 걸릴 수 있습니다. 녹화 시간을 줄이려면 해당 구간을 미리 생성해 두거나 편집으로 대기 시간을 자릅니다. 대기 구간을 자를 경우 자막에 "대기 시간 편집"이라고 표시합니다.

## 1. 문제와 범위 소개 (0:00–0:45)

화면: `/review` 상단.

> "LatchOps Recovery Review는 Git 병합 충돌 사고 한 종류만 다룹니다. 모든 것이 이 PC 안에서만 동작합니다. 흐름은 증거, 근거 있는 설명, 사람의 명시적 승인, 격리 실행 네 단계입니다."

- 상단 4단계 카드와 "Ollama qwen2.5:3b ready" 상태 칩을 가리킵니다.
- "기존 엔진(state-engine, recovery-engine)이 스냅샷과 계획을 만들고, 이번 학기에 새로 만든 부분은 증거 스냅샷, 검증된 설명, 승인과 감사 기록입니다"라고 말합니다(`FEATURE_MATRIX_KO.md` 참고).

## 2. 증거 스냅샷 (0:45–1:45)

동작: 행위자 **Minji (requester)** 선택, **S05 Secrets inside the conflicting hunk** 클릭.

> "시나리오를 열면 서버가 임시 폴더에 실제 Git 저장소를 만들고 병합 충돌을 재현합니다. 그리고 기존 엔진으로 스냅샷을 찍습니다."

- 왼쪽 증거 패널: `evidence sha256`, `plan fingerprint`, `N value(s) redacted`, `re-scan clean`을 가리킵니다.
- 충돌 항목(E6 근처)에서 `[REDACTED:aws_access_key_id]` 같은 마스킹 표시를 보여 줍니다.
- "untrusted repo text" 배지를 가리키며 "커밋 메시지나 파일 내용은 모델에게 신뢰할 수 없는 데이터로 표시됩니다"라고 설명합니다.

## 3. 동의와 근거 있는 설명 (1:45–3:30)

동작: 오른쪽 "Grounded explanation" 패널.

1. 동의 전에 **Generate explanation**이 비활성인 것을 보여 줍니다. "동의 없이는 모델을 호출하지 않습니다."
2. **Grant consent for this evidence** 클릭. 동의가 증거 해시에 묶인다는 문구를 가리킵니다.
3. 모드 **RAG (pinned + BM25)** 선택, **Generate explanation** 클릭.
4. 결과 화면:
   - **accepted**이면 주장마다 붙은 인용 칩(E#, K#)을 클릭해 왼쪽 증거가 강조되는 것을 보여 줍니다. 불확실성(uncertainties)과 "model vs engine" 줄을 가리킵니다.
   - **rejected**이면 "withheld" 사유 목록을 보여 주며 "검증을 통과하지 못한 설명은 내용을 보여 주지 않습니다. 사람은 결정적 증거만으로도 계속 검토할 수 있습니다"라고 말합니다.
   - 실제로 어떤 결과가 나왔는지 그대로 말합니다. 결과를 바꾸려고 재시도한 경우 재시도 사실을 말합니다.

## 4. 환각·인젝션 차단 (3:30–4:15)

동작: `/review`로 돌아가 **S19 Model returns hallucinated or malformed output** 설명 문구를 보여 줍니다.

> "S19는 잘못된 JSON, 존재하지 않는 인용 E99, 증거에 없는 파일 경로, 'git push --force'와 'VERIFIED'를 주입한 모델 출력을 고정 픽스처로 넣는 테스트입니다. 네 경우 모두 검증기가 거절합니다."

- 터미널로 전환해 다음 명령의 출력 중 S19, S06 줄을 보여 줍니다.

```powershell
pnpm --filter @latchops/web exec vitest run src/lib/review/validate.test.ts
```

## 5. 사람의 승인 (4:15–5:15)

동작: S05 상세 화면으로 돌아옵니다.

1. Minji(requester)인 상태에서 **Approve**를 누릅니다. 서버가 "the requester cannot approve their own review (four-eyes rule)"로 거부하는 것을 보여 줍니다.
2. 행위자 **Seo (viewer)**로 바꿔 승인을 시도합니다. 역할 거부 메시지가 나옵니다.
3. 행위자 **Jun (approver)**로 바꿔 `complete_merge`를 선택하고 사유를 입력합니다. 예: "운영 계약 값(E6)을 유지, 비밀값은 마스킹 확인". **Approve** 클릭.
4. 결정 카드의 "bound to evidence …", "expires …"(30분), "with/without AI explanation"을 가리킵니다.

## 6. 격리 실행과 판정 (5:15–6:15)

동작: 행위자를 Minji로 되돌리고 **Request isolated run**을 클릭합니다.

> "서버는 같은 사고를 새 임시 저장소에 다시 만들고 상태를 다시 캡처해 해시를 비교합니다. 인가 함수 13개 조건을 모두 통과해야 승인된 대안의 계획 명령만 실행합니다. 원격 저장소는 없고 push도 하지 않습니다."

- `VERIFIED` 배지, 명령 표의 `source` 열(`inspect`, `plan`, `demo_orchestration`)을 가리킵니다.
- `write … # human resolution fixture (not model output)` 줄을 가리키며 "해결본은 사람이 준비한 시나리오 고정값이고 모델이 쓴 것이 아닙니다"라고 설명합니다.
- 실행 후 승인 폼과 실행 버튼이 사라진 것(1회용 승인)을 보여 줍니다.

## 7. 차단 사례와 감사 로그 (6:15–7:00)

동작: `/review`에서 **S12 Stale approval** 또는 **S16 Tampered stored plan** 결과를 보여 줍니다. 미리 실행해 둔 리뷰를 "Recent reviews"에서 엽니다.

- `BLOCKED`와 사유("repository state changed since approval (stale evidence)" 또는 "stored plan does not match the approved plan fingerprint (tampered)")를 가리킵니다.
- 아래 Audit trail에서 "hash chain intact · N events"를 보여 줍니다.

마무리 멘트:

> "모델은 설명만 하고, 실행 여부는 사람이, 실행 가능한 명령은 결정적 계획이, 성공 여부는 결정적 검증기가 정합니다. 측정 결과와 한계는 최종 보고서에 정리했습니다."

## 부록: S12/S16을 UI로 재현하는 방법

S12(상태 변경)와 S16(DB 변조)은 테스트 하네스가 서버 내부에서 조작하는 통제 시나리오입니다. UI에서 열면 일반 흐름처럼 보이며, 차단 결과는 다음 명령으로 확인합니다.

```powershell
pnpm --filter @latchops/web run test:review-e2e
```

S12는 실행 직전 재현 저장소에 커밋을 하나 더 추가합니다(`drift`). 따라서 UI에서 S12를 열어 승인하고 실행해도 `BLOCKED`가 됩니다.
