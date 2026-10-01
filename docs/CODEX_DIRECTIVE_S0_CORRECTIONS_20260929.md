# CODEX 지시서 — S0 정정 반영본 (F1~F8) — 이 문서가 충돌 부분에서 우선한다 (2026-09-29)

## §0 지위

Codex §131 / `build-artifacts/concept-20260928/s0-facts.md`(SHA-256 `8d097c903dfedcd1b78a54a9272e041a6985df1af38c0f5be40ae9eec089dc14`)의 F1~F8을 Claude(Cowork)가 코드로 직접 재검증했고 **전부 맞았다**(§132). 아래 정정은 마스터·CP1·G1·C0~C5·정전의 해당 부분보다 **우선**한다. 정본 문서는 덮어쓰지 않고 이 정정본과 정전 §5의 용어 정정만 추가한다. 불변 경계(정전 §0)는 그대로.

## F1 → C2 탄생 정책 버전화

- `SHADOW_BIRTH_POLICY_VERSION = 2`. v1(현재: 검증된 임무면 4역할 무조건 탄생)로 이미 태어난 그림자의 ID·이름·임무 이력·등급 증거는 **보존**(재계산·삭제·개명 없음).
- v2부터: `worthyVictory`가 참일 때만 탄생, 아니면 기존 그림자 성장만. `worthyVictory`의 기준은 **관측 가능한 것만**: (1) 같은 goal fingerprint의 이전 실패 후 첫 성공, (2) 결정론 verifier 실패 후 통과 이력, (3) 소유자 표시 `ownerMarkedMajor`(기존 owner 명령 경로). **산출물 크기/복잡도는 탄생 기준에서 제외**하고 별도 규모 지표(`artifactScale`)로만 기록한다.
- 테스트: `shadow-roster.test.mjs`의 "일반 첫 성공 4명 탄생·정찰자 1호·D 4명" 기대값은 **의도적으로 v2에 맞게 변경**하고 변경 이유를 테스트 주석과 실행 기록에 남긴다. 숨은 예외로 구 기대값을 통과시키지 않는다. 유지할 회귀: 증거 기반 등급·중복 방지·재시작 복구·권한 경계. v1 명부를 담은 구 state/백업 복원 시험을 추가한다.

## F2 → G1/C3 승격 경로 정정

- `promoteAbsorbedCapability`·`kirby-absorb.mjs`는 **존재하지 않는다**. 실제 승격기는 `capability-inbox.mjs`의 `promoteBrowserCapability`(browser 전용 필드, `evidenceClass:'LIVE'` 필수). 이 계약은 **보존**하며 가짜 URL/pass/LIVE 값을 채우지 않는다.
- 출처별 초안 스키마를 분리한다: `runtime/lib/absorb-inbox.mjs`(새, 순수) — `kind ∈ {research-draft(G1), local-document(K1), ledger-tool, self-beautification(C1)}` 각각 exact-key 스키마. 이 inbox는 **초안·검토 기록 전용**이며 승격 함수가 없다.
- 실행 가능한 능력이 되는 유일한 길: 초안이 **기존 manifest 형식**(`capabilities.mjs`: 필터·정렬·행 제한 op + 서로 다른 fixture 2~8개)으로 **변환된 경우에만** 기존 `importCapability → verifyCapability → activateCapability`(소유자 승인) 경로를 탄다. 변환은 사람이(소유자/Codex 검토) 하거나 결정론 변환기가 하되, 변환 실패·fixture 부재는 `noAbility`로 **absorb-inbox 기록에만** 남기고 registry에는 아무것도 넣지 않는다(C3:42 "imported-but-inactive로 넣기" 취소).
- 일반 OSS 패키지는 카피 능력이 아니라 **CP1 커넥터**(검토된 어댑터) 또는 기존 개발자 후보 경로(`static-guard` 통과)로만 연결된다. 커비의 `copyAbility`는 registry에 실제 활성 버전이 있는 능력에만 붙는다.

## F3 → 저장 스키마·백업·배고픔 이력

