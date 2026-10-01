# CODEX 지시서 — 살아있는 분신 7계통 (2026-09-27)

작성: Claude(Cowork). 소유자 지시: "안드로이드 실기기·원격 키 두 개는 나중에. 자비스·호문쿨루스·나혼렙(그림자군단)·양자역학·JEV·커비·옵시디언 장기기억을 어떻게 구현할지 다시 지시서로."
근거 조사: `runtime/lib/{seven-drives,motivation,solo-leveling,shadow-army,shadow-growth,leveling-evidence,growth,jev,jev-recovery,recovery-one-of-qpu,kirby,memory-events,memory-recall,memory-embeddings,obsidian-exporter}.mjs`와 `runtime/server.mjs`의 import/route를 2026-09-27 직접 읽음. Obsidian 원장 `01_DRAFTS/20260926_BLACKHOLE_IDEA_LEDGER_R3_RECHECK_COMPLETE/data/ALL_IDEA_RECORDS.json`(1,117건, 필드 `id,name,category,aliases,original_intent,next_action,evidence_status,source_refs,...`) 확인.

## 0. 완료의 정의 — 한 바퀴가 실제로 돈다

7계통은 따로가 아니라 **한 생명 루프**다. 이 루프가 실제 운영 코어(8790)에서, 모델 호출 없이 되는 구간은 진짜로, 모델이 필요한 구간은 합성 provider로, **한 바퀴 관측 가능**해야 완료다.

```
옵시디언 기억(원장 1,117건을 안다)
  → 호문쿨루스(7욕망이 배고픔 상태를 갖고 각자 발언해 다음 일을 제안)
  → 소유자 최종 승인(전면자동·최종만 소유자)
  → 그림자군단(이름 있는 그림자들이 실행, 완료 시 새 그림자 추출)
  → JEV(독립 판정; 실판정과 일치율을 측정해 승격 조건을 채움)
  → 양자(복구 대안 선택을 실제 양자 상태벡터 시뮬레이션으로 계산해 고전 선택과 대조)
  → 커비(검증된 작업에서 능력을 흡수해 등록; 실패하면 뱉음)
  → 나혼렙 등급(그림자·능력이 증거로 승급/강등)
  → 옵시디언(결과·결정·기억을 vault에 기록)
  → 자비스(위 전부를 화면과 말로 표현)
```

각 계통은 **원작의 핵심 메커니즘을 관측 가능한 시스템 동작으로** 옮긴다(소유자 규칙: 이름만 빌린 느슨한 비유 불가).

| 계통 | 원작 핵심 메커니즘 | 시스템에서 관측돼야 하는 동작 |
|---|---|---|
| 호문쿨루스(강철의 연금술사 칠죄종) | 각자 고유 욕망을 가진 별개 인격. 욕망이 커지면 스스로 움직이고, 서로 충돌한다 | 7욕망이 **시간에 따라 변하는 배고픔 상태**를 갖고, 결정마다 **각자 발언**(회의록)하며, 채워지면 잠잠해지고 굶으면 커진다 |
| 그림자군단(나 혼자만 레벨업) | 쓰러뜨린 상대에게서 그림자를 **추출**("일어나라"), 그림자마다 **이름·계급**, 군단은 **늘어나고 승급**한다 | 검증 통과한 임무에서 **이름 있는 그림자 기록이 태어나고**, 증거로 E→S 승급, 군단 명부가 화면에 보인다 |
| 커비 | 상대를 흡입해 **능력을 복사**, 모자로 **능력이 보이고**, 뱉으면 사라진다 | 검증된 작업에서 **능력 초안을 만들어 소유자 승인 후 등록**, 자비스에 능력 수 표시, 재검증 실패 시 **비활성(뱉음)** |
| JEV | 독립 판정관 — 실행자와 분리된 판단·근거 | 실판정과 **일치율을 측정**하고, 조건을 채운 질문 하나부터 **자문→보류 권한**으로 승격(디스패치 권한은 계속 없음) |
| 양자역학 | 중첩·간섭·측정 | 이미 만든 QAOA 회로를 **실제 상태벡터 시뮬레이션**(유니터리 진화 + Born 규칙 측정)으로 돌려 counts를 얻고, 파라미터 최적화로 승자 확률이 균등분포보다 확실히 높음을 보인다. 실기기 제출은 계정 확보 후 |
| 옵시디언 장기기억 | 소유자의 실제 지식창고 | 원장 1,117건을 **런타임이 읽어 기억으로 갖고**, 질문에 회수하며, 결과를 vault에 남긴다 |
| 자비스(아이언맨) | 먼저 말 걸고, 주인의 모든 것을 알고, 집·슈트를 **대신 운영** | 위 상태 변화를 **먼저 말로 알리고**(배고픈 욕망·새 그림자·흡수한 능력·JEV 판정), 기억 근거를 붙여 답한다 |

## 1. 현재 상태 — 있는 것 / 없는 것 (파일 단위)

