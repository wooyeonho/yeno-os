# CODEX 지시서 — 커넥터 패널("딸깍 연결"): 두뇌·근육은 유명 오픈소스, BLACKHOLE은 판단·기록·표시만 (2026-09-28)

## §0 배경

소유자 지시(2026-09-28): "Jev는 그냥 지금 유명한 오픈소스 따오면 되잖아, 양자도, 임베딩·딥러닝·오픈클로 등등 — 나중에 그냥 내가 딸깍 연결할 것들만 남겨놓으면 되지." 기존 지시 "스타 많은 오픈소스는 죄다 넣어라"의 구조적 결론이다.

원칙: **BLACKHOLE 자체 코드는 판단 계약·기록(판례/명부/원장)·표시(자비스)만 가진다. 두뇌(판정 모델·평가 엔진)·근육(추론·임베딩·양자 백엔드·검색·채널·음성)은 전부 유명 오픈소스 또는 공식 API를 어댑터로 붙인다.** 각 어댑터는 소유자 GUI에서 **버튼 하나(키 입력 또는 토글) + "1회 시험 연결"**로 켜진다. 키 입력은 소유자만, 채팅·터미널로 절대 전달하지 않는다(기존 JARVIS A1 규칙 그대로).

이 지시서는 `docs/CODEX_DIRECTIVE_CONCEPT_INTENSITY_20260928.md`의 **C4(JEV)·C5(양자)의 내부 구현을 대체**한다: 그 두 단계에서 "BLACKHOLE이 직접 만드는 것"은 판례(docket)·관측 전 중첩 기록 같은 **기록 계층**뿐이고, 판정·회로 실행은 아래 커넥터가 한다. C1(매혹 자기미화)·C2(그림자 일어나라)·C3(커비)는 BLACKHOLE 고유 메커니즘이라 그대로 유지한다.

## §1 사실 확인(코드 작성 전)

이미 있는 것을 먼저 읽고 **새 패턴을 발명하지 않는다**:
- `runtime/lib/provider-config-engine.mjs`: `AGENT_ENDPOINTS`(openai/gemini/moonshot/xai/anthropic/nvidia/local), `agentConfig`, `agentConfigForProvider`, `agentProfiles`, loopback 재검증.
- `runtime/lib/browser-provider-routing.mjs`: `YENO_JEV_BASE_URL`/`YENO_JEV_API_KEY`/`YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED`(HTTPS 전용·credential/query/hash 금지·공식 엔드포인트 확인 플래그).
- 흩어진 env 가족: `YENO_AGENT_*`, `YENO_AI_*`, `YENO_GROK_*`/`YENO_XAI_*`, `YENO_JEV_*`, `YENO_LOCAL_EMBED_*`, `YENO_OBSIDIAN_REST_*`, `YENO_MEMORY_SUPABASE_*`, `YENO_BROWSER_*`, `YENO_LOCAL_BASE_URL`. 이것들이 곧 커넥터 목록의 씨앗이다.
- 비밀 보관: 기존 DPAPI 경로·`assertNoSecrets`(`jev.mjs`, `model-router.mjs`, `brain-routing.mjs` 등에서 이미 사용).
- 소유자 GUI의 기존 원격 provider 설정 화면(§86 resident-v2)과 "1회 시험 연결" 버튼 — 패널은 이 화면을 **확장**하지 새로 만들지 않는다.

## §2 커넥터 레지스트리 `runtime/lib/connectors/registry.mjs`

각 커넥터는 순수 descriptor 하나:
```
{id, kind, title,
 upstream:{name, repo, license, starsSeenAt:'2026-09-28', starsSeen, pinnedVersion, integrity},  // 실물 대조값만
 mode:'local'|'cloud'|'process',            // process = OpenClaw·SearXNG처럼 분리 프로세스
 requires:['YENO_..._BASE_URL','YENO_..._API_KEY','YENO_..._OFFICIAL_ENDPOINT_CONFIRMED'] | ['toggle'],
 status(env,state) → 'not_installed'|'installed'|'needs_owner'|'connected'|'blocked',
 healthcheck(env) → {ok, roundTripMs, evidence}   // 실제 왕복 없이는 절대 connected 아님
}
```
- `connected`는 **실제 healthcheck 왕복 성공 후에만**. 키가 있어도 왕복 전에는 `needs_owner`/`installed`.
- 원격은 전부 `YENO_<ID>_BASE_URL`(HTTPS)·`_API_KEY`·`_OFFICIAL_ENDPOINT_CONFIRMED` 3종 패턴 재사용. 로컬은 loopback 재검증. 프로세스형은 `mode:'process'`로 별도 리스너 확인.
- 기존 흩어진 env 이름은 **바꾸지 않고** descriptor의 `requires`에 그대로 매핑한다(호환 유지).

