# CODEX 지시서 — 욕망 v3: 결과 기반 배부름 · 충족 장부 · 세계 신호 (2026-09-30)

작성: Claude(Cowork). 구현: Codex. 기준 문서: `BLACKHOLE_CONCEPT_CANON_20260928.md`, `CODEX_DIRECTIVE_S0_CORRECTIONS_20260929.md`, `CODEX_DIRECTIVE_EXISTING_CONCEPTS_INTENSITY_20260929.md`(E1 = 현재 v2).
충돌 시 이 문서는 v2 이후의 **추가**이며, 기존 v1/v2 저장·재현·백업 복원 계약은 절대 깨지 않는다.

## 0. 왜 만드는가 (진단 — 모두 실제 코드에서 확인한 사실)

1. `drive-state.mjs advanceHunger`: 지배 욕망(`dominantDrives`)은 **선택되는 순간** `rule.fed`만큼 배가 부른다(예: −30). 그 결정이 성공했는지, 실패했는지, 산출물이 있었는지와 무관하다. 실패한 욕망도 배가 부르다.
2. `HUNGER_RULES_V2`의 계수는 "선언된 우선순위"라고 코드 주석에 스스로 적혀 있다. 어떤 행동이 실제로 그 욕망을 채웠는지 기록하지도, 반영하지도 않는다.
3. 이미 존재하는 진실 원천을 배고픔이 쓰지 않는다: `motivation.mjs observedFeedback(state)`는 autopilot 작업별로 `outcome`(artifact_saved / completed_without_verified_artifact / failed / cancelled / unknown / pending)과 `criterionMet`(true/false/null)을 이미 계산한다. `executionEvidence`는 이걸 wrath 신호(ownFailures 등)에만 흘려보낸다.
4. 배고픔은 내부 타이머에 가깝다. 세계에 "지금 가져갈 수 있는 기회"가 있어도 욕망이 그걸 말하지 못한다(G1 초안함에는 기회가 쌓이는데 욕망은 모른다).

목표: **배부름은 검증된 결과에서만 온다. 실패는 배고픔을 남긴다. 욕망은 세계의 실제 기회를 말한다.** 숫자·확률·품질 점수를 새로 만들지 않는다. 쓰는 것은 횟수와 이미 저장된 사실뿐이다.

## 1. 원칙

- 배부름 = "산출물 참조가 실제로 저장되었고(해시·크기) 기준을 충족한 것으로 기록됨". 내용의 정확성·수익·미적 품질을 뜻하지 않는다. 화면·기록 어디에도 그렇게 표현하지 마라.
- 작업에 의미 검증 결과(`semantic-verification.mjs`의 실제 판정 필드)가 존재하면 그 판정이 통과일 때만 충족으로 친다. 판정이 실패면 미충족. 판정이 없으면 "산출물 참조만 확인" 라벨을 붙인다. 필드/이름은 코드를 직접 읽어 확인하고 추정하지 마라.
- 계수는 전부 "선언된 정책"이다. 코드 주석에 그렇게 명시한다. 측정된 효과처럼 보이게 쓰지 마라.
- `scoreMotivation` 가중치, 후보 순위 산식, 영속 debate 스키마 `voices[3]{driveId,text,weightedScore}`는 바꾸지 않는다.

## 2. V3-A 결과 기반 배부름

정책 버전 `DRIVE_STATE_HUNGER_VERSION`을 3으로 올린다(v1/v2 상태·재현 함수·백업은 그대로 유효, **다음 결정부터** v3 적용 — E1에서 v2 도입할 때와 같은 방식).

- **결정 시점(attempt)**: 지배 욕망은 `attempt = round(fed / 3)`만큼만 줄어든다(주의를 썼다는 뜻). 비지배 욕망의 상승 규칙은 v2와 동일하다.
- **정산 시점(settle)**: 그 결정에 연결된 작업(`jobId`)이 종료 상태가 되면 한 번만 정산한다.
  - 충족(artifact_saved + 기준 충족 + 의미 검증 통과/없음): 지배 욕망에 남은 `fed - attempt`만큼 추가로 줄인다. 합계가 v2의 `fed`와 같다.
  - 미충족(failed / cancelled / completed_without_verified_artifact / 의미 검증 실패): 추가 감소 없음, 지배 욕망에 `frustration` 상승(선언 정책, 욕망 공통 표 하나로, 상한 100).
  - unknown(호출 결과 불명): 추가 감소·상승 없음, 기록에는 unknown으로 남기고 화면에 "미확인"으로 표시. 재시도로 덮어쓰지 마라.
  - pending: 정산하지 않는다.
