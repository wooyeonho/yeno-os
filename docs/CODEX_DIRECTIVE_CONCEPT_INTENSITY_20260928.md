# CODEX 지시서 — 개념 극단화 C0~C5: 그림자군단·커비·JEV·양자·매혹 자기미화 (2026-09-28)

## 0. 배경과 순서

> **정정(2026-09-28, 소유자: "JEV는 유명 오픈소스 따오면 되고 양자·임베딩·딥러닝·오픈클로도 나중에 내가 딸깍 연결할 것만 남겨라")**: C4(JEV)·C5(양자)의 **판정·회로 실행 내부는 `docs/CODEX_DIRECTIVE_CONNECTOR_PANEL_20260928.md`의 커넥터(유명 OSS 어댑터 + 소유자 딸깍 연결)가 담당**한다. 이 문서의 C4/C5에서 BLACKHOLE이 직접 만드는 것은 사건부(docket)·관측 전 중첩 기록 같은 **기록 계층**뿐이다. C1·C2·C3은 BLACKHOLE 고유 메커니즘이라 그대로.

개념 원본은 `docs/BLACKHOLE_CONCEPT_CANON_20260928.md`(SHA-256은 실행 기록 §128 참조). 소유자 지시: "더 오버해서 원문 그대로의 개념을 적용해야 해 … 코덱스에 지시하자." 이 지시서는 그 정전을 **실제 동작 차이**로 옮기는 구현 지시서다. 칠죄종 7개의 검색 행동은 G1 지시서 2-B에 이미 있으므로 여기서는 반복하지 않는다(단 C1의 매혹 자기미화는 G1과 별도 격발 조건이라 여기서 다룬다).

**불변 경계(정전 §0)** — 모든 단계에 공통: `authorizesDispatch:false`, 소유자 최종 승인 게이트, `static-guard.mjs`, `00_INBOX_RAW` 읽기전용, `solo-leveling.mjs`·`recovery-one-of-qpu.mjs` 무수정, 근거 없는 등급·확률·난이도·비용 조작 금지, 실패를 성공으로 포장 금지, 커밋/push 없음. 각 단계는 **추가(additive)**여야 하고 기존 전체 회귀(직전 §122 기준 1,239건 0 실패)를 깨지 않아야 한다.

권장 순서: **C0(읽기) → C1(매혹 자기미화, 작음) → C2(그림자 "일어나라") → C3(커비 카피 능력) → C5(양자 일반화) → C4(JEV 사건부)**. 순서 변경은 Codex 재량이되 이유를 기록한다. 각 단계는 별도 §N 보고.

## C0. 사실 확인(코드 작성 전, 보고서에 남길 것)

- `shadow-roster.mjs`의 `extractShadows`/`verifiedMission`/`EXTRACTABLE_ROLES`/`LABEL`, `shadow-growth.mjs`의 XP 규칙, `leveling-evidence.mjs`의 `shadow` 엔진(§122), `kirby.mjs`(45줄), `capability-inbox.mjs`의 `ENTRY_KEYS`(현재 `kind`는 `browser-readonly` 하나만 허용됨 — G1의 `absorbed-opensource`도 아직 없다), `jev.mjs`의 `JEV_QUESTIONS`/`DECISION_STATUSES`, `jev-calibration.mjs`의 Wilson 하한, `quantum-statevector.mjs`의 4큐빗 제한과 `simulateRestrictedQasm3`, `recovery-one-of-qpu.mjs`의 동결 계약.
- 각 단계가 실제로 어떤 필드를 읽고 어디에 쓰는지(정확한 state 경로)를 먼저 적는다. 새 저장 방식을 발명하지 말고 기존 패턴(예: `driveState`, `shadowRoster`, `capabilities.entries`, `jev` 기록)을 확장한다.

## C1. 매혹 자기미화(自己美化) — 두 번째 격발 조건

