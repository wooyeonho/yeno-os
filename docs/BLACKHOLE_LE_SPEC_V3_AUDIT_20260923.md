# BLACKHOLE LE Spec v3 대조 원장 (2026-09-23)

기준 문서: 사용자가 제공한 `BLACKHOLE_LOCAL_HYBRID_EVOLUTION_SPEC.md` v3(v2는 이전 버전으로 폐기). 기준 코드: `wooyeonho/yeno-os` 브랜치 `blackhole/g1-integration-claude-20260922`, **실제 확인한 HEAD `0db4d70679c6d67d21afc6aad682c9f4c8ed7f72`**(git status clean, 확인 시각 2026-09-23). 이 문서는 `docs/BLACKHOLE_REQUIREMENTS_LEDGER_20260923.md`(F01~F14/R01~R52)를 대체하지 않고, v3가 새로 규정한 LE-01~07 계약과 A01~A14 인수 기준만 별도로 추적한다.

상태값: `구현됨`(코드+실제 검사 존재), `일부구현`(계약 일부 또는 인접 기능만 존재), `미구현`(코드에 해당 개념 없음, grep 0건으로 확인), `외부조건대기`(코드는 준비됐지만 실제 자격증명·하드웨어·설치가 필요).

## LE-01 기억과 임베딩

| 항목 | 상태 | 근거 |
|---|---|---|
| SourceRef/ChunkRef 계약(`allowedPurposes`, `sensitivity`, `chunkerVersion`, `embeddingModelId` 등) | 미구현 | `runtime/lib/sources.mjs`는 REF 소스 레지스트리(제목/URL/요약/decision pending·candidate)만 있음 — chunk 단위 분할, 임베딩 모델 필드, allowedPurposes 구분 없음. grep 0건. |
| 검색 경로(키워드+벡터 결합→rerank→근거 묶음) | 미구현 | FTS5·임베딩·rerank 관련 코드 0건(전체 grep 확인). 현재 검색은 `sources.mjs`의 단순 목록/필터뿐. |
| 한국어 tokenizer 평가 | 미구현 | 해당 평가집·tokenizer 비교 코드 없음. |
| 자료 철회 시 파생 chunk·adapter 추적 | 일부구현 | source의 `status`(active/stale 유사 개념)는 있으나 "이 자료를 학습한 adapter 중단" 개념 자체가 없음(학습 파이프라인이 없으므로 자연히 없음). |

## LE-02/LE-03 로컬 LLM·JEV·계획

| 항목 | 상태 | 근거 |
|---|---|---|
| 로컬 모델 실행기(llama.cpp류) provider 연결 | 미구현 | `runtime/lib/provider-config-engine.mjs`의 `AGENT_ENDPOINTS`에 openai/gemini/moonshot/xai/anthropic/nvidia 6개뿐 — 전부 원격 HTTPS, API 키 필수. loopback/무인증 provider 없음. `which ollama llama-server`도 이 기기에 없음(설치 자체가 안 되어 있음). |
| JEV 결정 순서(제외→비교→검증→정책→재검사) | 일부구현 | `runtime/lib/jev.mjs`의 `evaluateDecisions`는 dailyBudget/parallelSafe 등 **규칙 기반 shadow 판정**만 함. v3가 요구하는 "남은 후보의 기대가치·시간·비용·불확실성 비교" 같은 후보 랭킹 로직은 없음. |
| JEV Recovery 계약(`RecoveryProposal`/`Blockage`/`Alternative`/`AlternativeVerdict`) | 미구현 | 해당 타입·필드명 전체 grep 0건. 지금 시스템은 실패 시 `pauseReason`/`retryAt` 같은 단순 재시도만 함(§4/§16에서 검증한 스케줄러 fail-closed 재시도가 유일하게 근접한 기존 기능). |
| 모델 응답 schema 검사 + 1회 복구 재시도 | 구현됨(원격 provider에 한함) | `agent-engine.mjs`의 기존 회귀 검사(agent.test.mjs 등)로 이미 확인됨. 로컬 provider가 없으므로 로컬 모델 대상 검사는 없음. |

## 공통 실행 계약 (§7)

| 항목 | 상태 | 근거 |
|---|---|---|
| `requestId→missionId→jobId→attemptId→artifactId→evidenceId` 체인 | 일부구현 | 실제 store는 `job.id`, request ledger의 `requestId`(멱등성 키), `job.artifacts[]`(artifactId), `job.agentJournal.calls[].id`(attemptId에 가장 가까움)는 있으나 **missionId·evidenceId라는 명시적 필드/전용 원장은 없음** — quests.mjs의 `questId`가 missionId 역할에 가장 근접(완전 대응 아님). |
| `ExecutionEnvelope`/`ToolResult`/`VerificationEvidence` 스키마 이름 자체 | 미구현 | 이 이름의 타입/필드 집합은 코드에 없음. 다만 이번 세션에 확인한 실제 동작(멱등 request 처리, job 버전 관리, deterministicVerification)은 **개념적으로 일부 대응**됨. |