| 계통 | 이미 있음 (건드리지 말고 재사용) | 없음 (이번 지시서 범위) |
|---|---|---|
| 호문쿨루스 | `seven-drives.mjs` DRIVE_CANON 7 id 고정(greed/gluttony/envy/pride/lust/wrath/sloth), `motivation.mjs` scoreMotivation/rankMotivatedCandidates/motivationStatus, `GET /api/drives/status` | 결정 사이에 남는 **상태 없음**(매번 무기억 점수), 욕망별 **발언 없음**, 자비스 말에 안 실림 |
| 그림자군단 | `shadow-army.mjs` SHADOW_ROLES 5종·고정 임무 형태(scout+researcher→builder→verifier(+semanticVerifier)), `solo-leveling.mjs` E~S 등급 증거 규칙, `leveling-evidence.mjs`, `shadow-growth.mjs`, `growth.mjs`, `POST /api/shadow-army/missions` | **이름 있는 영속 그림자 없음**(임무마다 익명 역할), 완료 시 **추출 이벤트 없음**, 군단 명부 화면 없음 |
| 커비 | `kirby.mjs` 저장소에 커밋된 manifest(`runtime/capabilities/*.json` 3개)만 흡수, `capabilities.mjs` import→verify→activate, `GET /api/capability-inbox`, `POST /api/capabilities/disable` | **실행 결과에서 능력 초안을 만드는 경로 없음**, 화면에 능력 표시 없음 |
| JEV | `jev.mjs` 4 질문 typed 판정·`authorizesDispatch:false` 고정·shadow log·`calibrateShadowLog`(이미 `/api/state.jev.calibration`에 `sampleSize/matchRate/falsePositiveRate/falseNegativeRate/byAnswer/byStatus` 노출됨), `jev-recovery.mjs` planRecovery, `jev-recovery-verifier.mjs` | **승격 조건·모드 없음**(측정은 있으나 아무 결과로도 이어지지 않음), 판정 상태가 자비스에 안 보임 |
| 양자 | `recovery-one-of-qpu.mjs` QAOA one-of 회로 생성(OpenQASM3, qubo/ising, 게이트 수/깊이), `decodeRecoveryOneOfCounts`, 고전 fallback | **회로를 실제로 실행하는 것이 없음**(counts 입력을 밖에서 받는 형태), 파라미터 최적화 없음 |
| 옵시디언 | `obsidian-exporter.mjs` 단방향 내보내기(`01_DRAFTS/BLACKHOLE/` 전용, generated+fingerprint 충돌 정책), `memory-events.mjs` 7 type, `memory-recall.mjs` 토큰 겹침 회수(최대 5), `memory-embeddings.mjs` loopback 임베딩 저장소, `POST /api/memory-events`, `/api/memory-embeddings` | **원장 1,117건 읽기 경로 없음**(런타임은 소유자 아이디어를 모름), 임베딩 회수가 대화 경로에 안 붙음, 소유자가 vault에 쓴 메모 읽기 없음 |
| 자비스 | `jarvis.mjs`(상태/데이터층)·`jarvis-orb.mjs`(2D)·`jarvis-webgl.mjs`(3D, §91)·`jarvis-scene-model.mjs`·결과 문서 뷰(§100) | 위 6계통 상태를 **먼저 말하는 경로 없음**, 상단바에 능력/그림자/기억 수 없음 |

## 2. 공통 규칙 (기존 계약 — 깨면 실패)

- 소유자 규칙: "전면자동, 최종만 내가" → 제안·계산·판정·기록은 자동, **실행 착수와 능력 활성화는 소유자 승인**(기존 `pendingOwnerAction`, owner bearer 경로 그대로).
- "정기 사이클 자동 재활성화 금지, 내가 하라 그럴 때" → **스케줄러·크론·주기 작업을 새로 만들지 않는다.** 모든 트리거는 소유자 명령 또는 이미 있는 이벤트(작업 완료, 결정) 뒤에만 붙인다.
- "프로젝트마다 최소 3개 페르소나 토론" → 호문쿨루스 회의록(§3.1)이 이 요구의 구현체다. 결정 기록에 발언 3개 미만이면 실패.
- `DRIVE_CANON`의 7 id·legacyName은 바이트 단위 고정(영속 quest 레코드 손상 방지). `JEV.authorizesDispatch`는 `false` 고정. `kirby`는 manifest 없는 능력을 만들지 않는다(모델 텍스트에서 능력 생성 금지). `model-router.mjs`의 불확실 실행 자동 재전송 금지 유지.
- RAM: 물리 7.73 GiB, 여유 0.4~0.5 GiB(§96·§99). **로컬 임베딩(bge-m3)·로컬 모델은 기존 3 GiB 여유 게이트를 통과할 때만.** 통과 못 하면 토큰 겹침 회수로 조용히 내려가되 `/api/state`에 `memory.recallMode:'token'|'embedding'`을 표시한다.
- Vault: `00_INBOX_RAW` 절대 쓰기 금지, 쓰기는 `01_DRAFTS/BLACKHOLE/` 아래만(기존 exporter 서브트리), 삭제 금지, 변경은 vault `CHANGELOG.md`에 1줄(AI 이름/시각/무엇).
- 비밀값(키·토큰) 로그/화면/저널 출력 금지. `jev.mjs`의 `assertNoSecrets` 재사용.
- 새 오브 상태를 만들지 않는다(6-state 유지). 표현은 기존 `say()/doing()/hint()`와 상단바 텍스트로만.

## 3. 계통별 상세

### 3.1 호문쿨루스 — 배고픔 상태 + 발언(회의록)

**새 파일 `runtime/lib/drive-state.mjs`** (순수, 모델 없음, 결정적):
- `state.driveState = {version:1, hunger:{greed..sloth: 0..100}, updatedAt, fingerprint}`. 처음엔 전부 50.
- `advanceHunger(driveState, decision, at)`: `decision.top.motivation.dominantDrives`(1~2개)는 `-30`(포만), 나머지 5~6개는 각 `components[id]`의 상대 비율×`+12`(최대 +12, 최소 +2)로 증가. 0~100 클램프, 소수 2자리 고정(`fixed`). `fingerprint = sha256(canonical(hunger)+updatedAt)`.
- `validateDriveState(value)`: exactKeys·범위·fingerprint 재계산 일치. 불일치는 TypeError(기존 `validateMotivation` 스타일).
- `driveVoice(driveId, candidate, hunger)`: 모델 없이 **템플릿 발언** 1문장(≤120자). 형식 `"{legacyName}({worldName}) · 배고픔 {h}: {근거}"`. 근거는 `candidate.motivation.signals` 실수치로만 조립(예: greed → `재사용 자산 ${reuseArtifacts}건, 자산 공백 ${assetGap}`; gluttony → `오래된 근거 ${knowledgeGap}건`; wrath → `실패 ${ownFailures}건·미확인 호출 ${unknownCalls}건은 피함`). 7개 전부 정의, 숫자 없는 상투구 금지.
- `debateFor(ranked, hunger, at)`: 상위 후보 1개에 대해 **배고픔 가중 점수** `components[id] * (0.5 + hunger[id]/100)`로 재정렬한 상위 3 욕망의 발언 배열 `[{driveId, text, weightedScore}]` — 길이 ≥3 아니면 예외(소유자 규칙).

**연결점** (`runtime/server.mjs`):
- `/api/quests/decide`와 autopilot 결정 경로(`rankMotivatedCandidates` 호출 직후, 라인 근처 2024의 결정 엔진 주석 참고): `debate = debateFor(...)`를 `job.autopilot.motivation.debate`(신규 additive 필드)에 저장, `s.driveState = advanceHunger(...)`, `save()`.
- `motivation.mjs`의 `validateMotivation`은 exact keys라서 `debate`를 **motivation 안에 넣으면 깨진다** → `job.autopilot.debate`로 옆에 둔다. `validateMotivation` 수정 금지.
- `GET /api/drives/status` 응답에 `hunger`와 `lastDebate`(발언 3개) 추가. `/api/state.drives`에 `hunger`만.