- 새 파일 `runtime/lib/lust-mirror.mjs`(가칭): BLACKHOLE 자신의 표면을 검사하는 순수 함수 `inspectOwnBeauty(state, artifacts, env)` → `{uglinessScore, findings:[{kind, where, evidence}]}`. 측정 가능한 대리 지표만 쓴다: (a) 최근 화면 캡처/DOM 검사에서 가로 넘침·CJK 절단(이미 §122 QA에 이 검사가 있음, 재사용), (b) `git diff --check`·lint/format 경고 수(있는 도구만, 새 lint 도입 금지), (c) 명명 불일치(같은 개념에 두 이름) 목록, (d) 접근성 대비 실패(있는 검사만). 근거 없는 "미적 점수"는 금지 — 각 finding은 파일/좌표/캡처 해시로 증거를 가진다.
- 격발: `uglinessScore`가 기준을 넘으면 `driveState.hunger.lust`를 올리고(기존 배고픔 갱신 경로 재사용), **자기미화 초안**을 `capability-inbox`에 `kind:'self-beautification'`으로 넣는다(ENTRY_KEYS 확장, 활성화 경로는 기존 것 재사용, 자동 활성 금지). 초안 내용: 디자인 개선안 또는 리팩터/명명 정리 제안 + 예상 대가(`tradeoff`, 근거 없으면 비움).
- JARVIS: 초안 생성 시 `hint("나 좀 더 예뻐지고 싶어: <finding 요약> — 승인 대기")`.
- 테스트 `runtime/test/lust-mirror.test.mjs`: `ugliness_findings_require_evidence_refs`, `lust_hunger_rises_only_when_score_exceeds_threshold`, `self_beautification_draft_never_auto_activates`, `no_finding_without_a_real_measurable_signal`.
- 인수 C1: 격리 코어에서 일부러 넘침이 있는 화면/불일치 명명을 만들어 → finding 생성 → 매혹 배고픔 상승 → inbox 초안 1건 → 활성화 안 됨. 증거 `c1-findings.json`, `c1-inbox.json`, `c1-drawer.png`.

## C2. 그림자군단 "일어나라" — 가치 있는 승리, 정체성, 실패, 보관, 계급

- **가치 있는 승리 판정** `worthyVictory(state, missionId)` (새 순수 함수, `shadow-roster.mjs` 또는 새 `shadow-arise.mjs`): 실제 저장 필드에서만 계산 — (1) 같은 goal fingerprint의 이전 실패 임무 존재 후 첫 성공, (2) 결정론 verifier가 1회 이상 실패 후 통과한 이력, (3) 소유자 표시(`ownerMarkedMajor:true`, 기존 owner 명령 경로로만 설정), (4) 산출물 크기/복잡도가 현재 명부 중앙값 초과. 하나라도 참이면 worthy. 계산 근거를 `worthyEvidence`로 남긴다.
- **추출 조건 변경**: `extractShadows`는 worthy가 아니면 새 그림자를 낳지 않고 기존 그림자만 성장(`grown`)시킨다. worthy이면 지금처럼 4역할 추출 시도.
- **추출 실패(Arise 실패)**: 시도는 `ariseAttempts`에 기록. 의미 검증 `uncertain`·재검증 시 산출물 해시 불일치·`resolveVerifiedResult` 실패면 `ariseFailed:true`로 정직하게 남기고 최대 3회 재검증 후 확정. 실패한 시도는 삭제하지 않는다.
- **정체성 명명**: 새 그림자 이름 기본값을 `${LABEL[role]} ${ordinal}호`에서 `${goalKeyword}의 ${LABEL[role]}`로 바꾼다(goalKeyword는 목표 문자열에서 결정론적으로 추출, 24자 제한·NFC·제어문자 금지 기존 규칙 유지, 충돌 시 ordinal 접미). 소유자 개명(`renameShadow`)은 그대로. 그림자 entry에 `bornFromArtifactHash` 추가(능력 지문).
- **보관**: entry에 `status:'active'|'stored'`. `storeShadow`/`recallShadow` 순수 함수. 보관된 그림자는 §122의 `preferredShadowId` 후보에서 제외. 삭제 경로 없음. `validateShadowRoster` 확장(기존 fingerprint 규칙 유지).
- **계급 표시**: `rankTitle(grade)` = E 일반병·D 정예병·C 기사·B 정예기사·A 원수·S 대원수 — 표시 전용. `solo-leveling.mjs` 무수정.
- **군주 레벨과 명부 상한**: `lordLevel(state)` = 검증된 임무 총수에서 결정론적으로 파생(예: floor(log2(n))+1 같은 단순·기록된 규칙, 버전 명시). `rosterCap = f(lordLevel)`; 상한 초과 시 새 그림자는 태어나지 않고 이유 기록. `MAX_ACTIVE_MISSIONS_PER_PROJECT` 무수정.
- **그림자 교환**: JARVIS 서랍에서 그림자 클릭 → 그 그림자의 현재 임무 화면으로 이동(UI만).
- 테스트 `runtime/test/shadow-arise.test.mjs`: `routine_verified_mission_grows_but_does_not_birth`, `worthy_victory_requires_real_stored_evidence_not_a_flag_alone`, `arise_can_fail_and_failure_is_recorded_not_hidden`, `arise_gives_up_honestly_after_3_attempts`, `shadow_name_inherits_defeated_goal_keyword`, `stored_shadow_is_excluded_from_preferred_assignment_but_never_deleted`, `rank_titles_are_display_only_and_grade_contract_untouched`, `roster_cap_follows_lord_level_and_refuses_beyond_cap_with_reason`, `existing_s1plus_tests_still_pass`.
- 인수 C2(격리 코어·합성 provider): 잡몹 임무 3회 → 그림자 0명 탄생·기존만 성장 → 같은 목표 실패 후 첫 성공(worthy) → "일어나라" → `<목표>의 정찰자` 탄생 → 일부러 uncertain 판정 임무에서 Arise 실패 기록 → 보관/소환 → 계급 표시 → 화면 캡처. 증거 `c2-arise-worthy.json`, `c2-arise-failed.json`, `c2-roster.json`, `c2-drawer.png`, `c2-full-regression.txt`.

