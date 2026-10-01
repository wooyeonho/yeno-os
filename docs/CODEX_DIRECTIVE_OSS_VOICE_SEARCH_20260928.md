# CODEX 지시서 — 스타 많은 오픈소스 3건 추가 도입 검토: JARVIS 음성(STT/TTS) + G1 자체호스팅 검색 (2026-09-28)

## §0 배경

소유자 반복 지시 "스타 많은 오픈소스들은 죄다 다 우리 OS에 넣어야한다"(2026-09-28) + 오늘 "깃허브 스타많은것들 모두 받아들이기"에 따라, Claude(Cowork)가 이번에 실제로 조사해 확인한 후보 3건을 제안한다. `docs/BLACKHOLE_AUTONOMY_CRITERIA_20260928.md`의 6조건(루프백전용·공식배포본+해시+허용라이선스·읽기전용또는이미안전장치코드화·자격정보소유자전용·되돌릴수있음·증거기록)에 맞는지는 각 항목마다 Codex가 실제로 대조해야 한다 — 이 문서는 "무엇을, 왜"까지만 제안하고 "정말 되는지"는 조사·구현 단계에서 Codex가 사실로 확인한다(추측 금지, 기존 원칙 동일).

내가 직접 GitHub API/페이지로 확인한 스타·라이선스(2026-09-28 기준, 향후 변동 가능 — Codex가 착수 시 재확인할 것):
- `rhasspy/piper` — 11.3k stars, MIT, "A fast, local neural text to speech system". **2025-10-06 보관 처리된 저장소**이며 개발은 `OHF-Voice/piper1-gpl`로 이동했다. 현재 개발 저장소는 GPL-3.0이므로, 옛 MIT 소스와 현재 `piper-tts` 배포물을 같은 라이선스로 취급하지 않는다. 선택할 실제 버전·바이너리·음성 모델 각각의 출처와 라이선스를 별도로 확인한다.
- `ggml-org/whisper.cpp` — 54k stars, MIT, "Port of OpenAI's Whisper model in C/C++"
- `searxng/searxng` — 36.7k stars, AGPL-3.0, "free internet metasearch engine, 추적/프로파일링 없음"

## §1 제안 A — JARVIS 음성 입출력 (whisper.cpp STT + Piper TTS)

**왜**: 음성 기능 자체가 없는 것은 아니다. `runtime/public/voice-view.mjs`에는 브라우저 `SpeechRecognition`/`speechSynthesis` 폴백과 결과 읽기가 있고, `live-voice-client.mjs`에는 Gemini Live 음성 경로가 있다. 아직 확인되지 않은 격차는 **외부 음성 제공자에 의존하지 않는 로컬 STT/TTS 경로의 실제 동작**이다. whisper.cpp와 Piper 계열은 이를 위한 후보이지, 기존 음성 화면을 중복 구현할 이유는 아니다. Piper의 현행 배포물·음성 모델 라이선스는 별도 검토한다.

**먼저 사실 확인(코드 작성 전)**:
1. `memory-embeddings.mjs`에는 `LOOPBACK_HOSTS` 검증이 있지만 RAM≥3GiB 게이트는 없다. 3GiB 사전 검사는 `scripts/verify-source-shadow-live.mjs`의 **로컬 Shadow 실측**에 적용된다. STT/TTS의 메모리 기준은 모델·음성별 실제 측정으로 정하고 그 스크립트의 3GiB 값을 무비판적으로 재사용하지 않는다.
2. whisper.cpp/Piper 둘 다 실제로 유지되는 공식 npm 바인딩이 있는지 조사(직접 컴파일된 바이너리를 child_process로 부르는 방식이면 그 경계도 명확히 조사) — 존재하는 정식 배포 경로를 골라라, 임의로 사람이 손으로 격리 스크립트를 새로 발명하지 마라.
3. **가장 중요한 사실 확인**: 이 PC의 실측 여유 RAM은 보통 0.4~0.7GiB다. whisper.cpp의 가장 작은 모델(tiny)과 Piper의 가장 작은 음성이라도 실제로 이 여유 안에서 도는지 **직접 실측**해라. 안 되면 안 된다고 정직하게 보고하고, 되는 조건(예: 다른 무거운 프로세스 없을 때만)만 정확히 남겨라 — 억지로 되는 것처럼 포장 금지.

