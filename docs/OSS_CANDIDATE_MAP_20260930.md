# BLACKHOLE 개념·엔진별 오픈소스 후보 지도 (2026-09-30, Claude 작성)

**성격: 감사(AUD-1)의 출발점이며 확정이 아니다.** 아래 관측값(스타·라이선스·아카이브)은 2026-09-30에 Claude가 GitHub 저장소 페이지에서 직접 읽은 값이다(스타는 표시 그대로의 근사치). 마지막 커밋 날짜는 대부분 페이지에서 확인되지 않아 `unknown`이다. "적합도"는 Claude의 판단이며 Codex가 코드를 읽고 근거 검증기로 다시 확인하기 전까지 가설이다. 웹 검색이나 릴의 주장은 근거로 쓰지 않았다.

## 읽는 법

- 어떤 오픈소스도 "칠죄종 호문쿨루스"나 "그림자군단" 개념 자체를 구현하지 않는다. 오픈소스가 주는 것은 그 **아래의 엔진**(기억, 계획, 다중 에이전트 실행, 내구 실행, 로그, 음성)이다. 개념의 정의와 규칙(정책층)은 블랙홀이 얹는다.
- 블랙홀 런타임은 Node(.mjs)다. Python/Go 기반 후보는 대부분 **B(별도 프로세스)**이고, 코어에 복사하지 않는다.
- 동결 3파일(`solo-leveling.mjs`, `recovery-one-of-qpu.mjs`, `static-guard.mjs`)은 교체 대상이 아니다.

## 지도