## §3 커넥터 목록 (kind별 — 스타·라이선스는 2026-09-28 내가 GitHub 페이지로 직접 확인, 착수 시 재확인)

| kind | 로컬 기본(설치만 하면 됨) | 딸깍 연결(소유자 키/토글) | 비고 |
|---|---|---|---|
| **judge (JEV 두뇌)** | `promptfoo`(MIT, 24.2k, TS — llm-rubric/assert 엔진) 또는 `instructor-js`(MIT, 802)+`zod`(MIT, 44k)로 **타입 고정 판정** | 판정 모델은 inference 커넥터를 따라감 | `jev.mjs`의 typed 계약(`DECISION_STATUSES`, `authorizesDispatch:false`)·사건부(docket)는 BLACKHOLE 것. OSS는 "typed answer를 만드는 엔진"만 담당. Codex가 Node ESM 호환·RAM을 실측해 둘 중 선택, 이유 기록 |
| **quantum** | `quantum-circuit`(MIT, 이미 고정) 상태벡터 시뮬레이터 | **IBM Quantum**(Qiskit Runtime REST, Apache-2.0 SDK, 7.8k; 토큰) / Amazon Braket(AWS 자격) | `countsOrigin`은 백엔드 실제값(`local_statevector_simulator` / `ibm_quantum_qpu` 등)으로 정직하게. 동결 계약 `recovery-one-of-qpu.mjs` 무수정 |
| **embedding** | Ollama `bge-m3`(이미 있음) + `@huggingface/transformers`(transformers.js, Apache-2.0, 16.3k; Ollama 없을 때 in-process ONNX 폴백) | OpenAI/Gemini/Voyage 임베딩(키) | 로컬은 기존 RAM 게이트(`verify-source-shadow-live.mjs`의 3GiB 규칙) 재사용 |
| **inference (딥러닝/LLM)** | Ollama(이미), `node-llama-cpp`(MIT, 2.2k; JSON 스키마 강제 출력 — judge와 궁합), `onnxruntime-node`(MIT, 21.9k; transformers.js 뒤) | Gemini / OpenAI / NVIDIA NIM / xAI / Anthropic / Moonshot(`AGENT_ENDPOINTS` 그대로) | 소유자 원칙 "Ollama로도 돌아가되 복합 구조" 충족. `YENO_AGENT_PROVIDER_ORDER`로 우선순위 |
| **search (G1)** | SearXNG(AGPL-3.0, 36.7k, 분리 프로세스) | Brave/Tavily 등 `YENO_SEARCH_*`(키) | OSS 지시서 §124 보정대로 AGPL 의무·외부 검색 경로 별도 검토 |
| **channel** | — | **OpenClaw**(MIT, 고정 v2026.2.13) 텔레그램 봇 토큰 | `openclaw-bridge.mjs` 기존 후보 분류 유지, Gateway는 분리 프로세스 |
| **voice** | 브라우저 STT/TTS(이미), `whisper.cpp`(MIT, 54k) | Gemini Live(이미 경로 있음) | Piper는 `piper1-gpl`(GPL-3.0) — 라이선스 검토 후. OSS 지시서 §124 보정 참조 |
| **vault** | Obsidian Local REST API(설치됨, 앱 로드 대기) | 토글 + API 키(소유자) | `obsidian-rest-search.mjs` 그대로 |
| **memory sync** | — | Supabase(`YENO_MEMORY_SUPABASE_*`, 이미) | 기존 어댑터 매핑만 |