- 정산은 **멱등**이어야 한다: 같은 jobId를 두 번 정산하지 않는다. 재시작·백업 복원 후에도 마찬가지.
- 정산 트리거는 새 타이머를 만들지 않는다. 다음 세 곳에서 미정산 작업을 훑는 순수 함수 하나(`settleDriveOutcomes(state, at)`)를 호출한다: ① `recordDriveDecision` 직후 ② 상주 시작 시 ③ `GET /api/drives/status` 응답 직전. 놓친 정산은 다음 호출에서 따라잡는다.
- v3 이전(version 1/2) debate와 그에 연결된 작업은 **소급 정산하지 않는다**(추정 금지).

## 3. V3-B 충족 장부

새 최상위 상태 키 `driveOutcomes`(최대 200개, 오래된 것부터 잘라내지 말고 상한 도달 시 정산 중단 + 명시 오류코드 — 조용히 버리지 마라).
항목: `{jobId, questId|null, kind, drives:[…], outcome, verification: 'semantic_pass'|'artifact_reference_only'|'semantic_fail'|'none', artifactCount, settledAt, effect:{driveId: delta}, authorizesDispatch:false}`.

- 욕망별 효능은 별도 저장하지 않고 이 장부에서 **순수 함수로 계산**한다: `driveFulfillment(state)` → 욕망별 `{attempts, fulfilled, unfulfilled, unknown, lastOutcome, lastJobId, consecutiveUnfulfilled, stuck}`. 확률·비율·점수로 환산하지 마라(횟수만).
- `stuck` = 같은 욕망이 연속 3회 미충족. 이 사실은 화면과 시스템 알림에 그대로 노출하고 G1 갭 감지의 입력으로 쓸 수 있다(기존 G1 조건 유지, 자동 실행 권한 없음).

## 4. V3-C 세계 신호(기회)

`driveCues(state)`: 이미 저장된 상태에서만 계산. 새 저장소 없음.

- 욕망 d의 cue = G1 초안함에서 `status:'draft'`인 `research-draft` 중, 연결된 `gapId`의 갭 `driveId===d`인 것의 개수(반올림 없이 정수). "가져갈 수 있는 기회가 검토를 기다리는 중"이라는 사실만 말한다. 갭 자체(pending)는 세지 않는다 — 갭 생성과 되먹임 루프가 생기기 때문.
- 효과: cue가 있는 동안 결정 시점마다 해당 욕망 배고픔에 선언 정책 `cueRise = min(cue, 2) × 5`만큼(상한 100) 더한다. 소유자가 초안을 rejected/noAbility로 처리하면 cue가 줄어든다.
- cue는 "행동 허가"가 아니다. 초안 검토·import·활성화는 계속 소유자 경로다.

## 5. V3-D 표현

- `driveVoice` 규칙은 유지하되 숫자를 실제 장부/신호에서 가져온다: 직전 시도 미충족·stuck·검토 대기 초안이 있으면 그 사실을 (≤120자) 대사에 반영. 대사는 욕망마다 서로 달라야 한다(E2의 말투 유지). 영속 스키마는 그대로.
- `GET /api/drives/status`에 욕망별 `fulfillment`와 `cues`를 추가(기존 필드 제거·변경 금지). 소유자 화면 욕망 패널에: 시도/충족/미충족/미확인 횟수, 마지막 결과와 jobId, stuck 표시, 검토 대기 기회 수. 색만으로 구분하지 말고 텍스트도 함께.
- E4 시스템 알림: 정산 결과(충족/미충족/미확인/stuck)를 실제 기록에서만 문구로 투영. 없는 이벤트를 만들지 마라.

## 6. 반드시 같이 고칠 곳 (조용히 깨지는 지점)

- `grep -rn "DRIVE_STATE_HUNGER_VERSION\|version *!== *2\|version *=== *2" runtime` 전수: 특히 `gap-scout.mjs detectGaps`는 `d.version!==2`이면 연속 조건을 깨뜨린다. v3 debate도 유효로 취급하되 **v1/legacy는 계속 연속을 깨뜨린다**(과거 추정 금지). `validateDriveDebates`(`entry.version === DRIVE_STATE_HUNGER_VERSION`), `validateDriveState`(`[1, 2]` 허용 목록), backup/store 복원 경로도 v3를 받아야 하고 v1/v2를 계속 받아야 한다.
- 위 수정은 각각 회귀 테스트로 고정한다(v2 상태 그대로 복원 → 다음 결정에서 v3로 이어가기).