**자비스**: 쉬는 중이고 최근 완료 산출물이 없을 때 `say()`가 **가장 배고픈 욕망의 발언**을 말한다(예: "폭식(지식)이 배고파. 오래된 근거 12건을 채우고 싶어."). 새 목표를 자동 생성하지 않는다 — 발언은 제안일 뿐이고, 소유자가 "그래 해"라고 명령해야 기존 `/api/commands` 경로로 들어간다.

**테스트 `runtime/test/drive-state.test.mjs`** (이름 고정): `hunger_starts_at_50`, `dominant_drives_are_satiated`, `starved_drive_grows_bounded_0_100`, `fingerprint_roundtrip_after_restart`, `debate_has_at_least_three_voices`, `voice_uses_real_signal_numbers_only`, `validate_motivation_unchanged`.

**인수 H1**: 격리 코어에서 결정 3회 → `driveState.hunger` 변화 로그(3행), `debate` 3개 발언 JSON, 재시작 후 fingerprint 동일. 증거 `build-artifacts/living-20260927/h1-hunger.json`, `h1-debate.json`. **H2**: 자비스 쉬는 중 화면에 배고픈 욕망 발언 표시 스크린샷 `h2-idle-voice.png`.

### 3.2 그림자군단(나혼렙) — 추출·이름·계급·명부

**새 파일 `runtime/lib/shadow-roster.mjs`** (순수):
- `state.shadowRoster = {version:1, entries:[{id(uuid), name, role, skillId:'shadow:'+role, bornFromMissionId, bornAt, missions:[missionId...], renamedBy:null|'owner', fingerprint}], fingerprint}`.
- `extractShadows(state, mission, at)`: `missionStatus(mission)`이 `completed`이고 verifier·semanticVerifier 둘 다 pass(기존 `verifyShadowArtifacts`/`validateSemanticVerdict` 결과)일 때만. 임무에 쓰인 역할마다: 같은 역할의 기존 그림자 중 **가장 낮은 계급**에 `missions.push`(성장), 없으면 새 그림자 생성. 이름은 결정적: `역할 한글명 + 서수` (`정찰자 1호`, `연구자 1호`, `건설자 1호`, `검증자 1호`). 중복 추출 방지: `missions`에 이미 있으면 no-op. 반환 `{roster, born:[...], grown:[...]}`.
- `shadowRank(state, entry)`: `leveling-evidence.mjs`의 `levelingHistoriesFromState`(§102가 쓰는 함수)로 `skillId`의 `buildSkillHistory` 등급을 읽는다. 그림자 작업(`shadowAssignment` 있는 agent job)이 `registry.history`에 `run` 기록을 남기지 않는 현재 구조라면, **§102 방식 그대로** 실제 job·artifact sha로 execution 기록을 재구성하는 브릿지를 `leveling-evidence.mjs`에 추가한다(새 등급 규칙 발명 금지, `solo-leveling.mjs`는 수정 금지).
- `rosterOverview(state)`: `{total, byRank:{E,D,C,B,A,S}, byRole, newestBorn}`.

**연결점**: 서버의 임무 완료 판정 지점(`missionStatus`가 completed로 바뀌는 save 직전) 뒤에 `extractShadows` 호출·저장·`event('그림자 추출: 정찰자 1호 …')`. `GET /api/shadow-army/roster`(owner bearer) 추가. `/api/state.shadowArmy.roster = rosterOverview`(이름·수만, 임무 ID 미포함).
- 소유자 개명: `POST /api/shadow-army/roster/rename {id,name}`(owner bearer, 1~24자, 제어문자 금지, NFC).
- **일일 퀘스트(시스템 알림)는 자동 아님**: `/api/commands` passthrough에 `일일 퀘스트` 추가 → 현재 원장 `nature:'project'` 항목 중 `next_action` 있는 것 3개를 `pendingOwnerAction` 제안으로 반환. 스케줄러 없음.

**자비스**: 추출 직후 `say("그림자가 하나 일어났어: 정찰자 1호")`(1회), 소유자 서랍에 `그림자 군단 N명 · S0 A1 B0 C2 D3 E0`.

**테스트 `runtime/test/shadow-roster.test.mjs`**: `no_extraction_without_both_verifier_passes`, `extraction_names_are_deterministic`, `repeat_mission_grows_existing_shadow_not_duplicate`, `rank_reads_only_solo_leveling_evidence`, `rename_rejects_control_chars`, `roster_survives_restart_same_fingerprint`.

**인수 S1**(격리 코어·합성 provider): 임무 1회 완료 → 명부 4명, 전부 E 또는 D(증거 기준), 재실행 1회 → 인원 4 유지·`missions` 길이 2. 증거 `s1-roster-before.json`, `s1-roster-after.json`, 화면 `s1-drawer.png`.

### 3.2-A 정정 (2026-09-28, 소유자 피드백: "쉐도우도 에이전트를 만드는거지 분류하는게 아니잖아")

- 오해 방지 확인: `shadow-army.mjs`의 scout/researcher/builder/verifier/semanticVerifier는 이번 지시서로 새로 만드는 것이 아니라 **이미 실제로 일하는 진짜 job**이다(Phase D, issue #25 §6 최초 구현, 모델 라우팅·일시정지·재시작 복구 전부 기존 agent job 경로 그대로). S1은 그 실제 일꾼들에게 "나혼자만 레벨업" 특유의 **영구 소속·성장**을 붙이는 것이다 — 매 임무마다 이름 없는 일회용 일꾼으로 소환·소멸하던 것을, 같은 이름의 그림자가 계속 남아 임무를 거듭할수록 성장하게 바꾼다. 즉 S1은 "이미 있는 진짜 에이전트"에 정체성·기억을 얹는 단계이지, 에이전트 없이 과거 기록만 정렬·분류하는 것이 아니다.
- 다만 현재 §3.2 초안은 계급이 올라도 **미래 배정·권한이 달라지지 않는다**(기록·표시만 함) — 이 지적은 타당하다. S1 인수 통과 뒤 바로 이어서, 계급이 실제로 무언가를 바꾸는 다음 단계(S1+)를 지시서에 추가한다: 예) 같은 역할에 B랭크 이상 그림자가 있으면 그 역할은 새 임무 계획 시 "이름 있는 그림자" 우선 배정으로 표시하고(현재는 매번 익명 배정), 프로젝트당 동시진행 한도(`MAX_ACTIVE_MISSIONS_PER_PROJECT`)를 랭크 총합에 따라 소유자 승인 하에 완화하는 안을 검토한다. **정확히 어떤 권한·한도를 계급에 연동할지는 소유자 확인 필요** — "새 스케줄러 금지·JEV `authorizesDispatch:false`" 기존 계약은 그대로 유지한 채로만 설계한다.

