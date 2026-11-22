# 참고문헌

모든 항목은 2026-11-19에 링크로 존재와 내용을 확인했습니다. 본 프로젝트는 사용자 인터뷰나 설문을 수행하지 않았으며, 아래 문헌은 **설계 근거**로만 인용합니다. 문헌의 수치는 해당 연구의 결과이지 LatchOps의 측정값이 아닙니다.

## 국내 법령·정부 지침

**[R1] 인공지능 발전과 신뢰 기반 조성 등에 관한 기본법(인공지능기본법)**, 법률 제20676호, 2025. 1. 21. 제정, 2026. 1. 22. 시행. 국가법령정보센터.
<https://www.law.go.kr/LSW/lsInfoR.do?efYd=20260122&lsiSeq=268543>
- 제31조: 생성형 AI를 이용한 제품·서비스는 AI 기반이라는 사실을 사전 고지하고 결과물이 생성형 AI로 생성되었음을 표시해야 함.
- 제34조 제1항: 고영향 AI 사업자의 책무로 위험관리방안, 최종결과·주요 기준의 설명 방안, 이용자 보호 방안, **사람의 관리·감독**, 조치 내용 문서의 작성·보관을 규정.
- 본 프로젝트와의 관계: Git 병합 복구 도구는 법 제2조 제4호의 고영향 영역에 해당하지 않습니다. 다만 "설명 + 사람의 관리·감독 + 기록 보관" 구조를 설계 기준으로 참고했습니다. UI의 "local model" 표시, 설명 근거 인용, 승인 기록, 해시 체인 감사 로그가 이에 대응합니다.

