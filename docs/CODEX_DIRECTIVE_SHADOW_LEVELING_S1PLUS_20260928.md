# CODEX 지시서 — S1+: 그림자 등급을 실제 증거에 연결 + 등급이 실제로 영향을 주게 (2026-09-28)

## 0. 배경

§109(S1)에서 명부·성장 이력은 실제 Shadow job에 연결됐지만, `shadowRank(_state, entry)`는 매개변수 이름에 언더스코어가 붙어있는 그대로 `state`를 쓰지 않고 항상 `E`만 반환한다(근거 없이 등급을 매기지 않겠다는 정직한 설계였음, §108/§109에 기록됨). 이번 지시서는 그 근거를 실제로 연결한다 — 소유자의 "최상급으로 만들어달라"는 요청에서, 이미 지어둔 뼈대(명부·성장 이력) 중 등급만 항상 E로 멈춰 있어 "레벨업"이라는 이름값을 못 하는 부분이 가장 눈에 띄는 격차라고 판단했다.

## 1. 먼저 사실 확인 (코드 작성 전)

`runtime/lib/leveling-evidence.mjs`의 `ENGINES = {capability:'capabilities', code:'codeWorkshop'}`가 실제로 어떻게 쓰이는지 — `executionsFromState`/`interventionsFromState`가 각 엔진의 job/실행 기록을 어떤 state 필드에서 읽는지, `levelingHistoriesFromState`가 계산한 history를 **어디에 저장하는지**(예: `state.leveling.capability`류의 정확한 경로), 재시작 후 그 저장 위치에서 그대로 복원되는지를 먼저 grep·읽기로 확인하고 보고서에 남긴다. 이번 작업은 그 정확히 같은 패턴을 세 번째 엔진에 복제하는 것이지 새 저장 방식을 발명하는 게 아니다.

## 2. `leveling-evidence.mjs`에 세 번째 엔진 추가

- `ENGINES`에 `shadow:'shadowArmy'` 추가(기존 두 값은 그대로 — 순서·기존 키 변경 금지).
- `executionsFromState(state, 'shadowArmy')`: `state.jobs[]` 중 `type==='agent'`이고 `shadowAssignment`가 있는 job에서, 완료된 것만 `{jobId, skillId:'shadow:'+shadowAssignment.role, status, executionVerified, authorizedBy, at}` 형태로 뽑는다. `executionVerified`는 **기존 §109가 이미 요구한 조건 그대로**(결정론 검증 `verified:true` + 의미 검증 `pass` + Builder 산출물 저장 확인) — 새 검증 기준을 만들지 않는다.
- `interventionsFromState(state, 'shadowArmy')`: 같은 job들 중 소유자 개입(일시정지·취소·롤백 등 기존 필드) 있는 것만 뽑는다.
- `solo-leveling.mjs`는 **한 글자도 수정하지 않는다** — `grade()` 함수·`GRADES`·`AUTONOMY_MIN_SUCCESSES`는 그대로 재사용.

## 3. `shadow-roster.mjs` 연결

- `shadowRank(state, entry)`에서 언더스코어를 떼고, `levelingHistoriesFromState(state, 'shadowArmy', {...})`로 `entry.skillId`(예: `shadow:scout`)의 실제 history를 읽어 `buildSkillHistory`가 계산한 진짜 `grade`를 반환한다. **정정(2026-09-28)**: `solo-leveling.mjs`의 실제 `grade()` 계약을 다시 확인한 결과 `AUTONOMY_MIN_SUCCESSES=3`은 **A등급(소유자 개입 없는 자율 성공 3건)에만 적용**되고, D등급은 검증된 성공 **1건**(`successes.length>=1`), C등급은 서로 다른 입력(`inputSha256` distinct)의 검증된 성공 **2건**, B등급은 조합 증거(compositions) 1건 이상이면 충족된다 — 이전 초안의 "근거가 3건 부족하면 E"라는 서술은 부정확했다. 근거가 각 조건에 못 미치면 해당 등급 이하에서 정직하게 멈춘다(버그 아님).
- `rosterOverview`가 표시하는 `byRank` 집계도 이제 진짜 등급 분포를 반영한다.
- 재시작 후 등급 fingerprint가 동일하게 유지되는지 §109와 같은 방식으로 시험(신규 회귀 아님, 기존 패턴 재사용).