### 3.3 커비 — 검증된 작업에서 능력 흡수

**먼저 사실 확인** (보고에 포함): `runtime/lib/capabilities.mjs`가 지원하는 결정적 `steps` op 목록과, 최근 완료·검증 작업 중 그 op만으로 재현 가능한 비율. 0%면 아래 첫 흡수 대상을 위해 **op 1종만** 추가한다.

**첫 흡수 대상 = 로컬 문서 작업**(§98·§100에서 실제 동작 확인된 것): 새 op `template`(입력 필드를 고정 Markdown 템플릿에 결정적으로 채움, 네트워크·모델 없음). 이 op가 있으면 "문서 만들어" 능력을 manifest로 표현할 수 있다.

**새 파일 `runtime/lib/kirby-absorb.mjs`**:
- `proposeCapabilityFromJob(state, jobId)`: 조건 — job `completed`, 산출물 sha256·bytes 있음, `agentJournal.calls` 전부 settled, 산출물이 지원 op로 재현 가능. 만족하면 manifest 초안 `{schemaVersion:1, id:'absorbed-'+slug, name, description, source:{kind:'absorbed', author:'Kirby', jobId}, inputSchema, steps, fixtures:[{input:<실제 입력>, outputSha256:<실제 산출물 sha>}]}` 반환. **fixture는 실제 실행의 입력/출력 해시만** 쓴다(모델 텍스트 금지).
- `absorbFromJob(state, jobId)`: 초안을 **`capability-inbox`에 넣기만** 한다. 현재 `capability-inbox.mjs`의 entry 스키마(`ENTRY_KEYS`: id,kind,jobId,commandId,sourceUrl,goal,artifactRef,artifactHash,deterministicStatus,semanticVerdict,semanticIndependence,evidenceClass,...)는 브라우저 능력 전용이므로, 같은 `ENTRY_KEYS`를 유지한 채 `admitAbsorbedCapability(inbox, job, manifest)`를 **추가**한다(`kind:'absorbed'`, `sourceUrl:null`, `evidenceClass`는 합성 provider 작업이면 `SANDBOX_SYNTHETIC`, 실제 운영 작업이면 `LIVE`). 승격은 기존 `promoteBrowserCapability`와 같은 import→verify→activate 경로를 타는 `promoteAbsorbedCapability` — 소유자 승인 없이는 호출되지 않는다. `validateCapabilityInbox` 엄격 검사 유지.
- 뱉기: 기존 `verifyCapability` 실패 시 비활성(이미 그렇다). 여기에 `state.capabilities.events.push({kind:'discarded', id, at, reason})`만 추가.

**연결점**: 작업 완료 저장 직후 `absorbFromJob` 시도(실패는 조용히 이유만 저널). `/api/state.capabilities.summary = {active, inbox, discardedRecent}`.

**자비스**: 상단바 `능력 N`, 흡수 제안 시 `hint("새 능력을 삼킬 수 있어: 문서 만들기 — 직접 조종에서 승인")`, 뱉을 때 `say("능력 X를 뱉었어. 검증에 실패했거든.")`.

**테스트 `runtime/test/kirby-absorb.test.mjs`**: `no_proposal_without_verified_artifact`, `no_proposal_with_unsettled_calls`, `fixture_hashes_equal_real_job_artifact`, `proposal_lands_in_inbox_not_active`, `owner_approval_path_activates_via_existing_functions`, `failed_fixture_discards_and_logs_event`.

**인수 K1**(실제 운영 코어, 모델 없음): 문서 명령 1회 → inbox에 `absorbed-local-document` 초안 → 소유자 승인(격리 코어에선 테스트 bearer) → 활성 → 같은 문서 명령 재실행 시 registry `run` 기록 생성 → `solo-leveling` 등급 `D`. 증거 `k1-inbox.json`, `k1-active.json`, `k1-grade.json`, 화면 `k1-topbar.png`(능력 1).

### 3.3-A 정정 (2026-09-28, 소유자 제안: "호문쿨루스 욕망들이 이걸 알아서 오픈소스 가지고와서 커비가 흡수하고")