| 개념/엔진 | 후보 | 라이선스 | 스타 | 아카이브 | 제안 등급 | 적합도(가설)와 주의 |
|---|---|---|---|---|---|---|
| 칠죄종 욕망(동기·계획·성찰) | joonspk-research/generative_agents | Apache-2.0 | 22.1k | 아니오 | B/참조 | 기억 스트림·성찰·계획 구조가 욕망→행동 루프와 닮음. 연구용 코드(Python)라 패턴 참조 수준. 죄의 정의·문턱은 블랙홀 정책 |
| 칠죄종 욕망 | a16z-infra/ai-town | MIT | 10.5k | 아니오 | B/참조 | 인물들이 사는 시뮬레이션 키트(TS). 욕망 엔진보다 그림자군단 "거주" 화면 참조에 가까움 |
| 그림자군단(다중 에이전트 소환·실행) | langchain-ai/langgraph | MIT | 38.1k | 아니오 | B (JS판 여부는 감사에서 확인) | 상태 유지 에이전트·중단 후 승인(휴먼 인 더 루프) 흐름이 그림자 소환·소유자 승인과 맞음. 등급·XP 정책은 블랙홀 |
| 그림자군단 | crewAIInc/crewAI | MIT | 59k | 아니오 | B | 역할 기반 다중 에이전트. Python |
| 그림자군단 | OpenHands/OpenHands | MIT | 89.6k | 아니오 | B | 코딩 에이전트 실행기(로컬·원격). 그림자의 "손발" 실행 후보 |
| 그림자군단 | microsoft/autogen | MIT(코드) | 60.4k | 유지보수 모드 | **C** | 저장소가 "신규는 Microsoft Agent Framework로"라고 명시. 채택 안 함 |
| 커비(능력 흡수·카피) | MineDojo/Voyager | MIT | 7.2k | 아니오 | 참조 | 스킬 라이브러리(검증된 능력을 저장·재사용) 패턴이 커비 카피와 닮음. **마지막 푸시 2024-04-03**로 오래됨 → 코드 채택보다 설계 참조 |
| JEV(유형 판정·기권·보정) | scikit-learn-contrib/MAPIE | BSD-3-Clause | 1.6k | 아니오 | B/참조 | 불확실성·위험 통제(conformal prediction)가 "기권은 미덕"과 맞음. Python이라 JS JEV와 직접 연결은 별도. 현재 Wilson 하한(wilson-score-interval)은 이미 사용 중. `authorizesDispatch:false` 불변 |
| 양자 | quantum-circuit (이미 사용 중) | MIT(이전 검증 기록) | — | 아니오 | A (현행 유지) | 이미 의존성. 시뮬레이터라는 사실 유지 |
| 양자 | Qiskit/qiskit | Apache-2.0 | 7.8k | 아니오 | B | 실제 QPU 클라우드 연결이 필요할 때만. 지금 불필요 |
| 양자 | PennyLaneAI/pennylane | Apache-2.0 | 3.5k | 아니오 | B | 양자 기계학습 쪽. 지금 불필요 |
| 자비스 음성(대화·턴 감지) | pipecat-ai/pipecat | BSD-2-Clause | 15.3k | 아니오 | B | 실시간 음성 에이전트 프레임워크(Python). 현재 `gemini-live.mjs` 대체 후보 |
| 자비스 음성 | livekit/agents | Apache-2.0 | 13.0k | 아니오 | B | 실시간 음성 에이전트, MCP 지원. LiveKit 서버 필요 여부 감사에서 확인 |
| 자비스 음성 인식 | SYSTRAN/faster-whisper | MIT | 25.6k | 아니오 | B | 로컬 음성 인식. **Codex 지적(2026-10-01, 공식 CPU 벤치마크): small 모델 int8도 약 1.5GB RAM → 이 PC(약 7.7GiB, 여유 적음)에서 "가벼운 후보"로 확정 불가. 실제 여유 메모리 실측 후 판단**(Claude는 벤치마크를 직접 확인하지 못함) |
| 자비스 음성 합성 | rhasspy/piper | MIT | — | **예(이미 제외 기록)** | **C** | 이전 독립 검증 결과 아카이브. 다른 TTS 후보는 미검증 |
| 영수증(투명 로그) | sigstore/rekor | Apache-2.0 | 1.2k | 아니오 | B/형식 참조 | 위변조 방지 원장 서버(Go). 서버를 붙이기보다 증명 형식을 참조하는 쪽이 현실적 |
| 영수증 | transparency-dev/tessera | Apache-2.0 | 242 | 아니오 | 참조 | 타일 기반 투명 로그 라이브러리(Go). 스타 적음 → 채택 전 신중 |
| 영수증 | in-toto/in-toto | **미확인** | 1.0k | 아니오 | 보류 | 라이선스 파일 내용을 페이지에서 확인하지 못함 → 확인 전까지 C 취급 |
| 복구(내구 실행) | dbos-inc/dbos-transact-ts | MIT | 1.4k | 아니오 | B | TS 라이브러리, PostgreSQL 필요(프로젝트에 Supabase 연결이 있음). 로컬 우선·오프라인 조건과 충돌 가능 → 감사에서 확인 |
| 복구 | temporalio/temporal | MIT | 21.7k | 아니오 | B(무거움) | 별도 서버 필요. 개인 PC 단일 실행에는 과할 수 있음 |
| 기억 | mem0ai/mem0 | Apache-2.0 | 65.9k | 아니오 | B | 에이전트 기억 계층. 현재 Obsidian+Supabase 구조와 중복 여부 확인 |
| 기억 | letta-ai/letta | Apache-2.0 | 24.7k | 아니오 | 보류 | 페이지에 "소스가 letta-code로 이동"이라 표기 → 어느 저장소가 현행인지 확인 후 |
| 모델 라우팅 | BerriAI/litellm | **페이지에서 미확인** | 53.8k | 아니오 | 보류 | LICENSE를 직접 읽기 전까지 채택 금지(폴더별로 라이선스가 다를 수 있음) |
| 브라우저 조작 | browser-use/browser-use | MIT | 116.7k | 아니오 | B | Python. `browser-harness` 등 대체 후보 |
| 검색 | searxng/searxng | **AGPL-3.0** | 36.7k | 아니오 | **B 전용** | GitHub API로 직접 확인(마지막 푸시 2026-09-08). 코어에 섞지 않고 별도 프로세스로만. **단 별도 프로세스라는 사실만으로 AGPL 의무가 자동 해결되지는 않음(Codex 지적)** — 수정하거나 타인에게 네트워크로 제공하면 소스 제공 의무가 생길 수 있어 항목별 확인(법률 자문 아님) |

## 이번 조사에서 확인하지 못한 것

- GitHub API는 이 세션에서 403(속도 제한 추정)이라 대부분 저장소 페이지 값을 썼다. 마지막 커밋 날짜는 Voyager와 SearXNG만 확인했다.
- litellm, in-toto의 라이선스는 확인하지 못했다. Kokoro 등 다른 TTS, Playwright, langgraphjs, Home Assistant 계열은 조사하지 않았다.
- 각 후보가 블랙홀 코드의 해당 모듈을 실제로 대체할 수 있는지는 코드를 읽지 않았으므로 모른다.

## Codex가 할 일

`CODEX_DIRECTIVE_OSS_ASSEMBLY_20260930.md`의 AUD-1에서 이 표를 출발점으로 쓰되, 모든 행을 근거 검증기로 다시 관측하고(예산 안에서 나눠서), 코드를 읽어 적합도를 확정하거나 기각한다. 이 표의 값과 다르면 Codex 관측값이 우선이며 차이는 §에 남긴다.