## C3. 커비 카피 능력 — 흡입·무능력·모자·한 번에 하나·튀어나오기·믹스·헬퍼

- `capability-inbox.mjs` `ENTRY_KEYS`의 `kind`를 열거형으로 확장: `browser-readonly | absorbed-local-document(K1) | absorbed-opensource(G1) | absorbed-ledger-tool | self-beautification(C1)`. 활성화 경로는 기존 `promoteAbsorbedCapability` 하나만.
- **흡입 후보 넓히기 + 무능력**: `inhale(state, source)` 순수 함수 — 완료 산출물/G1 초안/K1 문서/원장 "도구" 버킷 항목을 받아 기존 `importCapability`+`verifyCapability` 픽스처를 돌린다. 픽스처가 없거나 실패하면 `noAbility:true`로 정직하게 기록(기존 "imported but inactive" 상태 재사용). 새 판정 기준 발명 금지.
- **카피 능력 정체성**: 활성 능력 entry에 `copyAbility {name, sourceKind, sourceHash, hat}`. `hat`은 결정론적(sourceHash에서 파생된 글리프/색 인덱스). JARVIS 상단바에 "커비: <hat> <name>" 표시.
- **한 번에 하나**: `state.kirby.currentAbilityId` 슬롯. `equipAbility(state, id)`는 활성 능력 중에서만 선택. 나머지는 "보관 능력". 실행 엔진 변경 없음 — 선택·표시 계층.
- **튀어나오기**: 활성 능력의 실행 검증 실패가 연속 N회(기록된 규칙, 기본 3)면 `star` 상태로 비활성(기존 비활성 경로 재사용). 재검증 통과 시 다시 줍기(기존 재활성 경로). 새 활성화 경로 금지.
- **믹스**: `leveling-evidence`가 세는 `compositions` 증거가 실제로 있을 때만 `mixedAbility {name: A+B, evidenceRef}` 표시. 증거 없이는 생성 안 됨.
- **헬퍼**: `linkAbilityToShadowRole(state, abilityId, role)` — 연결 기록만. 실행 경로 무수정.
- 테스트 `runtime/test/kirby-copy.test.mjs`: `most_inhales_yield_noAbility_honestly`, `copy_ability_requires_fixture_pass_not_a_flag`, `only_one_current_ability_at_a_time`, `ability_pops_out_after_N_verified_failures_and_can_be_repicked`, `mixed_ability_requires_real_composition_evidence`, `helper_link_does_not_change_execution_path`, `no_new_activation_path_introduced`.
- 인수 C3(격리 코어): 흡입 5건 → 능력 1~2건, 나머지 무능력 → 모자 표시 → 슬롯 교체 → 일부러 실패 3회 → 튀어나옴 → 재검증 → 다시 장착 → 조합 증거 있는 두 능력 → 믹스 표시. 증거 `c3-inhale.json`, `c3-abilities.json`, `c3-topbar.png`, `c3-full-regression.txt`. (K1 인수와 겹치면 K1을 이 안에서 함께 닫아도 된다 — 단 K1 증거 파일명은 그대로 남긴다.)

## C4. JEV 사건부 — 판례·기권·반대의견·관할 확장