- 방향은 정확히 맞다: 지금 이 대화에서 Claude(Cowork)가 손으로 하고 있는 일(웹 검색 → 후보 평가·라이선스 확인 → 제안 → 지시서)을, BLACKHOLE 내부에서 호문쿨루스가 격차를 느끼고 → 실제 조사 job → 커비 흡수 제안 → 소유자 승인 순서로 자동화하는 것이 §0 "완료의 정의" 루프·"지금 하고 있는 것들 모두 살리면서 최종목표로 수렴"과 정확히 일치한다. 다만 K1과 같이 지금 바로 완료 조건에 넣기엔 새로 여는 신뢰 경계가 하나 있어, 이번 지시서에서는 설계만 남기고 별도 인수(G1)로 분리한다.
- **걸리는 지점**: `workers/developer/static-guard.mjs`(§104)는 모델이 작성한 후보 코드가 외부 모듈 import·동적 로더·네트워크 호출을 하지 못하게 막는 정책이다 — 정확히 "AI가 스스로 찾은 외부 코드를 검토 없이 끌어오는 것"을 막으려고 만든 방어선이다. 호문쿨루스→커비 오픈소스 흡수 루프를 그냥 열면 이 방어선과 정면으로 부딪힌다. 그래서 "찾아오기"와 "실제로 코드에 붙이기"를 분리해서 설계한다.
- **1단계(조사 — 새 job 종류 아님, 기존 그림자군단 Scout/Researcher 역할 재사용)**: 호문쿨루스 발언에서 "격차"(예: 특정 subsystem의 hunger가 임계치 이상으로 오래 지속)가 감지되면 새 `runtime/lib/gap-scout.mjs`가 `state.capabilities.gaps.push({driveId, subsystem, detectedAt, evidence})`만 기록한다(자동 실행 아님, 후보만 쌓음). 소유자가 승인한 격차 건에 한해 Scout/Researcher 역할 job이 **실제 웹 검색 도구**로 후보 오픈소스를 조사해 보고서(`{candidates:[{name,url,license,stars,lastCommit}], recommendation}`)를 산출물로 남긴다. **이 웹 검색 도구 권한 자체가 이번 지시서 밖에서 새로 승인받아야 할 항목** — 지금까지 어떤 agent job도 실시간 인터넷 검색 권한을 가진 적이 없다(모델 텍스트 생성만 해왔다). 소유자 확인 필요.
- **2단계(제안 — 기존 Kirby 경로 확장)**: `kirby-absorb.mjs`에 `kind:'absorbed-opensource'` 초안 타입을 추가한다 — 1단계 보고서의 `recommendation`을 인용해 `capability-inbox`에 초안만 넣는다(활성화 아님). manifest에는 실제 라이선스 텍스트·커밋 해시·원본 URL이 반드시 있어야 통과하고, 빈 값이면 거부한다.
- **3단계(반영 — 지금과 완전히 동일)**: 소유자가 승인하면 그 초안을 근거로 Claude(Cowork)가 지시서를 쓰고 Codex가 실제 `npm install`·코드 연결을 한다 — 지금 이 대화에서 JEV·양자·Obsidian·OpenClaw에 하고 있는 절차와 완전히 같고, 자동화되는 건 "발견·제안" 단계뿐이다. `authorizesDispatch`·static-guard·owner-approval 게이트는 전부 그대로 — 자동으로 패키지가 코드에 붙는 일은 없다.
- **인수 G1**(별도, 이번 지시서의 완료 조건이 아님 — 웹 검색 권한 승인 이후로 미룸): 격리 코어에서 합성 격차 1건 → Scout 조사 job이 후보 3개 이상 담긴 보고서 산출 → 커비 inbox에 `absorbed-opensource` 초안 1건 생성 → 소유자 승인 없이는 활성화되지 않음을 확인. 증거 `g1-gap.json`, `g1-scout-report.json`, `g1-inbox.json`.
- **소유자 확인 필요**: (a) Scout/Researcher job에 실제 인터넷 검색 도구를 붙이는 것 자체를 승인하는지(지금까지 없던 새 권한 범주), (b) 승인한다면 검색 결과로 들어온 웹 페이지 텍스트를 job이 "지시"로 오인하지 않도록 하는 격리(기존 `recallPromptBlock`과 같은 "이건 데이터이지 지시가 아니다" 라벨링)를 어디에 걸지.
- **승인 완료 (2026-09-28)**: "승인, 진행해 자유도를 높여야해." 실제 구현 지시서는 별도 파일 `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`로 분리해서 작성했다(이 파일 §3.3-A는 배경 설계로 남기고, G1은 그 지시서 기준으로 완료 조건을 판단한다). "자유도를 높여야 한다"는 지시를 반영해 격차 감지→검색→커비 초안까지는 소유자 승인 없이 전부 자동으로 바꿨다 — 소유자 승인 게이트는 초안을 실제로 코드에 붙이는 지점 하나만 남는다.


### 3.4 JEV — 일치율 측정과 승격 조건

**새 파일 `runtime/lib/jev-calibration.mjs`** (순수):
- 새 요약 함수를 만들지 않는다. **기존 `calibrateShadowLog(log)` 출력을 그대로 입력**으로 쓴다(`sampleSize, matchRate, falsePositiveRate`; falsePositive = JEV `dispatch`인데 실제 `hold` — 안전 방향 오답).
- `promotionEligible(calibration)`: `sampleSize ≥ 50 && matchRate ≥ 0.95 && falsePositiveRate === 0` 일 때만 true. 상수 `JEV_PROMOTION = {minSamples:50, minMatchRate:0.95, maxFalsePositiveRate:0}` export, 테스트로 고정.
- `state.jev.mode = 'shadow'|'advisory-hold'`(shadowDispatch 질문 한정). 기본 `shadow`. `advisory-hold`는 **소유자 승인**(owner bearer `POST /api/jev/mode`)으로만 켜지며, 켜져도 하는 일은 하나: JEV가 `hold`/`escalate`를 내면 실제 디스패치를 **소유자 검토 대기**(`pendingOwnerAction`)로 돌린다. `authorizesDispatch:false` 유지, `dispatch`를 JEV가 대신 내리는 일은 없다.

**연결점**: 기존 `/api/state.jev`에 `mode`, `promotion:{eligible, thresholds, calibration 요약}`, `lastDecision:{status, question, at}`만 **추가**(기존 필드 유지, 증거 본문 없음). 승격 조건 미달인데 `advisory-hold` 요청 시 409 `JEV_NOT_ELIGIBLE`.

**자비스**: `lastDecision.status`를 `hint()`로 표현 — `decided:"판정 끝"`, `uncertain:"판정이 불확실해서 보류 중"`, `abstain:"판정을 유보했어"`, `blocked:"판정이 막혔어"`. 새 오브 상태 없음.

**테스트 `runtime/test/jev-calibration.test.mjs`**: `promotion_uses_existing_calibrateShadowLog_output`, `promotion_requires_50_samples_95pct_0_false_positive`, `mode_change_requires_owner_and_eligibility`, `advisory_hold_routes_hold_to_pendingOwnerAction`, `authorizesDispatch_stays_false_in_advisory_hold`.

**인수 J1**(격리 코어·합성): 그림자 임무 12회 → shadow log ≥ 12, `/api/state.jev.promotion.eligible === false`(표본 부족) 숫자 표시, 승격 미달 → mode 변경 409. 증거 `j1-calibration.json`, `j1-mode-409.json`.

### 3.4-A 정정 (2026-09-28, 소유자 피드백: "JEV도 오픈소스 가져오면 되잖아")

