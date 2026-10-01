# CODEX 지시서 — E 시리즈: 이미 박힌 개념도 두루뭉술하면 더 오버해서 (2026-09-29)

## §0 배경

소유자 지시(2026-09-29): "기존에 박힌 개념들이 두루뭉술하면 더 오버스럽고 강렬하게." 새 설계(C0~C5·G1)뿐 아니라 **이미 코드에 들어간 개념**도 같은 기준으로 재검토했다. 아래는 코드를 직접 읽어 "두루뭉술"로 판정한 것과 정정이다. 불변 경계(정전 §0)와 S0 정정(F1~F8)은 그대로 — 특히 **영속 ID·스키마 변경은 버전화+구 상태/백업 복원 시험 먼저**(F3), **문자열 기대값을 바꾸는 테스트는 의도적 변경으로 명시**(F1).

두루뭉술로 판정한 근거(직접 열람):
- `seven-drives.mjs` 헤더 자체가 "partial softening of pride->긍지 and lust->매혹"이라고 적음 — 오만·색욕을 일부러 순화한 상태. worldName(부/지식/영향력/명예/창조/진화/자유)은 죄를 대체하는 순한 이름으로 쓰이고 있음.
- `drive-state.mjs advanceHunger`: 일곱 드라이브가 **똑같은** 감쇠/증가 규칙(dominant −30, 나머지 +2~12). 성격 차이 없음.
- `drive-state.mjs driveVoice`: `"강욕(부) · 배고픔 62: 재사용 3건 · 자산 공백 2건"` — 대시보드 수치 나열이지 목소리가 아님. `debateFor`의 3목소리는 같은 템플릿의 점수 상위 3개일 뿐 논쟁이 없음.
- `runtime/public/jarvis.mjs ACTIVITY_KO`: "쉬는 중/생각 중/일하는 중/네 결정 기다리는 중", `jarvis-scene-model.mjs resultSpeech`: "문서를 만들었어. … 확인해줘.", `failureSpeech`: "그 일은 못 끝냈어… 숨기지 않을게." — 친구 반말. 아이언맨의 자비스는 격식·정밀·건조한 위트·선제 보고다(정직성 문구 자체는 훌륭하므로 **유지**).
- `solo-leveling.mjs` reason 문자열·`shadow-roster` 이름은 시스템 로그체. 원작의 "[시스템]" 알림 양식이 없다.
- `kirby.mjs` reason: "측정값이 있는 원장 기록 N건을 확인했습니다…" — 흡입·카피의 맛이 없다.

## E1 칠죄종 — 순화 해제 + 일곱 개의 다른 배고픔 곡선

- **이름 원복(표시 계층)**: 표시 `label`을 `legacyName`(오만·색욕 포함 원래 죄 이름)으로 전환. `worldName`은 죄를 대체하는 이름이 아니라 **그 죄가 다스리는 영토**로 재해석해 표기: "오만 — 명예의 영토", "색욕 — 창조의 영토". `id`·`legacyName`·`worldName` 값과 bijection 검증은 **불변**(영속 quest.driveId 보호). '긍지'/'매혹'을 단언하는 UI/테스트는 F1 방식으로 **의도적 변경+이유 기록**.
- **배고픔 v2** (`drive-state.mjs advanceHunger`, `DRIVE_STATE_HUNGER_VERSION=2`, v1 재현 시험 유지, 구 state 복원 시험): 기존 `SIGNAL_IDS`(assetGap·knowledgeGap·coverageGap·verificationGap·deliveryGap·repairNeed·reuseArtifacts·estimatedCalls·ownFailures·unknownCalls·missingArtifacts)와 `components`만 입력으로 — **새 데이터 발명 금지**:
  - 탐욕: 먹여도(dominant) 감쇠가 가장 작다(−30 → −12). 만족을 모른다.
  - 폭식: `knowledgeGap>0`이면 증가 상한이 가장 크다(+12 → +18). 닥치는 대로.
  - 질투: 자기 component가 상위 2개(dominant)에 못 들고 그 격차가 클수록 **추가 상승**(남이 먹는 걸 보면 더 배고프다). 그 뒤 정상 감쇠.
  - 오만: `verificationGap>0`일 때만 오르고, dominant가 아닌 방법으로는 절대 내려가지 않는다(남이 채워준 걸로 만족 안 함).
  - 색욕: `deliveryGap>0`이면 가장 빨리 오르고(+15), 먹이면 가장 빨리 꺼진다(−40). 즉각 만족·즉각 소진.
  - 분노: `ownFailures+repairNeed+unknownCalls===0`이면 **오르지 않는다**(실패 없는 분노는 없다); 있으면 +14.
  - 나태: `estimatedCalls`가 클수록 오르고 `reuseArtifacts`가 늘면 내려간다(일이 많아질수록 게을러지고 싶다).
  - 모든 계수는 상수 표 하나(`HUNGER_RULES_V2`)에 두고 근거를 주석으로. 소유자 화면에 7곡선을 그대로 표시(합성 결정 10회 시험으로 곡선이 실제로 서로 다름을 증명).