## 7. 구현 순서

1. **저장 먼저**: `driveOutcomes` 기본값·검증·백업 허용 목록 추가, 옛 상태/실제 구형 암호화 백업 복원/손상된 필드 거부 시험을 먼저 통과(S0 F3).
2. 버전 3 정책 상수 `HUNGER_RULES_V3`(전부 "선언된 정책" 주석), `advanceHungerV2` 보존, v3 attempt/settle 구현.
3. `settleDriveOutcomes`, `driveFulfillment`, `driveCues` 순수 함수 + 단위 시험.
4. 서버·상주·상태 API·화면·대사·시스템 알림 연결.
5. 기존 G1 gap-scout 등 §6 지점 정리.
6. 실제 격리 코어 시연(§8-B).
새 상태 키 추가는 전체 회귀에서 옛 상태 시험이 통과함을 확인해야 완료다.

## 8. 시험

A. 단위·계약
- v2 상태 → 다음 결정에서 v3, v1/v2 결정 재현 함수 결과 불변, 지문 검증.
- 충족 정산 후 배고픔 합계가 v2 fed와 동일 / 미충족은 감소 없이 frustration만 / unknown은 무변화 / pending은 정산 안 됨.
- 같은 jobId 이중 정산 방지(직접 재호출, 재시작, 암호화 백업 복원 후).
- 의미 검증 실패·성공·없음 세 경우의 `verification` 값과 정산 결과.
- stuck: 연속 3회 미충족 → stuck, 중간에 충족 1회 → 해제.
- cue: 초안 개수 → cueRise 상한 적용, rejected 처리 후 감소, 다른 욕망의 초안은 무관.
- 장부 상한 도달 시 조용한 삭제 없이 명시 오류.
- 대사 ≤120자, 욕망별 다른 말투, 숫자가 실제 장부/신호와 일치.

B. 실제 격리 코어 시연(소유자 실키 없이 합성 공급자 응답 허용, 합성/실증을 명확히 표시)
1. 결정 → 작업 완료 + 산출물 → 정산 → 배고픔 최종 감소량 확인.
2. 결정 → 작업 실패 → 배고픔 상승·미충족 횟수 증가·화면 표시.
3. 위 작업을 반복해 stuck 표시 확인, 그다음 충족 1회로 해제.
4. 프로세스 재시작 후 이중 정산 0, 백업 복원 후 동일 지문.
5. 화면 스크린샷(400/768/1440 폭)과 표 접근성(색 없이 읽기) 검증.

## 9. 수용 조건 (V3-A)

- [ ] 결정만으로는 배부름이 완성되지 않고, 검증된 결과에서만 완성된다(합성 시연으로 확인).
- [ ] 실패·미확인이 배고픔·기록·화면에 그대로 남는다.
- [ ] 장부 기반 fulfillment/cues가 상태 API·화면·대사에 노출된다.
- [ ] v1/v2 옛 상태·옛 백업 복원 테스트 통과, G1 gap-scout v3 대응 테스트 통과.
- [ ] 정산 멱등성(재시작·백업 복원).
- [ ] 새 점수·확률·품질 등급 0개.

## 10. 불변 조건

`authorizesDispatch:false`, `solo-leveling.mjs` / `recovery-one-of-qpu.mjs` / `workers/developer/static-guard.mjs` 수정 금지, 실행 코드 연결은 소유자 최종 승인 전까지 금지, 자격증명은 소유자만 입력(채팅·터미널 금지), 성공처럼 꾸미기 금지, 커밋/push 금지, Vault 수정 금지. 작업 순서상 지금 진행 중인 일괄 작업에서 C3 다음·C5 앞에 끼우고, 전체 회귀는 별도로 추가하지 말고 ② 체크포인트에 합산한다(관련 테스트는 조각마다 실행).

## 11. 보고

새 §번호(쓰기 직전 `grep '^## §'` 확인)로 VERIFIED / RAN-UNVERIFIED / BLOCKED를 구분하고 `build-artifacts/drives-v3-20260930/`에 명령·로그·산출물 SHA-256을 남긴다. 합성 시연 결과를 실증(실제 모델·실제 프로젝트)으로 표기하지 마라.