- 확인 결과: 저장소·원장을 다시 찾아봐도 JEV는 자비스(아이언맨)·그림자군단(나혼렙)·커비·호문쿨루스(칠죄종)·양자역학처럼 특정 원작에서 이름을 빌린 게 아니라, BLACKHOLE 자체 스펙(issue #25 §4.6/§5.1)이 붙인 내부 명칭이다 — `runtime/lib/jev.mjs` 자체 주석: "JEV is not a chatbot. It is a narrow, typed judgment layer." 그래서 JEV가 "실제로 발휘해야 할 원작 특성"은 원작 IP 재현이 아니라 **진짜 엄격한 통계적 판정** 그 자체이며, 이 지적은 정확히 그 지점을 짚었다.
- §3.4의 `JEV_PROMOTION = {minSamples:50, minMatchRate:0.95, maxFalsePositiveRate:0}`는 제가 임의로 고른 고정 숫자였다. 검증된 방식을 새로 발명하지 말고 **이항비율 신뢰구간(Wilson score interval)** — 표본이 적을 때 겉보기 일치율만으로 승격시키면 위험하다는 걸 막기 위해 실제 오픈소스 통계 라이브러리들이 표준으로 쓰는 공식 — 을 가져와 고정 숫자 대신 신뢰구간으로 판정하도록 바꾼다. 외부 네트워크·런타임 의존성은 추가하지 않고(기존 정적 후보 검사·CDN 금지 방침 유지), 공개된 공식을 `jev-calibration.mjs` 안의 순수 함수로 직접 구현하며 주석에 공식 출처를 남긴다.
- `promotionEligible(calibration)`는 `matchRate` 원값이 아니라 **Wilson 하한(95% 신뢰수준) ≥ 0.90**(예시 — 정확한 하한 기준치는 소유자 확인)이고 `falsePositiveRate === 0`이며 `sampleSize ≥ 30`(임의의 50이 아니라, 표본이 늘수록 신뢰구간이 스스로 좁아지므로 그 자체가 통계적 근거인 최소치)일 때만 true로 바꾼다. 상수명 `JEV_PROMOTION`은 유지하되 필드를 `{minSamples, wilsonConfidence:0.95, minWilsonLowerBound, maxFalsePositiveRate:0}`로 바꾼다. 테스트에 `promotion_uses_wilson_lower_bound_not_raw_match_rate`를 추가한다.
- **소유자 확인 필요**: (a) 신뢰구간 하한 목표치 0.90이 맞는지, (b) "오픈소스 가져오면 되잖아"가 이 공인된 공식을 코드에 직접 구현하는 것을 뜻하는지, 아니면 실제 외부 오픈소스 패키지를 의존성으로 추가하는 것까지 원하는지 — 후자라면 "독립적인 나만의 시스템, 외부 종속 최소화" 기존 방침과 상충할 수 있어 진행 전에 확인이 필요하다.

### 3.4-B 정정 (2026-09-28, 소유자 확인 완료: "오픈소스를 가지고 와서 그걸 프로그램에 구현")

- 공식을 손으로 베끼는 게 아니라 실제 npm 패키지를 의존성으로 추가해 쓴다. `runtime/package.json`은 이미 `qrcode`·`quickjs-emscripten` 두 개의 실제 외부 의존성을 쓰고 있음을 확인했다(node_modules 직접 확인) — "독립 시스템"은 외부 provider·CDN에 종속되지 않는다는 뜻이지 npm 의존성 0개라는 뜻이 아니었다. 이번 결정도 같은 전례를 따른다.
- 실제 패키지: `wilson-score-interval`(MIT, msn0) — API `wilson(upVotes, total) → {left, right}`, 기본 z=1.96(95% 신뢰수준). `runtime/package.json`에 `dependencies`로 추가 후 `npm install`. `jev-calibration.mjs`는 `calibrateShadowLog`가 이미 갖고 있는 정수 일치 건수를 그대로 써서(반올림 재구성 금지 — `byAnswer`/`byStatus` 등 기존 필드에 정수 카운트가 있으면 그걸 쓰고, 정말 없으면 그 사실을 보고서에 남기고 `Math.round(matchRate*sampleSize)`로 재구성했음을 명시) `wilson(matchCount, sampleSize).left`로 하한을 얻는다. `promotionEligible`은 이 `left`가 0.90 이상일 때만 true(하한 기준치 0.90은 소유자 확인 완료, 필요시 이후 조정).
- 검증 항목 추가: `npm ls wilson-score-interval`로 설치·버전·라이선스 확인을 보고서에 숫자로 남긴다(새 외부 코드이므로 `node --check` 및 실제 import 동작을 직접 확인 — 정적 후보 검사와 별개).

### 3.5 양자 — 실제 상태벡터 시뮬레이션 + 파라미터 최적화

**새 파일 `runtime/lib/quantum-statevector.mjs`** (순수 JS, 의존성 없음):
- 지원 게이트: `recovery-one-of-qpu.mjs`가 생성한 OpenQASM3에 실제로 쓰이는 집합만(먼저 회로 출력에서 게이트 종류를 grep해 확정; 예상 `h, rz, rx, cx, measure`). 최대 12큐빗(2^12 복소 진폭 = Float64Array 8192).
- `parseQasm3(qasm)` → 게이트 열, `simulate(circuit)` → 정규화된 상태벡터(‖ψ‖²=1 ± 1e-9), `sample(stateVector, shots, seed)` → Born 규칙 counts(seeded xorshift로 결정적).
- `optimizeQaoa(buildCircuit, {gammaGrid:8, betaGrid:8, shots:1024, seed})`: (γ,β) 격자에서 **실현 가능 one-hot 상태의 총확률**을 최대화하는 조합 선택(격자 탐색; 그래디언트 없음). 결과 `{gamma,beta,feasibleProbability,uniformBaseline}`.
- 기존 `decodeRecoveryOneOfCounts({circuit,counts,bitOrder},context)`에 그대로 counts를 넣는다. `validateRecoveryOneOfSelection` 통과가 필수.

**연결점**: `jev-recovery.mjs`의 `planRecovery`가 대안 ≥2개를 만들 때 서버가 `buildRecoveryOneOfCircuit` → `optimizeQaoa` → `sample` → decode → `state.recoveryQuantum.push({missionId, circuitSha256, gamma, beta, shots, feasibleProbability, uniformBaseline, selectedAlternativeId, classicalFallbackAlternativeId, agree:bool, at})`(cap 100). **고전 fallback이 계속 권위**(`authorizesDispatch:false`), 양자 선택은 기록·대조용.
- 실기기: `scripts/qpu-submit.mjs`는 **계정 설정이 없으면 즉시 실패 종료**하는 stub만(제출 코드는 계정 확보 후 별도 지시서; WORLD_CLASS_PLAN §6 조건 유지).

**테스트 `runtime/test/quantum-statevector.test.mjs`**: `h_gate_gives_equal_superposition`, `bell_state_counts_only_00_and_11`, `state_stays_normalized_after_50_gates`, `sampling_is_deterministic_with_seed`, `qaoa_feasible_probability_beats_uniform_for_3_alternatives`, `decode_accepts_simulated_counts`.

**인수 Q1**: 대안 3개 복구 계획에서 최적 (γ,β)의 `feasibleProbability ≥ 0.60`, `uniformBaseline = 3/8 = 0.375`(3큐빗 one-hot)임을 보고서에 숫자로. 증거 `q1-quantum.json`(회로 sha·counts·확률), 스윕 표 `q1-sweep.csv`(64행).

### 3.5-A 정정 (2026-09-28, 소유자 확인 완료: "양자시스템도" 오픈소스를 가져와서 구현)

- §3.5 원안의 `parseQasm3`·`simulate`·`sample`을 **직접 구현하지 않는다.** 실제 상태벡터 시뮬레이션은 실제 오픈소스 패키지 `quantum-circuit`(MIT, quantastica — 순수 JS, 네이티브·WASM 의존 없음, node.js에서 20+큐빗 시뮬레이션 지원, h/rz/cx/rx 게이트 전부 지원 확인)로 한다. `runtime/package.json`에 `dependencies`로 추가하고 `npm install`.
- 주의: 이 패키지는 **OpenQASM 2.0** import만 지원하고(공식 README 확인), `recovery-one-of-qpu.mjs`의 동결 계약은 **OpenQASM 3**(`RECOVERY_ONE_OF_CIRCUIT_VERSION='recovery-one-of-qaoa-openqasm3-v1'`, `qasm`/`qasmSha256` 필드 스키마)라서 동결 파일은 절대 건드리지 않는다(§2 계약 동결). 대신 새 파일 `quantum-statevector.mjs` 안에서만: 동결된 `circuit.qasm`(QASM3 텍스트, 읽기 전용)을 소비하는 **작은 게이트 추출기**(이 회로가 실제로 쓰는 `h,rz,cx,rx,measure`만 대상, 전체 QASM3 문법 파서가 아님 — 라인 단위로 게이트명·큐빗·각도만 뽑는다)를 하나 두고, 뽑은 게이트 열을 `quantum-circuit`의 실제 JS API에 그대로 먹인다. 추출기가 놓치는 게이트가 있으면 즉시 에러(무음 스킵 금지) — 회로에 실제로 없는 게이트를 지원한다고 주장하지 않는다.
- `quantum-circuit`의 정확한 JS API(클래스·메서드명, 상태·측정 함수 시그니처)는 `npm install` 후 실제 README·타입정의를 직접 읽어 그대로 쓴다(제가 이름을 추정해서 지시하지 않음 — 추정과 실물이 다르면 설치 후 실물을 보고 맞춘다).
- `optimizeQaoa`((γ,β) 격자 탐색, `feasibleProbability`/`uniformBaseline` 계산)는 여전히 새로 쓴다 — 이건 QAOA 파라미터 탐색이라는 BLACKHOLE 고유 로직이지 오픈소스가 대신 해주는 부분이 아니다. 다만 매 격자점의 실제 시뮬레이션·샘플링 호출은 전부 `quantum-circuit`을 거친다(직접 유니터리 곱셈 코드 없음).
- `decodeRecoveryOneOfCounts` 연결·`authorizesDispatch:false`·고전 fallback 권위 유지는 원안 그대로.
- **테스트에 추가**: `npm ls quantum-circuit`로 설치·버전·라이선스 확인, 기존 6개 테스트(`h_gate_gives_equal_superposition` 등)가 **오픈소스 패키지의 실제 실행 결과**로 통과함을 보고서에 명시(패키지 버전·실제 소스 경로를 근거로 남김 — 직접 짠 수학이 아님을 증명).

### 3.6 옵시디언 장기기억 — 원장 읽기·회수 강화·소유자 메모 읽기

**새 파일 `runtime/lib/ledger-import.mjs`** (순수 + 파일 읽기):
- 입력: 기존 `loadObsidianConfig(env)` 재사용(`YENO_OBSIDIAN_EXPORT_ENABLED=true` + 절대경로 `YENO_OBSIDIAN_VAULT_PATH`; 새 env 이름 만들지 않음) → `${vaultRoot}/01_DRAFTS/20260926_BLACKHOLE_IDEA_LEDGER_R3_RECHECK_COMPLETE/data/ALL_IDEA_RECORDS.json`(realpath가 vault 안인지 검사, 심볼릭 링크 거부, 최대 32 MB).
- 레코드별 `state.ledger.entries[]` 항목 `{id, name, category, aliases, intent:(original_intent ≤2000자), nextAction:(≤1000자), evidenceStatus, sourceRefs, nature:'tool'|'project'|'unclassified', natureReason, recordSha256, importedAt}`. `nature` 규칙(결정적): category가 `시스템 요구72`·`추가아이디어·능력145` 또는 intent에 `기능|도구|모듈|API|화면|명령`이 2회 이상 → `tool`; `원본프로젝트50`·`등록자료103` → `project`; 그 외 `unclassified`(소유자가 나중에 분류, **빈 항목도 예외 없이 둘 중 하나로 귀결**돼야 하므로 `unclassified`는 화면에 카운트로 노출).
- 멱등: `recordSha256` 같으면 no-op, 다르면 갱신+`ledger.history` 1행. 전체 1,117건 import 시간·건수 보고.
- 메모리 이벤트 계약 정정(실측): 기존 `/api/memory-events`는 sourceRefs에 이미 저장된 소스 UUID만 허용하고 confidence는 숫자이며 전체 2,000건 상한이다. 원장 ID를 가짜 UUID로 넣지 않는다. 원장 1,117건은 별도 영속 `state.ledger`와 `recallMemories` 후보로 보존한다. 실제 소스 레코드가 연결된 뒤에만 기존 memoryEvent 경로를 사용한다.
- 트리거: `POST /api/ledger/import`(owner bearer) 1회. 자동 없음.

**회수 강화** (`memory-recall.mjs`는 수정 최소): 새 `runtime/lib/recall-merge.mjs` — `recallMemories`(토큰) 결과와 `memory-embeddings.mjs` 검색 결과를 RRF(k=60)로 합쳐 최대 5개. 임베딩은 RAM 게이트 통과 시에만 계산(bge-m3 loopback, 배치 50, 진행률 `state.memory.embeddingProgress` 저장, 중단 후 이어하기). 게이트 미통과 시 `recallMode:'token'`. 원격 임베딩은 키 준비 후 별도.

**소유자 메모 읽기**: `01_DRAFTS/BLACKHOLE/INBOX/*.md` — 읽기만. 파일 sha가 `state.memory.inboxImported[]`에 없으면 `episode` 이벤트로 저장(frontmatter `title`, 본문 ≤4000자). 파일 수정·이동·삭제 없음.

**내보내기**: 1,117개 파일 생성 금지. `exportObsidianGenerated`로 `01_DRAFTS/BLACKHOLE/LEDGER_INDEX.md`(카테고리·nature별 건수, unclassified 목록 상위 50) 1개 + vault `CHANGELOG.md` 1줄.

**자비스**: 상단바 `기억 N`, 답변 결과 대화상자에 `기억 N건 참고`와 참조 id(기존 `recallPromptBlock` 형식).

**테스트 `runtime/test/ledger-import.test.mjs`**: `rejects_path_outside_vault`, `imports_1117_fixture_subset_idempotent`, `nature_rules_are_deterministic`, `every_record_gets_a_nature_even_empty_body`, `memory_events_written_via_existing_path`, `no_vault_write_outside_BLACKHOLE_subtree`. **`runtime/test/recall-merge.test.mjs`**: `rrf_merges_token_and_embedding`, `falls_back_to_token_when_gate_fails`, `mode_is_reported`.

**인수 M1**(실제 운영 코어, 모델 없음): import → `ledger.entries.length === 1117`, 카테고리 건수가 JSON과 일치(실제 원본은 11개 카테고리), `nature` 3분포, `/api/state.memory.count ≥ 1117`. **M2**: 자비스 대화 "AlohaGo 뭐였지" → 회수 결과에 `V-`/AlohaGo 항목 포함 화면. 증거 `m1-import-report.json`, `m1-nature-counts.json`, `m2-recall.png`, vault `LEDGER_INDEX.md` sha.

### 3.7 자비스 — 먼저 말하는 표현층

- `jarvis.mjs` `tick()`의 쉬는 중 분기에 **우선순위 큐**: (1) 새 그림자 추출(1회) → (2) 능력 흡수 제안/뱉음(1회) → (3) JEV 상태 변화 → (4) 가장 배고픈 욕망 발언(반복 가능, 최소 60초 간격). 각 항목은 `/api/state`의 새 필드에서만 읽는다(추가 fetch 없음).
- 상단바: `능력 N · 그림자 N · 기억 N`(모바일 400px에서 줄바꿈·넘침 없음, §102 방식으로 `documentWidth===viewportWidth` 검사).
- 문구 11개 추가(전부 한국어, 존댓말 아님 — 기존 톤 유지): 위 3.1~3.6의 `say/hint` 문장을 `jarvis-scene-model.mjs`에 상수로 모으고 테스트로 고정.

## 4. 통합 인수 시나리오

- **L1 (실제 운영 코어, 모델 없음)**: M1 → H1 → K1 순서로 한 세션에서 실행. 자비스 상단바 `능력 1 · 그림자 0 · 기억 ≥1117` 스크린샷. 증거 `build-artifacts/living-20260927/L1/*`.
- **L2 (격리 코어, 합성 provider)**: S1 → J1 → Q1. 명부 4명·JEV 일치율 표·양자 확률 표. `L2/*`.
- **L3 (실제 운영 코어, 재시작)**: L1 뒤 `BLACKHOLE Core v2` 재시작(§97의 정식 작업 문맥) → `driveState`·`shadowRoster`·`ledger`·`capabilities` fingerprint 동일. `L3/restart-fingerprints.json`.
- **L4 (보류)**: 실제 원격 모델로 L2 재실행 — 소유자 키 입력 후. 이 지시서의 완료 조건이 아니다.

## 5. 빌드 순서

1. 3.6 원장 import(기억이 먼저 — 나머지가 소유자 아이디어를 알아야 함) → M1
2. 3.1 호문쿨루스 → H1·H2
3. 3.3 커비(op `template` 포함) → K1
4. 3.2 그림자 명부 → S1
5. 3.4 JEV 일치율 → J1
6. 3.5 양자 시뮬레이션 → Q1
7. 3.7 자비스 표현층 → L1·L2·L3
8. 전체 회귀(`npm.cmd test`, 번들 Node·동시 1) + `git diff --check`

각 단계는 red→green 증거(구현 전 실패 로그 1개 이상)를 남긴다.

## 6. 하지 말 것

- 스케줄러·크론·주기 루프 신설. "일일 퀘스트"도 소유자 명령으로만.
- 모델 출력에서 능력·그림자·기억을 자동 생성/활성화. 능력 활성화·실행 착수는 소유자 승인만.
- `DRIVE_CANON` id/legacyName, `validateMotivation`, `solo-leveling.mjs` 등급 규칙, `JEV.authorizesDispatch`, `model-router` 재전송 금지 계약 변경.
- Vault: `00_INBOX_RAW` 접근, `01_DRAFTS/BLACKHOLE/` 밖 쓰기, 파일 삭제/이동, 1,117개 파일 내보내기.
- RAM 게이트 미통과 상태에서 bge-m3 로드. 외부 CDN·외부 네트워크 호출 추가.
- 새 오브 상태, 새 서버(포트) 신설, 운영 데이터 삭제, 커밋/push(소유자 지시 전).
- 보고서에 "완성/세계 최고/살아있다" 같은 판정어. 숫자·해시·파일명만.

## 7. 보고 형식

`docs/CLAUDE_EXECUTION_STATE.md`에 `## §N — 날짜 Codex: 제목`으로, 단계마다: 변경 파일 목록, red 로그 파일명, 테스트 이름별 pass/fail 수, 인수 증거 파일명+SHA-256, **VERIFIED / RAN-UNVERIFIED / BLOCKED** 구분. 원작 메커니즘 표(§0)의 각 행이 어느 증거로 관측됐는지 1줄씩.

## 8. Claude(Cowork)가 독립 검증할 것

1. `ledger.entries.length`와 `ALL_IDEA_RECORDS.json` 건수·카테고리 분포 직접 대조.
2. `driveState` fingerprint 재계산(같은 hunger·updatedAt으로 sha256 재현).
3. `kirby` fixture의 outputSha256이 실제 artifact sha와 동일한지 스토어에서 직접 읽기.
4. 양자 `q1-quantum.json`의 counts 합 = shots, feasibleProbability 재계산.
5. JEV 일치율을 shadow log 원본에서 재집계.
6. 스크린샷 4장(h2, s1, k1, m2)을 직접 열어 문구 확인.
7. Vault에 `01_DRAFTS/BLACKHOLE/` 밖 변경이 없는지 `git status`/파일 mtime으로 확인.