**범위**: 이번 단계는 텍스트↔음성 변환 파이프라인만 격리 코어에서 검증한다(마이크 캡처·스피커 재생 등 OS 오디오 장치 연동은 Android/Edge 실기기 붙은 뒤 별도 단계). `runtime/lib/jarvis-stt.mjs`/`jarvis-tts.mjs`(가칭) 새 파일, 기존 JARVIS 상태 머신·화면 배선은 수정하되 6상태 계약 자체는 바꾸지 않는다.

## §2 제안 B — G1 검색 provider를 SearXNG 자체호스팅으로 (유료 키 문제 우회)

**왜**: G1은 지금 `YENO_SEARCH_*` 실제 키가 "소유자 행동 대기"로 막혀 있다. SearXNG를 이 PC에 직접 띄우면 상용 유료 검색 API 계정 없이도 G1을 실제로 작동시킬 방법이 생긴다.

**먼저 사실 확인**:
1. SearXNG는 기본적으로 API 키 개념이 없는 오픈 인스턴스 방식이다 — 기존 `YENO_SEARCH_API_KEY`(JEV 패턴을 그대로 복제한 것) 요구조건과 어떻게 맞출지(예: SearXNG 자체 접근 토큰/역방향 프록시 인증을 앞단에 씌우는 방식) 실제로 조사해서 결정할 것. 억지로 끼워맞추지 말고, 정말 안 맞으면 왜 안 맞는지와 대안을 정직하게 보고해라.
2. SearXNG를 **별도 프로세스**로 두고 소스를 병합하지 않는 방안을 우선 검토한다. 다만 이것만으로 BLACKHOLE의 라이선스 의무가 없다고 단정하지 않는다. 실제 수정·배포·네트워크 제공 방식과 SearXNG/의존성 라이선스를 검토해 기록한다.
3. 이 PC의 낮은 RAM에서 SearXNG 자체가 별도 프로세스로 돌아갈 여유가 있는지 실측할 것 — Obsidian/OpenClaw 등 다른 무거운 설치와 동시 기동 시 RAM 경합 주의(기존 §112 병렬 진행 원칙과 동일하게 무거운 기동만 순서대로).

**범위**: `runtime/lib/browser-provider-routing.mjs`의 기존 `YENO_JEV_*` 검증 패턴은 참고하되, JEV의 HTTPS 공식 엔드포인트·API 키 계약을 로컬 SearXNG에 그대로 복사하지 않는다. `gap-scout.mjs`와 `YENO_SEARCH_*` 어댑터는 아직 없으므로 먼저 승인된 G1 지시서의 검색 계약을 구현·검증한 뒤 로컬 검색 옵션을 추가한다. SearXNG API가 루프백이어도 SearXNG 자체의 외부 검색 요청은 별도 네트워크 행동으로 계측한다. 검색 결과 프롬프트 인젝션 라벨링 요구는 유지한다.

## §3 하지 말 것

- 세 후보 모두 RAM 실측 없이 "될 것"이라고 가정하고 진행 금지 — 안 되면 정직하게 BLOCKED로 보고.
- whisper.cpp/Piper를 마이크·스피커 실장치에 연결하는 것은 이번 범위 아님(텍스트↔음성 변환 파이프라인 격리 검증까지만).
- SearXNG를 BLACKHOLE 저장소 소스에 병합하지 않는다(OpenClaw와 동일하게 분리 프로세스).
- `docs/BLACKHOLE_AUTONOMY_CRITERIA_20260928.md`의 6조건을 실제로 대조하지 않고 "이미 승인됐다"고 가정 금지 — 이번이 "음성 I/O"·"자체호스팅 검색엔진"이라는 새로운 종류의 첫 도입이므로, 조건 대조 결과를 보고서에 명시할 것.

## §4 보고 형식

기존과 동일. `docs/CLAUDE_EXECUTION_STATE.md`에 다음 번호로 기록, 세 후보 각각 VERIFIED/RAN-UNVERIFIED/BLOCKED 구분.
