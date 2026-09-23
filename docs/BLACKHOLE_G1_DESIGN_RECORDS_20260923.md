# BLACKHOLE G1 설계 기록 (2026-09-23)

통합 후보 브랜치 `blackhole/g1-integration-claude-20260922` · base = PR #55 head `84d6f27c7d1c38fa4b0acaba466f8c631fdaf0d0`.
각 결정은 "기존 구조 재사용, 두 번째 엔진·저장소 금지, 실패 닫힘(fail-closed)" 원칙으로 골랐다. 대안과 배제 이유를 함께 남긴다.

## F03 — Shadow 집계 (`runtime/lib/blackhole-core.mjs`)
- 결정: `isShadowJob(job) = botAssignment || shadowAssignment`. 하나의 job은 둘 중 하나만 갖는 실제 스키마(project-bots.mjs / shadow-army.mjs)이므로 이중 집계 없음. 집계는 `status==='running'`만(queued/paused 제외) — 기존 의미 유지.
- 검증기(`validateCoreState`)와 heartbeat(`evaluateHeartbeat`)가 같은 술어를 쓴다.

## F05 — 임무 검증 결과 → 기억 + outbox (`runtime/server.mjs`)
- 결정: `recordMemoryEvent(claim,{at})` 단일 쓰기 경로 추출. 이벤트 목록과 outbox를 **커밋 전에 함께 계산**해 둘 중 하나만 반영되는 상태를 만들지 않음. `/api/memory-events` 라우트와 `advanceMissionFromVerify()`가 같은 함수를 호출.
- 원자성: 단일 writer JSON store는 `save()`마다 전체 스냅샷을 atomic write 하므로 milestone·memoryEvent·outbox는 한 스냅샷에 함께 저장된다. save 전 crash → 셋 다 없고 job은 미완료로 남아 재실행됨(부분 상태 없음).
- 멱등성: 최종화 키 = `type==='result' && sourceRefs∋{job: semanticVerifierJobId}`. 이미 있으면 milestone/memory/outbox 전부 건너뜀. `enqueue()` 자체도 (eventId,destination) 기준 멱등.
- 외부 전송은 기존 `processMemorySyncBatch` 스케줄러가 commit 이후에만 수행(변경 없음). 목적지 0/1/복수는 `configuredMemoryDestinations()`가 실제 설정된 것만 반환 — 꾸며내지 않음.
- 배제한 대안: 임무 전용 outbox 큐(두 번째 저장소) / 검증 전 enqueue(저장 전 외부 효과 위험).

## F04 — `verifiedResultRef` (`runtime/lib/blackhole-core.mjs`)
- 발견: "영속 verdict 저장소가 없다"는 기존 주석은 낡았다. semanticVerifier job이 `semanticVerdict`(version/missionId/builderJobId/verifierJobId/artifactRefs/verdict/createdAt)를 같은 store에 영속한다.
- 결정: 별도 verdict 저장소를 만들지 않고 `resolveVerifiedResult(semanticJob,state)`로 **매 heartbeat 재도출**. 조건: semantic `pass` ∧ 결정적 verify job `verified===true` ∧ builder 완료·첫 artifact === `artifactRefs[0]` ∧ artifact가 builder에 등록·sha256 존재.
- 참조 형식: `{type:'semantic', missionId, semanticJobId, verifierJobId, builderJobId, artifactId, artifactSha256, verdict:'pass', verdictVersion, verifiedAt}`.
- 실패 닫힘: fail/uncertain, 결정적 실패, 삭제·교체된 artifact, 다른 임무 id, 형식 변조 → heartbeat는 null, 영속된 참조는 `validateCoreState` throw. 과거 null 데이터는 그대로 로드.
- 구분: 이는 무결성+내용 검증이다. 외부 사업 성과는 `outcome-verification.mjs`의 별도 원장이며 여기서 승격하지 않는다.
- 배제한 대안: artifact 존재만으로 verified 표시(금지) / 새 verdict 컬렉션(중복 저장).