- `jev-docket.mjs`(새, 순수): 각 JEV answer를 `case {id, questionId, answer, confidence, decisionStatus, evidenceRefs, at}`로 기록. 실제 스케줄러 결정·결과가 확정되면 `outcome {actual, hit:boolean}` 갱신. 질문 유형별 적중률·기권률·dissent 수를 `/api/state.jev.docket`에 노출. Wilson 하한은 기존 `jev-calibration.mjs` 재사용.
- **기권 강제**: `evidenceRefs`가 비거나 얇으면(규칙 명시) `decided`를 금지하고 `abstain`. 기권률 노출.
- **dissent**: JEV 답 ≠ 실제 스케줄러 결정인 사건은 `dissent:true`로 표시·별도 목록. 기록만.
- **관할 확장**: `JEV_QUESTIONS`에 `absorbWorthy`(boolean), `ariseWorthy`(boolean), `candidateLicenseOk`(boolean) 추가 — 각각 C3/C2/G1의 실제 판정 옆에 비교 기록만. `authorizesDispatch:false` 고정. 실제 판정 경로 대체 금지.
- 테스트 `runtime/test/jev-docket.test.mjs`: `every_answer_becomes_a_case`, `thin_evidence_forces_abstain`, `dissent_is_recorded_when_jev_differs_from_real_scheduler`, `docket_hit_rate_uses_wilson_lower_bound_from_existing_module`, `new_questions_never_authorize_dispatch`.
- 인수 C4(격리): 임무 10회 → 사건 ≥10 → 최소 1건 dissent → 얇은 증거 사건에서 abstain → `/api/state.jev.docket` 표시. 증거 `c4-docket.json`, `c4-full-regression.txt`.

## C5. 양자 일반화 — 관측 전 중첩, 관측 시 붕괴, 간섭·얽힘·엔트로피·터널링·결어긋남

- `quantum-decision.mjs`(새): 한 결정을 `{id, candidates(≤4), evidenceCosts, entangledWith?, createdAt, measuredAt:null}`로 저장. **선택값은 측정 전에 존재하지 않는다**(필드 자체 없음). 회로는 기존 `buildRecoveryOneOfCircuit`을 일반 one-of-N으로 재사용하거나, 동결 계약을 건드리지 않는 새 빌더를 `quantum-statevector.mjs` 옆에 둔다. 비용은 실제 기록된 증거값에서만; 전부 0이면 거부(§111 원칙).
- **측정 = 소유자 관측**: `/api/quantum/measure`는 소유자 인증 경로에서만 호출되고, 그때 고정 seed로 1회 표본 → `measuredAt`·`outcome` 기록. 이후 재측정 금지(복제 불가).
- **얽힘**: state에 실제 의존(예: 그림자 배정 ↔ 복구 조치)이 기록된 두 결정만 CX로 얽는다. 의존 없으면 얽지 않는다.
- **엔트로피**: 측정 분포의 섀넌 엔트로피를 `uncertainty`로 보고, JARVIS에 "얼마나 날카로운 결정인가" 표시.
- **터널링**: 표본이 낮은 진폭 후보를 뽑으면 `tunneled:true`로 표시 — 초안으로만(`authorizesDispatch:false`).
- **결어긋남**: `decoherenceAfterMs` 경과 시 측정 없이 고전 fallback(기존 경로)으로 붕괴, `decohered:true` 기록.
- 테스트 `runtime/test/quantum-decision.test.mjs`: `no_selected_value_exists_before_measurement`, `measurement_only_via_owner_path_and_only_once`, `interference_cancels_amplitude_when_evidence_conflicts`, `entanglement_only_with_real_recorded_dependency`, `entropy_reported_from_actual_distribution`, `tunneled_sample_is_draft_only_and_never_dispatches`, `unmeasured_decision_decoheres_to_classical_fallback`, `all_costs_zero_is_refused_not_invented`.
- 인수 C5(격리): 3후보 결정 생성 → 화면에 "미결정+분포" → 소유자 측정 1회 → 붕괴 → 재측정 거부 → 얽힌 두 결정에서 한쪽 측정이 다른 쪽 제약 → 결어긋남 만료 케이스. 증거 `c5-superposed.json`, `c5-measured.json`, `c5-entangled.json`, `c5-decohered.json`, `c5-drawer.png`, `c5-full-regression.txt`.

## 6. 하지 말 것

- 정전 §0의 불변 경계 위반 일체.
- 난이도·가치·아름다움·확률·비용을 근거 없이 지어내기. 근거 없으면 필드를 비운다.
- 새 실행 엔진·새 활성화 경로·새 스케줄러 만들기(전부 기존 경로 위의 판정·표시·기록 계층).
- 이미 통과한 S1+ 테스트를 깨거나 우회하기 — C2는 S1+ 위에 추가된다.
- 한 단계의 인수 증거 없이 다음 단계로 "완료" 표시.

## 7. 보고 형식

기존과 동일. 단계마다 `docs/CLAUDE_EXECUTION_STATE.md`에 다음 번호로, VERIFIED/RAN-UNVERIFIED/BLOCKED, 실해시. Claude(Cowork)가 파일·해시 직접 대조로 재검증한다.