- `state.capabilities`는 `{version:1,entries,history}` exact 계약이라 `gaps`를 넣을 수 없다. 새 최상위 키 `state.gapScout {version:1, gaps:[], searches:[], budget:{...}}`, `state.absorbInbox {version:1, entries:[]}`, `state.quantumDecisions {version:1, entries:[]}`, `state.jevDocket {version:1, cases:[]}`, `state.connectors {version:1, entries:[]}`. Shadow entry의 `status`/`bornFromArtifactHash`, 커비 `copyAbility`/`currentAbilityId`는 각 validator의 exact-key와 fingerprint 규칙을 **버전을 올려** 확장한다.
- `backup.mjs validateState` 허용목록에 새 키 추가 + 기본값 + 이전 버전 변환. **구 state/구 백업 복원 시험을 먼저** 둔다(새 저장 엔진 없음).
- `hungerHistory`는 현재 debate에 없다. `advanceHunger`는 `drive-state.mjs`에 있다(seven-drives 아님). → 새 결정부터 debate에 `hungerSnapshot`(7값)을 기록하고, 과거 결정은 `null`로 보존. G1의 "연속 3회 top-3" 판정은 snapshot이 있는 결정만 센다. 탐욕의 느린 감쇠는 `advanceHunger`에 drive별 delta 계수를 **버전 2**로 추가(v1 값 보존, 재현 시험).

## F4 → G1 후보 개수·예산 일원화 (2-B가 기준)

- `researchGap`은 단수 `recommendation`이 아니라 `recommendations[]`. 드라이브별 **수집 상한**: greed ≤6(추천 ≥2, 근거 없으면 그 이하도 허용), gluttony ≤12(일곱 중 최대), envy ≤5, pride ≤5(추천 0건 정상), lust 정확히 1, wrath 정확히 1(원인 미특정이면 0), sloth: 재사용 경로 후 ≤3. **모든 드라이브에서 근거 없는 후보를 수량 맞추려고 만들지 않는다 — 빈 결과 허용.**
- 예산: 하루 gap 3건은 gap 상한. 별도로 `budget.searchCallsPerDay`(기본 20)·`budget.candidateFetchPerGap`(기본 상한 = 드라이브 상한)·재시도 1회. 재시작 후 같은 gapId 재검색 금지(`searches[]`에 fingerprint 기록).
- 인수 G1: "후보 3개 이상"을 "드라이브별 상한·규칙에 맞는 결과(빈 결과 포함)"로 바꾸고, 7드라이브 인수는 격리 clock으로 날짜를 분리해 시험한다. §5 테스트 목록은 2-B 교체 선언을 반영해 구 항목 4개를 제거한다.

## F5 → 양자: 계산과 제품 정책의 이름을 분리

- 이름 정정(정전 §5도 같은 문구로 정정): 낮은 확률 후보 표본 → `lowProbabilitySample`(탐색 초안, "터널링" 아님). 미관측 만료 → `expired` + `classicalFallback`("결어긋남" 아님). ID당 1회 확정 → `singleCommit`(재처리 방지, "복제 불가 정리" 아님). 소유자 클릭 → `ownerTriggeredSampling`(실행 정책, 물리적 측정 정의 아님).
- 유지되는 실제 계산: 상태벡터 시뮬레이션, Born 분포 표본, 분포 섀넌 엔트로피, QAOA 비용 위상(실제 증거 비용만).
- 현재 `quantum-statevector.mjs`는 확률만 반환하고 4큐빗 상한이다. 3후보 one-hot 결정 두 개의 공동 회로는 6큐빗 → **C5 첫 단계는 단일 결정(기존 복구 회로)의 시뮬레이션 결과·후보·소유자 확정 기록으로 한정**. 두 결정 얽힘·조건부 측정은 별도 인수(C5-b: 공동 상태/위상 API 확장 + 큐빗 상한 재검토)로 분리한다. 의존 ID나 CX 존재만으로 "얽힘"이라 쓰지 않는다.
- 종료 상태를 분리: `measured`(소유자) vs `expired`(자동). 동결 복구 계약은 "모두 같은 비용 → fallback"이므로 all-zero만이 아니라 **동일 비용 전체**를 검사한다.
- 원래 물리 개념(터널링·결어긋남)을 실제로 구현하려면 장벽/시간 진화/노이즈 채널 모형과 별도 인수가 필요하다 — 이번 범위 아님.

## F6 → L5 인과 체인 필수

