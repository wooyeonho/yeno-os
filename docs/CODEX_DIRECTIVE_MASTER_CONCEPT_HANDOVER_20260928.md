# CODEX 마스터 지시서 — 개념 재정립 구현 인계 패킷 (2026-09-28)

> **S0 정정 우선(2026-09-29)**: Codex §131 F1~F8을 Claude가 코드로 재검증해 전부 채택했다. 충돌하는 부분은 `docs/CODEX_DIRECTIVE_S0_CORRECTIONS_20260929.md`가 이 문서·CP1·G1·C0~C5·정전보다 **우선**한다. 읽기 순서에 ⑦으로 추가. L5는 F6 인과 체인 필수. CP1 첫 범위는 기존 quantum-circuit·Ollama·Obsidian 어댑터부터.

> **Codex에게 붙여넣을 한 문단**: 저장소 `docs/` 아래 다음 문서를 이 순서로 읽고 구현하라. ① `BLACKHOLE_CONCEPT_CANON_20260928.md`(개념 정전) ② `BLACKHOLE_AUTONOMY_CRITERIA_20260928.md`(묻지 않고 진행하는 조건) ③ `CODEX_DIRECTIVE_CONNECTOR_PANEL_20260928.md`(CP1) ④ `CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`(G1, 2-A/2-B 포함) ⑤ `CODEX_DIRECTIVE_CONCEPT_INTENSITY_20260928.md`(C0~C5) ⑥ `CODEX_DIRECTIVE_OSS_VOICE_SEARCH_20260928.md`(음성·검색 OSS, §124 보정본). 구현 순서는 이 마스터 지시서 §2를 따르고, 단계마다 `docs/CLAUDE_EXECUTION_STATE.md`에 다음 §번호로 VERIFIED/RAN-UNVERIFIED/BLOCKED와 실제 해시를 보고하라. 정전 §0의 불변 경계는 어떤 단계에서도 바꾸지 않는다. 커밋/push는 하지 않는다.

## §0 이 문서의 역할

2026-09-28 소유자 지시로 재정립한 개념(칠죄종 호문쿨루스·그림자군단·커비·JEV·양자·자비스·매혹 자기미화·"딸깍 연결")을 **하나의 구현 순서**로 묶는다. 상세 스펙은 각 지시서에 있고, 여기서는 순서·의존·인수·보고만 정한다. 같은 내용이 Obsidian Vault `01_DRAFTS/20260928_BLACKHOLE_CONCEPT_CANON/`에 저장돼 있다(해시는 §129·§130 참조).

**불변 경계(정전 §0, 반복)**: `authorizesDispatch:false` · 소유자 최종 승인 게이트(실제 코드에 붙이는 순간) · `static-guard.mjs` · `00_INBOX_RAW` 읽기전용 · `solo-leveling.mjs`·`recovery-one-of-qpu.mjs` 무수정 · 근거 없는 등급/확률/난이도/비용/아름다움 조작 금지 · 실패를 성공으로 포장 금지 · 키는 소유자만 · 커밋/push 없음. 강렬해지는 것은 내부 판단·표현이지 실행 권한이 아니다.

## §1 읽기 순서와 각 문서의 역할

| 순서 | 문서 | 역할 |
|---|---|---|
| 1 | `docs/BLACKHOLE_CONCEPT_CANON_20260928.md` | 왜·무엇: 각 개념의 원문 강도와 불변 경계 |
| 2 | `docs/BLACKHOLE_AUTONOMY_CRITERIA_20260928.md` | 동종 사안은 묻지 않고 진행하는 6조건, 여전히 묻는 항목 |
| 3 | `docs/CODEX_DIRECTIVE_CONNECTOR_PANEL_20260928.md` | CP1: 커넥터 레지스트리·GUI 패널·"1회 시험 연결". 두뇌·근육은 OSS 어댑터 |
| 4 | `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md` | G1: 칠죄종 7개가 각자 다르게 결핍을 찾아오는 검색 루프(2-B 극단화, 매혹 자기미화 연결) |
| 5 | `docs/CODEX_DIRECTIVE_CONCEPT_INTENSITY_20260928.md` | C0~C5: 매혹 자기미화·그림자 "일어나라"·커비 카피 능력·양자 기록·JEV 사건부 |
| 6 | `docs/CODEX_DIRECTIVE_OSS_VOICE_SEARCH_20260928.md` | 음성(whisper.cpp/Piper 라이선스 보정)·SearXNG — CP1의 voice/search 커넥터 후보 |
| 참고 | `docs/CODEX_DIRECTIVE_LIVING_SYSTEMS_20260927.md`, `docs/CODEX_HANDOFF_20260927.md` | 기존 7계통 지시서·우선순위(변경 없음, P0 소유자 행동 항목 유지) |

## §2 구현 순서 (의존 관계 기준)