## §8 하네스·멱등성·재시작

| 항목 | 상태 | 근거 |
|---|---|---|
| Browser Harness(관찰 요소·페이지 버전 재확인) | 구현됨(v1 read-only) | 이번 세션 F08 v1(`84a0da3`) — 단, v3가 말하는 "행동 실행 직전 재확인"은 클릭/입력이 아예 없는 v1 범위 밖. |
| 파일 쓰기 hash 확인 후 성공 receipt | 구현됨 | `writeArtifact()`가 sha256 확인 후에만 기록(기존 코드, R39 재확인 시 함께 검증됨). |
| 고정 키 기반 재전송 중복 제거 | 구현됨(일부 경로) | request ledger의 requestId 기반 중복 제거는 기존에 검증됨. `(originDeviceId,eventId)` 같은 다목적지 동기화 키는 코드에 없음(단일 코어 구조라 다목적지 동기화 자체가 아직 없음). |
| 재시작 시 receipt·실행권 대조 | 구현됨 | `restarted` 처리(server.mjs) — running/queued job을 재시작 시 일괄 paused, 기존 F04~F06 검증 대상. |

## §9 오프라인·실행권·충돌 (LE-06)

| 항목 | 상태 | 근거 |
|---|---|---|
| `fencingToken`/`leaseId`/`restoreEpoch` | 미구현 | 전체 grep 0건. 현재는 단일 writer(store lock)만 있고, 여러 실행기(Windows 로컬 + 공유 코어)가 동시에 쓰는 구조 자체가 없음 — Koyeb 코어 하나만 실제로 쓴다. |
| `localIntentId`(오프라인 의도 고유 ID) | 미구현 | 오프라인 실행기 자체가 없으므로 이 개념도 없음. |
| 재연결 처리 6단계 | 미구현 | 다기기 동기화 프로토콜이 없음. |

## §10 모델·정책 학습 (LE-05)

| 항목 | 상태 | 근거 |
|---|---|---|
| 평가집(개발/선택/보류 각 ~20건) | 미구현 | 해당 평가 데이터셋·러너 없음. |
| `ModelBundle` 버전 묶음, 후보→검증→교체 생명주기 | 미구현 | grep 0건. 현재 `provider`/`model`은 job 생성 시 그냥 고정될 뿐, "묶음 버전 관리+교체 실험" 개념은 없음. |
| 사용자 수정 → 피드백 분리 처리 | 미구현 | 해당 파이프라인 없음. |

## §11 양자 회로 (LE-04, v3)

| 항목 | 상태 | 근거 |
|---|---|---|
| 게이트 수준 QAOA 회로(OpenQASM) | 미구현 | qiskit/qasm/qubit 전체 grep 0건. Python worker(`workers/developer/`)도 양자 관련 코드 없음. |
| QPU adapter(Qiskit Runtime Sampler) | 미구현/외부조건대기 | 코드 없음 + IBM Quantum 계정 자체도 없음(확인 필요하나 이번 세션엔 존재 근거 없음). |
| 실제 QPU job 실행 증거 | **외부조건대기 — 완료로 표시 안 함** | 사용자 지시대로: 실제 QPU 실행 증거 없이는 "완료"라고 절대 쓰지 않음. |

## §12 자원·비용 운영

| 항목 | 상태 | 근거 |
|---|---|---|
| 외부 API 동시 worker 비용 예약+정산(F14) | 구현됨(2026-09-23 동시성 결함 수정 포함) | 이번 세션 `13a0640` — 실제 동시성 결함을 재현 후 수정, 재검증 완료. |
| 양자 실행 자원 한도·예약 | 미구현 | 양자 모듈 자체가 없으므로 해당 없음. |

## §13 오류·복원 설계

| 항목 | 상태 | 근거 |
|---|---|---|
| 독립 백업→새 환경 복원(R39) | 구현됨(소프트웨어), 외부조건대기(외부 저장·실기기) | 이번 세션 재확인 — 빈 디렉터리로 실제 복원 검사 PASS. 외부 저장 위치 이동·실기기 복원만 소유자 차단. |
| `restoreEpoch` 무효화 | 미구현 | §9와 동일 이유. |

## 인수 기준 A01~A14