## F06 — Shadow XP·레벨 (`runtime/lib/shadow-growth.mjs`)
- 발견: `solo-leveling.mjs`의 E~S 등급은 skill registry의 run(runId/입출력 hash)+`verifyExecution`에 묶여 있다. Shadow 역할은 registry run이 없다.
- 결정: E~S 엔진을 넓히지 않고(가짜 run 기록 금지) 별도 순수 leaf에서 **역할별 XP·숫자 레벨**을 도출. 증거 술어는 F04와 동일한 `resolveVerifiedResult` 재사용.
- 규칙 v1(`SHADOW_GROWTH_VERSION=1`): 보상 사건 = semantic pass가 현재도 resolve되는 임무. XP builder 20 / scout·researcher 10 / verifier·semanticVerifier 5. 중복 방지 키 `missionId:jobId`. fail/uncertain = 0 XP, `failedMissions`로 기록(음수 없음). 증거 철회(artifact 삭제·교체) = `held`(사유 포함)로 이동, XP 제외, 이력 보존. `level = floor(sqrt(xp/10))` (10/40/90…). `rules.grantsAuthority:false` — 레벨은 권한·예산·호출 한도를 바꾸지 않는다.
- 노출: `/api/state`의 `growth.shadow`; 성장 화면에 같은 수치 렌더(증거 없는 역할은 숨김).
- 미결(다음 단계): Verifier 자체 재실행 방지는 v1 키가 job 단위라 **같은 임무에 두 번째 verifier job이 생기면 별도 사건**이 된다(현재 파이프라인은 임무당 verifier 1개만 계획하므로 발생 경로 없음). 임무당 역할 1회로 좁힐지 v2에서 결정.

## F01 — #39 선별 통합
- 1976776(STAGE 2 Homunculus Heartbeat: autonomyMode/currentQuestId/currentGoalId/lastReplanAt/measuredDrivePressure, store/backup schema)와 9ce7c97(STAGE 3: 결정된 프로젝트 목표 → `dispatchShadowMission`)의 코드+테스트만 cherry-pick. #39의 docs/handoff 산문은 제외. blackhole-core.mjs 상수 인접 충돌 1건은 양쪽 유지.

## F02 — #22 선별 통합
- 코드 커밋 6개 cherry-pick(docs 제외). #22는 스케줄러·실행이 없는 소유자 전용 roster/routine/handoff 계약이므로 두 번째 엔진이 아니다. store 로드·backup 검증에 `persistentBots` 추가, 정직한 capability 플래그 복원.
- 기억 통합 결정: 봇 memory append 1건 = canonical Memory Event 1건(`recordMemoryEvent` 경유, outbox 포함). roster는 봇 범위 색인만 유지하고 응답에 `memoryEventId`를 돌려준다. 매핑 kind→type(source/result 유지, decision/constraint/risk→decision), confidence high/medium/low→0.9/0.6/0.3, sourceRefs 없음(봇 evidenceRefs는 자유 텍스트라 실제 레코드로 주장하지 않음).

## 점검 도구 (`scripts/blackhole-check.mjs`, F12/§9)
- basic / isolated / live 3모드, 동일 시퀀스 공유. isolated는 실제 프로세스 재시작, live는 HTTP 재조회일 뿐임을 출력에 명시. 토큰은 env에서만 읽고 출력·보고서에 절대 넣지 않음. 결과 PASS/FAIL/BLOCKED + exit 0/2/3, 미실행 필드는 `NOT_RUN`.

## G1 통합 검사
- `runtime/test/g1-living-loop-integration.test.mjs`: 자연어 명령 → Homunculus 결정 → Jarvis 임무 승격 → 역할 실행 → 결정적/의미 검증 → milestone·memoryEvent·outbox·XP → Home(activeShadowCount, verifiedResult) → 서버 재시작 후 동일 증거. 부정 사례(semantic FAIL) 포함. **합성 transport** — 실제 모델·실기기 증거가 아님.