| 단계 | 내용 | 의존 | 인수 코드 | 증거 파일(모두 `build-artifacts/concept-20260928/`) |
|---|---|---|---|---|
| **S0** | C0 사실확인 + CP1 §1 사실확인. 새 패턴 발명 금지 확인 보고 | — | — | `s0-facts.md` |
| **S1 CP1** | 커넥터 레지스트리 + GUI 연결 패널 + healthcheck. 로컬 기본(quantum-circuit·Ollama/transformers.js·Obsidian 플러그인) 실측, 클라우드는 "내 입력 필요" | S0 | **CP1** | `cp1-registry.json`, `cp1-healthchecks.json`, `cp1-panel.png`, `cp1-full-regression.txt` |
| **S2 G1** | `gap-scout.mjs` + `YENO_SEARCH_*` 어댑터(CP1 search 커넥터 사용) + 7드라이브 차별 행동(2-B) + 커비 `absorbed-opensource` 초안 | S1 | **G1** | `g1-gap.json`, `g1-scout-report.json`(드라이브별 7건), `g1-inbox.json`, `g1-full-regression.txt` |
| **S3 C1** | 매혹 자기미화 `lust-mirror.mjs`, `kind:'self-beautification'` | S2(inbox kind 확장 공유) | **C1** | `c1-findings.json`, `c1-inbox.json`, `c1-drawer.png` |
| **S4 C2** | 그림자 "일어나라": `worthyVictory`·`ariseAttempts`·정체성 명명·`stored`·계급 표시·`lordLevel` 상한·그림자 교환 UI. S1+ 테스트 유지 | S0 | **C2** | `c2-arise-worthy.json`, `c2-arise-failed.json`, `c2-roster.json`, `c2-drawer.png`, `c2-full-regression.txt` |
| **S5 C3** | 커비 카피 능력: `inhale`·`noAbility`·`copyAbility{hat}`·`currentAbilityId`·`star`·믹스·헬퍼. K1 함께 닫아도 됨 | S2 | **C3**(+K1) | `c3-inhale.json`, `c3-abilities.json`, `c3-topbar.png`, `c3-full-regression.txt` |
| **S6 C5** | 양자 결정 기록 `quantum-decision.mjs`(관측 전 선택값 부재·소유자 측정 1회·얽힘·엔트로피·터널링·결어긋남). 회로 실행은 CP1 quantum 커넥터 | S1 | **C5** | `c5-superposed.json`, `c5-measured.json`, `c5-entangled.json`, `c5-decohered.json`, `c5-drawer.png`, `c5-full-regression.txt` |
| **S7 C4** | JEV 사건부 `jev-docket.mjs`(사건·적중·기권·dissent·관할 확장). 판정은 CP1 judge 커넥터, 없으면 v0 규칙셋 | S1, S4, S5 | **C4** | `c4-docket.json`, `c4-full-regression.txt` |
| **S8 L5** | 통합 한 바퀴(§3) | S1~S7 | **L5** | `l5-loop.json`, `l5-jarvis.png`, `l5-obsidian-export.md`, `l5-full-regression.txt` |

순서 변경은 Codex 재량이되 이유를 기록한다. 각 단계는 **추가(additive)**이고 직전 전체 회귀(§122 기준 1,239건 0 실패)를 깨지 않아야 한다. 무거운 설치·기동(SearXNG·OpenClaw·로컬 모델)은 §112 원칙대로 겹치지 않게.

## §3 통합 인수 L5 — 엔진 한 바퀴 (격리 코어·합성 커넥터·모델 없음)

1. 합성 결정 3회로 특정 드라이브(예: envy)가 top-3에 연속 등장 → `detectGaps` gap 1건, envy 비교 직후 배고픔 급등 기록.
2. `researchGap`이 CP1의 합성 search 커넥터로 드라이브별 편향 질의 → 보고서(envy: 비교 대상 방법만, 비하 문구 0).
3. 커비 inbox에 `absorbed-opensource` 초안 1건 → **활성화 안 됨** → 테스트 bearer로 소유자 승인 → `inhale` → 능력 1건(모자 표시) 또는 정직한 `noAbility`.
4. 같은 목표에서 이전에 실패했던 임무를 첫 성공 → `worthyVictory` → "일어나라" → `<목표>의 정찰자` 탄생, 계급 표시. 잡몹 임무 1회는 탄생 없이 성장만.
5. 그 임무의 JEV 답이 사건부에 사건으로 기록, 실제 스케줄러 결정과 대조해 hit/dissent 1건 이상.
6. 복구 후보 3개의 양자 결정이 관측 전 중첩(선택값 없음) → 화면에 분포·엔트로피 → 소유자 측정 1회 → 붕괴 → 재측정 거부.
7. 매혹이 일부러 넣은 가로 넘침을 감지 → 자기미화 초안 1건(활성화 안 됨).
8. 자비스 서랍에 위 사건들이 순서대로 힌트로 보임(캡처, CJK 절단·가로 넘침 없음).
9. 이 한 바퀴의 요약이 `obsidian-exporter.mjs` 기존 경로로 격리 Vault 사본에 export(실 Vault 무수정).
10. 전체 회귀 0 실패, `git diff --check` 통과.

## §4 보고 형식

단계마다 `docs/CLAUDE_EXECUTION_STATE.md`에 `## §N — 날짜 Codex: 제목`, **VERIFIED / RAN-UNVERIFIED / BLOCKED** 구분, 모든 증거 파일 SHA-256, 전체 회귀 건수(총/통과/실패/스킵), 저장소 branch/HEAD 확인, 커밋/push 없음 명시. 지시서와 실제 코드가 다르면(§118·§124처럼) 지시서를 억지로 따르지 말고 **불일치를 먼저 보고**한다 — Claude(Cowork)가 지시서를 정정한다.

## §5 하지 말 것 (요약)

정전 §0 위반 일체 · 근거 없는 수치 · 새 실행 엔진/활성화 경로/스케줄러 · 기존 통과 테스트 파괴·우회 · 특정 provider 하드코딩 · 왕복 없는 "연결됨" · 키 노출 · OSS 소스 병합(AGPL/GPL은 분리 프로세스만) · 한 단계 인수 없이 다음 단계 "완료" 표시.