| ID | 상태 | 근거 |
|---|---|---|
| A01 오프라인 개인 과제(로컬 모델, 외부 호출 0건) | **일부구현 — 배선 완료, 실행 검증 대기** | `local` provider(`a12dd3f`, loopback-only `AGENT_ENDPOINTS.local`, 무인증, `YENO_LOCAL_BASE_URL` 오버라이드는 loopback으로만 fail-closed 검증)를 `provider-config-engine.mjs`에 추가하고 `desktop-provider-config.mjs`까지 정합성 맞춤(75/75 테스트 통과). `/api/jobs`의 일반 agent job 경로(`model-router.mjs`의 `PROVIDERS`가 `AGENT_ENDPOINTS`에서 자동 파생)는 이미 `local`을 받아들임. **단, 실제 llama.cpp/Ollama 같은 로컬 모델 런타임과 가중치가 이 기기에 설치돼 있지 않음(`which ollama llama-server` 없음) — 실제 오프라인 실행 증거는 아직 없음. 설치는 되돌리기 어려운 실사용 작업이라 사용자 승인 필요, 아직 미실행.** 범위 참고: `quests.mjs`/`research.mjs`는 각자 독립된 하드코딩 provider 목록(`local` 미포함)을 유지 — A01이 쓰는 일반 document/agent job 경로와 무관하므로 의도적으로 손대지 않음. |
| A02 검색(근거·원문 위치 대조) | 미구현 | LE-01 검색 경로 자체가 없음. |
| A03 한 임무 연결(같은 ID로 추적) | 일부구현 | job 단위 추적은 있으나 missionId 개념 없음. |
| A04 중복·재시작 | 구현됨 | 기존 회귀(F04~F06)로 검증됨. |
| A05 실행권·기기 폐기 | 일부구현 | 기기 토큰 폐기(revokedAt)는 있음. fencing/epoch 없음. |
| A06 외부 결과 불명확 | 구현됨 | `status:'unknown'` 처리 기존 검증됨(agent-engine). |
| A07 정지·자원 | 구현됨 | emergencyStop 기존 검증됨. |
| A08 모델 개선 | 미구현 | LE-05 없음. |
| A09 자료 철회 | 일부구현 | source 상태는 있으나 파생 adapter 추적 없음(애초에 adapter가 없음). |
| A10 양자 회로/QPU | 미구현/외부조건대기 | LE-04 전체. |
| A11 복원 | 구현됨(소프트웨어) | R39 재확인. |
| A12 폰과 PC | 구현됨(기존 범위) | 기존 device pairing/web session. |
| A13 JEV 막힘 해소 | 미구현 | JEV Recovery 계약 없음. |
| A14 잘못된 회복 차단 | 미구현 | 위와 동일 이유(대상 기능이 없음). |

## 결론 — 첫 실사용(A01)에 필요한 최소 구현

v3 §0은 "학습·양자 모듈 전체 인수를 기다리지 말라"고 명시한다. A01만 놓고 보면 막던 것은 정확히 하나였다: **로컬 모델을 기존 provider 계약에 연결하는 7번째 provider가 없다는 것.** sources.mjs(자료 읽기)·job 엔진·검증·비용 원장은 이미 provider-무관 구조라 재사용됨.

**2026-09-23 갱신 — 코드 배선 완료(`a12dd3f`, HEAD 기준 커밋 6개째: `0db4d70`→...→`a12dd3f`)**: `AGENT_ENDPOINTS`에 `local` provider 추가(기본 `http://127.0.0.1:8080/v1/chat/completions`, 무인증, `YENO_LOCAL_BASE_URL` 오버라이드는 loopback만 허용·fail-closed), `desktop-provider-config.mjs`의 스키마 검증도 `local`의 apiKey는 반드시 빈 문자열이어야 함으로 맞춤. 관련 테스트(provider-config/desktop-provider-config/agent-provider-selection/model-router/quests/research/f14-concurrency/cost-ledger/agent) 75/75 통과. 일반 `/api/jobs` agent job 경로가 이미 `local`을 받아들이는 것도 확인함.

**아직 완료 아님 — 정직하게 열어둠**: 이것은 provider *설정 계층*일 뿐이다. 실제 로컬 모델 런타임(llama.cpp `llama-server` 또는 Ollama)과 모델 가중치(수 GB)는 이 기기에 설치돼 있지 않음(`which ollama llama-server llama-cpp` 결과 없음, 이번 세션 재확인). 실제 오프라인 job 실행(로컬 서버 기동 → job 생성 → 외부 호출 0건으로 완료) 증거는 아직 없다. 설치는 디스크 용량·다운로드 시간을 쓰는 되돌리기 어려운 실사용 작업이라 임의로 진행하지 않았다 — **사용자 결정 필요**: (1) 어떤 로컬 런타임(llama.cpp vs Ollama), (2) 어떤 모델(용량·성능 트레이드오프), (3) 설치 진행 여부/시점을 사용자에게 확인 후 진행한다.