## §4 소유자 GUI "연결" 패널

- 기존 원격 provider 설정 화면에 **커넥터 목록 탭** 추가: 각 행 = 제목·업스트림(이름·라이선스·고정 버전)·상태 칩(`설치 안 됨 / 설치됨 / 내 입력 필요 / 연결됨 / 막힘`)·**버튼 하나**(키 입력 폼 또는 토글)·**"1회 시험 연결"**.
- 상태는 §2 `status()`의 실측값만 표시. "연결됨"을 키 존재만으로 표시하는 것 금지.
- 키 입력 폼은 기존 DPAPI 저장 경로 재사용. 화면·로그·채팅 어디에도 평문 노출 금지(`assertNoSecrets`).
- 자비스: 새로 연결되면 `hint("<커넥터> 연결됐어 — 왕복 <ms>ms")`, 실패면 정직한 실패 문구.

## §5 C4·C5 재정의(개념 정전 §4·§5의 기록 계층은 유지)

- **C4 JEV** = judge 커넥터(§3) + BLACKHOLE 사건부(`jev-docket.mjs`: 사건·적중·기권률·dissent, Wilson 하한은 기존 `jev-calibration.mjs`). `jev.mjs`의 typed 계약과 `authorizesDispatch:false`는 불변. OSS 엔진이 없거나 연결 안 됐을 때는 v0 결정론 규칙셋이 그대로 판정한다(퇴행 없음).
- **C5 양자** = quantum 커넥터(§3) + BLACKHOLE 결정 기록(`quantum-decision.mjs`: 관측 전 선택값 부재·소유자 측정 1회·엔트로피·터널링 표시·결어긋남). 회로 실행은 백엔드가, 의미론과 기록은 BLACKHOLE이. 시뮬레이터/실QPU 구분은 `countsOrigin`으로 정직하게.

## §6 테스트·인수 CP1

- `runtime/test/connectors.test.mjs`: `registry_lists_every_connector_with_honest_status`, `connected_requires_real_healthcheck_roundtrip_not_key_presence`, `cloud_connector_without_key_reports_needs_owner_never_connected`, `remote_endpoints_enforce_https_and_official_confirmation_flag`, `local_endpoints_reject_non_loopback`, `no_secret_in_logs_or_state`, `existing_env_names_still_work_unchanged`, `judge_connector_falls_back_to_v0_rules_when_absent`, `quantum_countsOrigin_reflects_actual_backend`.
- **인수 CP1(격리 코어)**: 패널에 §3의 모든 커넥터가 실측 상태로 나열됨 → 로컬 기본(quantum-circuit·Ollama 또는 transformers.js 폴백·Obsidian 플러그인)은 healthcheck 실행 결과 그대로 표시 → 클라우드 커넥터는 키 없이 "내 입력 필요"로, 합성 provider로 "1회 시험 연결" 왕복 성공 시에만 "연결됨" → 캡처 `cp1-panel.png`(가로 넘침 없음) → `cp1-registry.json`, `cp1-healthchecks.json`, `cp1-full-regression.txt`(0 실패).
- 실제 클라우드 키 연결(A급)은 소유자 행동 대기로 정직하게 남긴다 — 이 지시서의 목적이 바로 "그것만 남기는 것"이다.

## §7 하지 말 것

- 특정 provider 하드코딩·기본 선택 강제. 소유자가 고른다.
- 키 없이/왕복 없이 "연결됨" 표시. 키·토큰 평문 노출.
- `_OFFICIAL_ENDPOINT_CONFIRMED` 우회. loopback 규칙 우회.
- OSS 소스를 저장소에 병합(npm 의존성·고정 태그·분리 프로세스만). AGPL/GPL 프로젝트는 분리 프로세스로만.
- 기존 env 이름 변경·삭제(호환 깨짐).
- 커넥터가 연결됐다고 해서 `authorizesDispatch`·소유자 승인 게이트·static-guard를 건드리는 것.

## §8 보고 형식

기존과 동일. `docs/CLAUDE_EXECUTION_STATE.md` 다음 번호, VERIFIED/RAN-UNVERIFIED/BLOCKED, 실해시. 커넥터마다 상태를 표로.