## 4. 등급이 실제로 영향을 주게 (3.2-A에서 예고했던 부분, 범위를 좁혀서 확정)

3.2-A에서 "정확히 어떤 권한을 계급에 연동할지는 소유자 확인 필요"라고 남겼던 부분을, 가장 안전한 형태로 좁혀서 이번에 확정한다 — **동시 진행 한도나 새 실행 권한은 건드리지 않고, "이름 있는 그림자 우선 배정"만** 구현한다:
- 새 임무 계획 시 같은 역할(scout/researcher/builder/verifier)에 **D랭크 이상** 그림자가 이미 있으면, 그 임무의 해당 역할 job에 `preferredShadowId`를 달아 JARVIS·소유자 서랍에 "이번엔 연구자 1호가 나선다" 식으로 표시한다. 실제 실행 경로·권한·동시성 한도는 **전혀 바뀌지 않는다** — 순수하게 "누가 맡았는지 이름이 보인다"는 표시 레이어다. `MAX_ACTIVE_MISSIONS_PER_PROJECT`나 owner-approval 게이트는 변경 금지.
- D랭크 미만이면 지금처럼 익명 배정 그대로.

## 5. 테스트

`runtime/test/shadow-leveling.test.mjs`: `grade_starts_at_E_without_evidence`, `grade_reaches_D_after_1_verified_success`, `grade_reaches_C_after_2_distinct_input_successes`, `grade_reaches_A_only_after_3_autonomous_successes_without_intervention_per_AUTONOMY_MIN_SUCCESSES`, `intervention_lowers_grade_same_math_as_solo_leveling`, `rank_survives_restart`, `named_shadow_preferred_at_D_or_above`, `anonymous_assignment_below_D`, `no_change_to_dispatch_authority_or_concurrency_limit`.

## 6. 인수 S1+

**격리 코어·합성 provider**: 같은 그림자(같은 역할)로 검증된 임무를 **1회** 완료 → `shadowRank`가 실제로 `D`를 반환(고정 E가 아님, `solo-leveling.mjs`의 실제 D 조건이 1건이므로) → 서로 다른 입력으로 2회째 검증 성공 시 `C`로 승급 → 재시작 후 등급 fingerprint 동일 → D 이상 상태에서 같은 역할의 다음 임무 계획 시 화면에 그 이름 있는 그림자가 우선 배정 표시됨(익명 아님). 별도로 소유자 개입 없는 자율 성공을 `AUTONOMY_MIN_SUCCESSES=3`건 쌓아 `A`까지 오르는 경로도(조합 증거가 있다는 전제하에) 확인한다. 증거 `s1plus-grade-before.json`(0회차, 전부 E), `s1plus-grade-after-1.json`(1회차 후, D 등장), `s1plus-grade-after-2.json`(2회차 후, C 등장), `s1plus-preferred-assignment.json`, 화면 `s1plus-drawer.png`.

## 7. 하지 말 것

- `solo-leveling.mjs` 수정 금지.
- 기존 `capability`/`codeWorkshop` 엔진의 저장 경로·계산 결과 변경 금지.
- 동시 진행 한도·`authorizesDispatch`·owner-approval 게이트 변경 금지 — 이번 지시서는 순수하게 "표시"만 바꾼다.
- 근거 없이 등급을 올리지 않는다(합성 provider로 시험할 때도 실제 검증 통과 기록이 필요, 숫자만 조작 금지).

## 8. 보고 형식

기존 §7과 동일. `docs/CLAUDE_EXECUTION_STATE.md`에 다음 번호로 기록.