- 성공 경로는 하나의 체인으로 검증한다: `gapId → absorbInbox.id → registry capabilityId/version/hash → runId → missionId → artifactHash → verdict`. 새 능력을 **실제로 사용한** 임무가 이전 실패 원인을 해소했는지 결정론 검사로 확인한다.
- `noAbility`·소유자 거부·fixture 실패·재시작/중단은 **별도 거부·복구 경로**로 각각 검증(성공 경로에 섞지 않음).
- 합성 검색은 `synthetic:true` 표지 유지. Browser LIVE 게이트를 테스트 bearer로 우회하지 않는다. L5는 구조 연결 증거이지 실검색·실모델·휴대폰 품질의 대체 증거가 아니다.

## F7 → CP1 인증·저장·healthcheck 정정

- 공통 3종(BASE_URL/API_KEY/OFFICIAL_ENDPOINT_CONFIRMED)은 **원격 커넥터 중 그 패턴을 이미 쓰는 것(JEV·SEARCH)에만**. 기존 LLM provider는 `AGENT_ENDPOINTS` 고정 endpoint + `{provider,model,apiKey}` DPAPI 스키마를 **그대로** 사용. 커넥터 descriptor는 `auth: {shape:'triple'|'llm-provider'|'token'|'toggle'|'api-key+ca'|'service-key', fields:[...]}`로 **커넥터별 계약**을 선언한다(IBM Quantum=token+instance, Telegram=token, Obsidian=api-key+ca, Supabase=service-key).
- 비밀 저장: 기존 DPAPI 암호화 함수는 재사용하되 저장 스키마는 **버전 있는 별도 타입** `connectorSecrets v1`. 공개 `status()`에는 비밀 아닌 요약만.
- 로컬 라이브러리(quantum-circuit·transformers.js 등)는 네트워크 왕복 대신 **실제 함수 self-check**(예: Bell 회로 1회, 임베딩 1건) 증거. healthcheck는 기능별 요청·응답 검증, 설정 변경/재시작/만료 시 결과 무효화, `synthetic|live` 구분을 포함.
- 상태 값에 `not_implemented` 추가: 어댑터가 없는 후보는 `needs_owner`가 아니라 `not_implemented`로 표시한다. 3GiB 규칙은 Shadow 실측 기준이므로 임베딩/음성 RAM 조건은 각자 실측.
- **CP1 첫 구현 범위**: 기존 quantum-circuit·Ollama·Obsidian 어댑터의 상태·기능 검사·소유자 패널. 신규 judge·원격 QPU·SearXNG·OpenClaw는 각 어댑터의 별도 실측 인수.

## F8 → JEV 지표·기권 규칙 정정

- `agreementRate`(기존 `matchedRealDecision` Wilson 하한 = 스케줄러와의 일치율)과 `outcomeAccuracy`(실제 성과 verdict로 확인된 정답률)를 **분리**. 결과 미확정 사건은 `pending`. 사건부 `hit`은 outcome 기준으로만 쓴다.
- 기권 규칙: "evidenceRefs 빈 배열 → abstain"은 `jev.mjs`의 의존성 0개 정상 결정과 충돌하므로 폐기. 대신 **질문별 필요한 사실의 완결성**(예: dependencyReady는 dependsOnJobIds 전부의 상태 존재)을 검사해 미완결이면 abstain.
- judge 커넥터: instructor-js는 구조화 추출, promptfoo llm-rubric은 모델+rubric 평가 — 설치·JSON 형식 통과가 판정 품질 통과가 아니다. 기존 내용 근거·결정론 검사·기권·호출 예산을 보존하고, judge 커넥터의 인수는 별도 실측(합성 rubric 사례 ≥20, 기권률·불일치 기록).

## 다음 구현 단위 (Codex 제안 그대로 채택)

1. 이 정정을 반영한 상태로 **CP1**: 기존 quantum-circuit·Ollama·Obsidian 어댑터의 상태·실제 기능 검사·소유자 패널부터. 미구현 후보는 `not_implemented`.
2. G1 typed draft(absorb-inbox)·재시작/중복방지·예산 계약 → C1/C3 연결.
3. L5는 F6 인과 체인 필수.

보고는 기존 형식(§N, VERIFIED/RAN-UNVERIFIED/BLOCKED, 실해시).