**[R2] 과학기술정보통신부, 「인공지능기본법 1월 22일부터 시행」 보도자료**, 2026. 1. 21.
<https://www.korea.kr/news/policyNewsView.do?newsId=148958460>
- 시행령에서는 최종 의사결정 과정에 사람이 개입하는 경우를 통제 가능한 것으로 보고 고영향 AI 판단에서 고려한다고 설명합니다(KDI 경제정보센터 게시 보도자료 원문: <https://eiec.kdi.re.kr/policy/callDownload.do?dtime=20260121163501&filenum=1&num=276147>).
- 본 프로젝트와의 관계: 모델은 실행을 결정하지 않고, 사람(승인자)이 결정합니다.

**[R3] 과학기술정보통신부, 「고영향 인공지능 사업자 책무 가이드라인」** (한국지능정보사회진흥원 게시 파일, 파일명 날짜 2026-01-21).
<https://www.nia.or.kr/common/board/Download.do?bcIdx=28987&cbIdx=99835&fileNo=23>
- 책무 고시(안) 제7조: 개발 단계에서 사람이 AI 동작에 개입할 수 있는 **기준**과 **방법**(긴급 정지 등)을 마련하고, 운영 단계에서 오류 점검 계획을 수립해야 함. "사람의 관리·감독"은 상시 감시가 아니라 위험 수준에 따른 상시 또는 예외적 개입을 의미한다고 설명.
- 본 프로젝트와의 관계: 개입 기준을 결정적 인가 조건 13개(`authorize.ts`)로 명시했고, 개입 방법으로 거절·동의 철회·승인 만료를 구현했습니다.

**[R4] 국가정보원·국가보안기술연구소, 「챗GPT 등 생성형 AI 활용 보안 가이드라인」**, 2023. 6. 29.
<https://www.nis.go.kr/CM/1_4/view.do?seq=238> (국가사이버안보센터 배포본: <https://www.ncsc.go.kr:4018/main/cop/bbs/selectBoardArticle.do?bbsId=InstructionGuide_main&nttId=54340&pageIndex=1>)
- 대표 보안 위협으로 잘못된 정보(환각), 데이터 유출, API 취약점(데이터와 명령 사이의 불분명한 경계, 악의적 프롬프트 주입)을 제시하고, 비공개·민감 정보 입력 금지와 생성물 재검증을 권고.
- 본 프로젝트와의 관계: 모델 전송 전 비밀값 마스킹·재검사, 로컬 모델 사용, 저장소 텍스트를 "신뢰할 수 없는 데이터"로 표시, 출력 검증기를 두었습니다.

**[R5] 개인정보보호위원회, 「생성형 인공지능(AI) 개발·활용을 위한 개인정보 처리 안내서」**, 2025. 8.
<https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000.Updated&nttId=11439>
- 생성형 AI 수명주기 단계별 개인정보 처리 기준과 안전조치를 제시하며, 서비스형 LLM 활용, 기성 LLM 활용, 자체 개발 같은 유형별 리스크 경감을 안내.
- 본 프로젝트와의 관계: 기성 오픈소스 LLM(Qwen2.5)을 로컬에서 실행하는 유형입니다. 이메일·홈 경로 마스킹, 목적별 동의(증거 해시 단위), 동의 철회를 구현했습니다.

## 국내 연구 (한국어 LLM 환각·RAG)

**[R6] Jaehyung Seo, Heuiseok Lim (고려대학교), "K-HALU: Multiple Answer Korean Hallucination Benchmark for Large Language Models"**, ICLR 2025.
<https://proceedings.iclr.cc/paper_files/paper/2025/file/cfcadfe84ee49908cde1fc2992c38d20-Paper-Conference.pdf>
- 한국어 지식 문서 기반 환각 탐지 벤치마크입니다. 논문은 7B–13B 오픈소스 모델의 평균 정확도가 29.05%로 낮다고 보고합니다.
- 본 프로젝트와의 관계: 소형 로컬 모델(3B)의 출력을 신뢰하지 않고 **검증기를 통과한 주장만 표시**하는 fail-closed 설계의 근거입니다.

**[R7] 박종민, 서원후, 최현수, 이승권, 박호균, "Improving Faithfulness and Mitigating Hallucinations in RAG Systems Through Hierarchical Metadata Retrieval and Prompt Constraint Mechanisms"**, 아시아태평양융합연구교류논문지(KCI).
<https://www.kci.go.kr/kciportal/mobile/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003399344>
- Qwen2.5-14B와 Ragas로 평가했습니다. 논문은 검색 범위 축소와 근거 제약 프롬프트를 결합했을 때 Basic RAG 대비 Faithfulness가 0.7366에서 0.8926으로 높아졌다고 보고합니다.
- 본 프로젝트와의 관계: "핵심 증거 고정(pinned) + BM25로 범위 축소 + 인용 강제 프롬프트" 구성의 근거입니다.

**[R8] 박예린, 조준수, "자기 검증과 외부 지식 활용의 통합을 통한 대형 언어 모델에서의 환각 현상 완화"**, 한국정보과학회(KCI).
<https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003297258>
- Chain-of-Verification과 RAG를 결합한 CoVe-RAG가 단일 기법보다 환각 완화에 유리하다고 보고합니다.
- 본 프로젝트와의 관계: 모델 자기 검증 대신 **외부(결정적) 검증기**로 생성 결과를 확인하는 방향을 택한 배경입니다.

**[R9] 이호웅, 선복근, "RAG 시스템에서 고정 크기 및 문장 단위 청킹 전략의 평가: KorQuAD1.0 데이터셋 활용 한국어 사례"**, 한국차세대컴퓨팅학회 논문지 22(1), pp.84–96, 2026. DOI: 10.23019/kingpc.22.1.202602.007.
<https://www.kci.go.kr/kciportal/landing/article.kci?arti_id=ART003311446>
- 논문은 검색 품질 향상이 생성 정확도 향상으로 직결되지 않는 "검색–답변 괴리"를 보고합니다(200자 고정 청킹 68.8%).
- 본 프로젝트와의 관계: RAG가 항상 낫다고 가정하지 않고, **직접 주입과 같은 조건에서 측정 비교**한 이유입니다.

## 국외 기초 문헌

**[R10] P. Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"**, NeurIPS 2020. <https://arxiv.org/abs/2005.11401>

**[R11] N. F. Liu et al., "Lost in the Middle: How Language Models Use Long Contexts"**, TACL 2024. <https://arxiv.org/abs/2307.03172>
- 긴 컨텍스트 중간에 있는 정보를 모델이 덜 활용한다는 결과입니다. 직접 주입 방식의 위험 근거입니다.

**[R12] K. Greshake et al., "Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection"**, AISec 2023. <https://arxiv.org/abs/2302.12173>
- 저장소 텍스트(커밋 메시지·파일 내용)를 통한 간접 프롬프트 인젝션 시나리오(S06)의 근거입니다.

**[R13] OWASP, "Top 10 for Large Language Model Applications"** (LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM06 Excessive Agency). <https://owasp.org/www-project-top-10-for-large-language-model-applications/>

**[R14] S. Robertson, H. Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond"**, Foundations and Trends in IR 3(4), 2009. <https://doi.org/10.1561/1500000019>

**[R15] Git 공식 문서**: git-merge(충돌 표시·해결·`--abort`), git-status(짧은 형식, `u` 항목), git-reflog. <https://git-scm.com/docs>