## E2 호문쿨루스 — 수치 나열이 아니라 목소리, 상위 3은 논쟁

- `driveVoice` v2: 같은 `evidence[driveId]` 수치를 **그 죄의 말투**로 말한다(≤120자, 수치는 그대로 — 정직성 유지). 고정 템플릿 예(Codex가 다듬되 죄의 성격이 문장에서 드러나야 함):
  - 탐욕: `더. 재사용 3건으론 부족해. 자산 공백 2건, 전부 내 것이어야 해.`
  - 폭식: `오래된 근거 4건. 다 삼킨다.`
  - 질투: `검증 공백 5건. 남들은 벌써 채웠는데.`
  - 오만: `검증 공백 2건. 이 상태로는 내 이름을 걸 수 없다.`
  - 색욕: `전달 공백 3건. 지금 당장 보여주고 싶어.`
  - 분노: `실패 1건, 미확인 호출 2건. 원인을 찾아 끝낸다.`
  - 나태: `예상 호출 8회… 재사용 2건으로 대신하면 안 될까.`
- `debateFor` v2: 3목소리 중 1위는 밀어붙이고(push), 2·3위는 **1위에 반대하는 문장**(contest)을 낸다 — 반대 근거는 자기 component와 1위 component의 실제 차이. 영속 debate 스키마(`voices[3]{driveId,text,weightedScore}`)는 **불변**, 입장은 text 안에 담는다(F3 회피). 자비스 "쉬는 중 발언"은 1위 문장만이 아니라 반대 1줄도 함께 보여준다.

## E3 자비스 — 아이언맨의 말투

- 호칭·격식: 격식체(~습니다)·정밀·건조한 위트·선제 보고. 소유자 호칭은 설정값(`YENO_JARVIS_ADDRESS`, 기본 `"주인님"` — 소유자가 바꿀 수 있음; 채팅으로 정하지 말고 GUI 설정).
- `ACTIVITY_KO` v2: idle→`대기 중`, planning→`분석 중`, executing→`실행 중`, verifying→`검증 중`, waiting_owner→`승인 대기 중`, paused→`일시 정지`, stopped→`정지`.
- `resultSpeech` v2: `문서를 완성했습니다, 주인님. 「제목」. 전체 결과에 올려두었습니다.`
- `failureSpeech` v2: `완료하지 못했습니다. 원인: <FAILURE_REASON v2, 격식체>. 숨기지 않겠습니다.` — "숨기지 않는다"는 정직성 문구는 **반드시 유지**.
- 선제 보고(예측): idle 상태에서 `hungryVoice`·명부·사건부를 읽어 `"주인님, 곧 <드라이브>가 움직일 것 같습니다 — <근거 수치>."` 한 줄(제안일 뿐 실행 없음).
- 위트 규칙: 실패·불확실을 농담으로 덮지 않는다. 위트는 성공·대기 문장에만.
- 기존 문자열 단언 테스트는 의도적 변경. 6상태 계약 자체는 불변.

## E4 그림자군단·레벨링 — "[시스템]" 알림 양식

- 표시 전용 `system-notice.mjs`(새): 등급 변화·"일어나라"·보관/소환·명부 상한 도달을 원작 시스템 알림 양식으로 렌더: `[시스템] 조건을 충족하였습니다. 그림자 '<이름>'이(가) 기사(C)로 승급합니다.` / `[시스템] "일어나라." — '<목표>의 정찰자'가 그림자군단에 합류했습니다.` / `[시스템] 추출에 실패했습니다. (시도 2/3)`.
- `solo-leveling.mjs`의 reason 원문은 **무수정**; 알림은 그 reason을 인용해 덧붙인다(`— 사유: …`). 계급 표시(일반병~대원수)는 C2 규칙 그대로.
- 자비스는 이 알림을 격식체로 한 번 더 읽는다(E3).

## E5 커비 — 흡입·카피의 맛

- 표시 전용: 흡입 시도 `흡입! <출처>` → 무능력 `…무능력. 별맛이었습니다.` → 카피 `카피! '<능력명>' 모자를 썼습니다.` → 튀어나옴 `능력 별이 튀어나왔습니다. 다시 주울 수 있습니다.` — 데이터(`noAbility`, `copyAbility`, `star`)는 C3/F2 계약 그대로, 문장만 입힌다. `kirby.mjs`의 reason 원문은 기록용으로 유지하고 화면 문장만 교체.

## §6 하지 말 것

- 수치·근거를 문장에 맞추려고 바꾸기(문장은 수치를 그대로 말한다). 정직성 문구 삭제. 영속 `id`/`legacyName`/`worldName` 값·bijection 변경. 스키마 exact-key 변경 시 버전·백업 복원 시험 생략. 구 문자열 기대값을 숨은 예외로 통과시키기. 6상태·등급·디스패치 계약 변경.

## §7 테스트·인수 E-1

- `runtime/test/hunger-v2.test.mjs`: `seven_curves_differ_under_same_signals`, `greed_decays_slowest_when_fed`, `wrath_never_rises_without_failure_signals`, `lust_rises_fastest_and_drops_fastest`, `envy_rises_extra_when_not_dominant`, `v1_reproduction_unchanged`, `old_state_restores`.
- `runtime/test/drive-voice-v2.test.mjs`: `each_voice_contains_its_real_numbers`, `top3_has_one_push_and_two_contests`, `voice_length_limit_kept`.
- `runtime/test/jarvis-register.test.mjs`: `activity_labels_v2`, `result_and_failure_use_formal_register_and_keep_honesty_line`, `anticipation_line_only_from_real_state`.
- `runtime/test/system-notice.test.mjs`: `grade_change_renders_system_style_with_original_reason_quoted`, `arise_and_arise_failed_render`.
- **인수 E-1(격리 코어)**: 합성 결정 10회 → 7배고픔 곡선 JSON+그래프 캡처(서로 다름) → 화면에 '오만'·'색욕' 라벨과 영토 표기 → 쉬는 중 발언에 push 1줄+contest 1줄 → 자비스 격식체 결과/실패/선제 문장 캡처 → 등급 변화 1건의 [시스템] 알림 → 커비 흡입/무능력 문장 → 전체 회귀 0 실패. 증거 `build-artifacts/concept-20260928/e1-hunger-curves.json`, `e1-hunger.png`, `e1-voices.json`, `e1-jarvis.png`, `e1-system-notice.json`, `e1-full-regression.txt`.

## §8 순서

CP1(기존 어댑터) 착수와 **병렬 가능**(파일 겹침 없음: E는 drive-state/seven-drives 표시/jarvis 공개 파일, CP1은 connectors/provider). E1의 스키마 버전화는 F3의 백업 작업과 같은 방식으로.
