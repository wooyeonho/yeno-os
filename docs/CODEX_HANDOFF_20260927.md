# 코덱스 인계 요약 (2026-09-27, Claude(Cowork) 작성)

이 문서 하나로 지금 뭘 먼저 해야 하는지 정리함. 개별 지시서(docs/CODEX_DIRECTIVE_*.md)가 여러 개 쌓여서 우선순위가 헷갈릴 수 있어 여기서 다시 정리함. 상세 근거/코드는 각 원본 지시서와 `docs/CLAUDE_EXECUTION_STATE.md` §84-91 참고. §90에서 실제 resident 설치·로컬 작업·재시작 복구가 추가됐고 §91에서 브라우저 WebGL 시각 레이어를 시험했다. 휴대폰/실모델 수락은 계속 미실행이다.

## 우선순위

**P0 — 소유자 행동 대기 (코덱스 작업 아님, 상태만 확인)**
- JARVIS A1(원격 모델 실답변 화면표시): §86에서 resident-v2의 원격 설정 배선과 합성 시험이 끝났으나 소유자 GUI 실제 화면/클릭과 실모델 A1은 미검증. 소유자가 비공개 GUI에 실제 키를 입력하고 별도 "1회 시험 연결"을 누를 수 있는 단계가 남음. 코덱스는 먼저 실제 화면에서 버튼 조작과 표시를 검증하고 위치를 캡처로 남길 것. 키를 채팅·터미널로 전달시키지 말 것.
- 안드로이드 실기기: SDK의 ADB 연결 0대. PC에 Tailscale 실행 파일도 발견되지 않아 전화기 사설 HTTPS 경로가 비활성이다. 실제 휴대폰 연결과 양쪽 Tailscale 준비가 필요하며, 지금의 로컬 코어 성공을 휴대폰 수락으로 표시하지 않는다.
  - **(2026-09-28 추가) 별도 채널 후보**: `docs/CODEX_DIRECTIVE_OPENCLAW_INTEGRATION_20260928.md` — OpenClaw(MIT)의 텔레그램 채널은 폰↔PC 왕복을 별도로 시험할 수 있다. 텔레그램이 성공해도 기존 Android APK의 페어링→요청→진행→결과→복구 실기기 수락을 대신하지 않는다. 현재는 소스 권한 계약을 조사하고 인증 전 `/status` 후보만 격리 분류했으며 Gateway·채널은 실행하지 않았다.

**P1 — 진행 중인 메인 작업 (알려진 회귀 우선 권고)**
- **(2026-09-28 신규, 권고: 다른 P2 신규 작업보다 먼저)** `docs/CODEX_DIRECTIVE_SCHEDULER_REGRESSION_20260928.md`: §115가 보고하고 내가 직접 로그를 재검증한 사용자 지정 전체 회귀 실패(1,235건 중 `runtime/test/scheduler-fix.test.mjs` 1건 실패, 단독 재실행도 재현됨) 진단·수정 지시서. 실제 스케줄러 회귀인지 이 PC의 저RAM(여유 0.4~0.7GiB)에서 17MiB state 처리 시간이 4초 폴링 예산을 넘기는 자원 압박 플레이크인지 먼저 계측으로 구분하고, 근거 없이 타임아웃 숫자만 늘려 통과시키는 것은 금지. 재현 가능한 실패를 남겨둔 채 새 기능(S1+/G1/K1/OpenClaw)을 계속 쌓지 말 것을 권고(순서 결정은 Codex/소유자 재량).
- `docs/CODEX_DIRECTIVE_JARVIS_E2E_SPEC_20260927.md` (최신 263줄 버전): A1-A12 인수기준 전체. §75-86에서 대부분 진행됐음. 남은 것 위주로 이어갈 것.

**P2 — 새로 추가된 작업 (P0/P1 밀어내지 말 것)**
- **(2026-09-29 E 시리즈, CP1과 병렬 가능)** `docs/CODEX_DIRECTIVE_EXISTING_CONCEPTS_INTENSITY_20260929.md`: 이미 구현된 개념의 순화 해제 — 오만·색욕 이름 원복(영토 표기), 죄별 배고픔 곡선 v2, 죄별 말투+상위3 논쟁, 자비스 격식·위트·선제 보고, [시스템] 알림, 커비 문장. 영속 ID·스키마·정직성·게이트 불변.
- **(2026-09-29 S0 정정, 마스터보다 우선)** `docs/CODEX_DIRECTIVE_S0_CORRECTIONS_20260929.md`: §131 F1~F8 채택 — 탄생 정책 v2, absorb-inbox(승격 없음), 새 state 키+백업, 후보 상한, 양자 용어 분리·단일 결정 한정, L5 인과 체인, 커넥터별 auth·`not_implemented`, JEV agreement/outcome 분리. **CP1은 기존 quantum-circuit·Ollama·Obsidian 어댑터부터.**
- **(2026-09-28 마스터, P2 진입점)** `docs/CODEX_DIRECTIVE_MASTER_CONCEPT_HANDOVER_20260928.md`: 재정립 개념 전체의 구현 순서 S0~S8(CP1→G1→C1→C2→C3→C5→C4→L5)과 통합 인수 L5. 아래 CP1·G1·C0~C5·OSS 지시서는 이 마스터의 상세다 — **여기부터 읽을 것**.
- **(2026-09-28 신규, 소유자: "유명 오픈소스 따오고 나는 딸깍 연결만")** `docs/CODEX_DIRECTIVE_CONNECTOR_PANEL_20260928.md`: 커넥터 레지스트리+소유자 GUI 연결 패널. judge(promptfoo/instructor-js+zod)·quantum(quantum-circuit+IBM Quantum)·embedding(Ollama+transformers.js+클라우드)·inference(Ollama/node-llama-cpp/onnxruntime+AGENT_ENDPOINTS)·search·channel(OpenClaw)·voice·vault·memory sync. 실제 왕복 없이는 "연결됨" 금지, 기존 `YENO_*` env 호환. **C0~C5 지시서의 C4(JEV)·C5(양자) 내부 판정·회로 실행은 이 커넥터가 대체**(기록 계층만 BLACKHOLE). 인수 CP1.
- **(2026-09-28 신규, 소유자 지시 "더 오버해서 원문 그대로" — G1과 함께 P2 최상단)** `docs/CODEX_DIRECTIVE_CONCEPT_INTENSITY_20260928.md` (개념 원본 `docs/BLACKHOLE_CONCEPT_CANON_20260928.md`): C0 사실확인 → C1 매혹 자기미화 → C2 그림자 "일어나라"(가치 있는 승리만 추출·실패·정체성·보관·계급·군주 상한) → C3 커비 카피 능력 → C5 양자 일반화 → C4 JEV 사건부. 전부 추가(additive), 기존 회귀 0 실패 유지, 불변 경계(authorizesDispatch:false·소유자 최종 승인·static-guard·동결 계약) 무수정. G1 지시서는 2-B(칠죄종 극단화)+매혹 자기미화 추가로 갱신됨.
- **(2026-09-28 신규, S1+ 완료됨 — §122에서 실제 구현·검증 완료 확인됨)** ~~`docs/CODEX_DIRECTIVE_SHADOW_LEVELING_S1PLUS_20260928.md`~~: §109에서 Codex 스스로 정직하게 남긴 미해결 지점(`shadowRank`가 근거 없이는 등급을 못 만들어 `E` 고정) — `leveling-evidence.mjs`의 기존 2-엔진 패턴을 그대로 본떠 세 번째 `shadowArmy` 엔진을 추가해 실제 임무 증거에 연결하는 지시서. `solo-leveling.mjs`는 한 글자도 수정 금지. 등급이 실제로 미래 행동(동명 역할 우선 배정 표시)에 영향을 주는 보수적 범위의 훅 포함, 디스패치 권한·동시성 한도는 불변.
- **(2026-09-28 추가, 소유자 승인 완료: "승인, 진행해 자유도를 높여야해")** `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`: 호문쿨루스 격차 감지→그림자군단 Researcher 역할의 실제 웹 검색→커비 `absorbed-opensource` 초안까지 전부 자동(소유자 승인 게이트는 초안을 실제 코드에 붙이는 지점 하나뿐). 새 검색 provider 권한은 기존 `YENO_JEV_BASE_URL` 계열과 동일한 HTTPS-only·공식엔드포인트확인 패턴 재사용. 실제 `YENO_SEARCH_*` 키는 소유자 행동 대기(JARVIS A1과 같은 처지) — 그 전까지는 합성 provider로 격리 검증(인수 G1).

- **(2026-09-28 추가, 병렬 가능)** §112 확인 결과 두 갈래가 서로 독립적이라 동시에 진행 가능하다(파일 겹침 없음, 서로 블로킹 안 함): **(A)** `runtime/lib/obsidian-rest-search.mjs`는 코드는 붙었지만 실제 Obsidian community plugin(coddingtonbear/obsidian-local-rest-api, 이미 `build-artifacts/oss-source/obsidian-local-rest-api`에 고정본 있음) 설치·활성화가 안 돼 있어 실 Vault 검색이 BLOCKED — 이걸 설치하고 실제 검색 1건 검증. **(2026-09-28 소유자 예외 승인, §117)** 이 플러그인 설치·활성화는 AGENTS.md "보안/권한/공유 설정 변경 금지"에 해당할 수 있어 Codex가 직접 질의했고, 소유자가 "모두 승인 자유도를 높여야해"로 이 한 건에 한해 명시 승인함 — 재질의 없이 진행할 것. 이미 코드는 읽기전용·자체CA·API키필수·쓰기거부로 구현돼 있음(직접 확인됨). **(B)** OpenClaw는 공식 v2026.2.13 태그로 소스 고정만 됐고 의존성 설치·Gateway 실행·텔레그램 연결은 아직 — Gateway/채널 권한 계약을 먼저 읽고 BLACKHOLE 기존 인증 경계에 붙는 최소 어댑터를 격리 시험. 둘 다 여유 RAM이 낮은(0.6~0.7GiB) 상태에서 무거운 설치·실행을 겹치면 실측 RAM이 더 빠듯해질 수 있으니, 완전 동시 실행보다는 한쪽 설치/빌드가 끝나고 유휴로 들어간 뒤 다른 쪽을 시작하는 식으로 겹쳐도 좋다(코드 작성·조사는 진짜 병렬, 무거운 설치·기동만 순서대로).

- **(2026-09-28 추가, 소유자가 두 번째로 반복 지시: "스타 많은 오픈소스들은 죄다 다 우리 OS에 넣어야한다")** `docs/CODEX_DIRECTIVE_OPENCLAW_INTEGRATION_20260928.md`: OpenClaw(github.com/openclaw/openclaw, MIT) 통합 Phase 1. OpenClaw 소스는 병합하지 않고 분리 프로세스로 유지, 새 `runtime/lib/openclaw-bridge.mjs`만 기존 loopback-only 계약으로 통신. 텔레그램 채널만 켜서 왕복 검증(인수 T1). pnpm install이 이 PC RAM(여유 0.4~0.5GiB)에서 실제로 되는지부터 확인. Android/iOS/macOS 네이티브 빌드는 이번 단계 범위 아님.
- **(2026-09-27 추가, 소유자 지시로 P1과 같은 순위)** `docs/CODEX_DIRECTIVE_LIVING_SYSTEMS_20260927.md`: 호문쿨루스·그림자군단(나혼렙)·커비·JEV·양자·옵시디언 장기기억·자비스 표현층 7계통을 한 루프로 묶은 상세 지시서. 소유자가 "안드로이드 실기기·원격 키는 나중에" 하고 이 7계통을 먼저 하라고 했으므로, P0 두 항목의 **외부 입력을 기다리는 동안 이 지시서의 §5 빌드 순서(원장 import → 호문쿨루스 → 커비 → 그림자 명부 → JEV → 양자 → 자비스)를 진행**한다. 실기기가 붙거나 키가 들어오면 그 즉시 P0로 복귀.
- `docs/CODEX_DIRECTIVE_JARVIS_VISUAL_UPGRADE_20260927.md`: §91에서 로컬 Three.js WebGL2 오브·3개 링과 2D 폴백을 구현했다. Edge 1440px 회전, 400px WebGL 실제 그리기 60fps, reduced-motion 정지, WebGL 차단·실제 context loss 시 2D 폴백, 집중·전체 회귀를 확인했다. 이 FPS는 PC 브라우저 측정이며 Android 실기기 결과가 아니다. V5의 원격 실모델 A1·실물 휴대폰은 여전히 미실행이다.
- **GPU 조회 완료 (§90)**: Intel(R) UHD Graphics. DirectX 진단은 전용 메모리 **128 MB**, 공유 메모리 **3,958 MB**, 표시 메모리 **4,086 MB**를 보고했다. `Win32_VideoController.AdapterRAM`의 약 2 GiB는 전용 VRAM 용량으로 해석하지 않는다. 드라이버 32.0.101.7082. GPU 구매 판단과 Three.js 구현은 별도 과제다.

- **(2026-09-28 신규)** `docs/CODEX_DIRECTIVE_OSS_VOICE_SEARCH_20260928.md`: JARVIS 음성(whisper.cpp STT + Piper TTS, 둘 다 MIT)과 G1 검색을 SearXNG(AGPL-3.0, 자체호스팅) 자체호스팅으로 우회하는 제안 3건. 음성 I/O·자체호스팅 검색엔진은 `BLACKHOLE_AUTONOMY_CRITERIA_20260928.md` 기준 "새로운 종류"라 6조건 대조 결과를 실제로 보고할 것, 특히 이 PC 저RAM(0.4~0.7GiB)에서 실측 없이 된다고 가정 금지.

## 지금 무시해도 되는(선행 이슈로 해소된) 과거 지시서

- `docs/CODEX_DIRECTIVE_RAM_RECOVERY_20260927.md`: RAM 강제 확보 지시서. §72에서 "로컬 전용 테스트만 RAM을 쓴다"는 게 밝혀지고 REMOTE_PROVIDER 지시서로 대체됨. RAM 자체를 인위적으로 더 비우는 작업은 더 이상 우선순위 아님.
- `docs/CODEX_DIRECTIVE_BUILDER_EMPTY_20260927.md`: Builder 빈 응답 원인 조사 지시서. 같은 이유(§72)로 "로컬 3B 모델만 썼던 테스트 설계 문제"로 재해석됨 — 원인 분석 내용 자체는 배경지식으로 유효하지만, 이 지시서의 액션 항목(프롬프트 튜닝 금지 등)은 REMOTE_PROVIDER 지시서 기준으로 대체됨.
- `docs/CODEX_DIRECTIVE_REMOTE_PROVIDER_20260927.md`: 라우팅/설정 배선은 §75~§86에서 구현됐으므로 별도 재구현 지시로 쓰지 않는다. 실제 provider 응답과 A1 수락은 아직 별개로 미실행이다.

## 과거 지시서의 확인된 범위와 잔여

- `docs/CODEX_DIRECTIVE_AGENT_SCALE_20260926.md`: §55에서 동시 작업 상한과 합성 병렬 2건을 확인하고 Windows 개발자 저널 오류를 고쳤다. 실모델 다중 부하, researcher/builder 증거 확장, 퇴행 감시, CI 가드레일 전체 수락은 근거가 없어 완료로 표시할 수 없다. P0/P1 이후 잔여 항목을 다시 대조할 것.
- `docs/CODEX_DIRECTIVE_JARVIS_FACE_20260926.md`: §53에서 실제 서버/Edge 화면, CSP/400px/reduced-motion, 로컬 Ollama 호출과 산출물 표시를 확인했다. 당시 로컬 모델 답의 내용 품질은 미달이었고 이후 §75~§79에서 화면·라우팅·합성 수락을 보강했다. 원격 A1과 세계적 UI 품질은 증명되지 않았다.

## 공통 원칙 (반복 강조)

- **(2026-09-28 신규)** `docs/BLACKHOLE_AUTONOMY_CRITERIA_20260928.md`: §117류 개별 사안마다 소유자에게 새로 묻지 않아도 되는 7개 조건(루프백 전용·공식배포본+해시+허용라이선스·읽기전용또는이미안전장치코드화·자격정보는소유자전용·되돌릴수있음·기존증거기록·이미확인받은종류의반복). 동종 사안 착수 전 이 기준부터 먼저 대조할 것. 자격정보·금전·네트워크노출확대·Vault원문삭제·G1최종게이트는 이 기준으로도 안 풀리며 여전히 개별 확인 필요.
- 실패를 성공으로 포장하지 말 것 — 이번 세션 내내 지켜짐, 계속 유지.
- **(2026-09-30 욕망 v3, 진행 중인 일괄 작업의 C3 다음·C5 앞에 삽입)** `docs/CODEX_DIRECTIVE_DRIVES_V3_20260930.md`: 배부름을 결정 시점이 아닌 검증된 결과 정산으로 연결(멱등), `driveOutcomes` 충족 장부·stuck, G1 검토 대기 초안 기반 cue, 상태 API·화면·대사 반영. v1/v2 재현·백업 복원 유지, gap-scout의 `version!==2` 등 v3 대응 필수.
- **(2026-09-30 S9~S20, S0~S8·욕망 v3 완료 뒤 시작)** `docs/CODEX_DIRECTIVE_S9_S20_EXPANSION_20260930.md`: 진짜 측정→밤 주기→그림자 실행 프로필→편재→교환소→영수증→제3자 검증→자기 개선 제안→무대 UI→설치/CI→사업 층→공개 준비. 시험 3층 러너 선행, 전체 회귀 4회, 단계 사이 체크포인트 커밋 승인 요청.
- **(2026-09-30 릴 흡수, charter P1.5)** `docs/CODEX_DIRECTIVE_ABSORB_REELS_20260930.md`: thinking-orbs 소스 복사(검증된 sha·LICENSE·VENDOR.md)로 상태 오브(실제 기록 매핑, 원천 없으면 정지), Agent Reach 커넥터 서술자 not_implemented, 릴 주장은 reference-claim(unverified)·측정은 S9 실측 출처로 시험, 게시·계정·결제 금지, 보류 목록.
- 모든 변경은 `docs/CLAUDE_EXECUTION_STATE.md`에 `## §N — 날짜 Codex: 제목` 형식으로 기록, VERIFIED/RAN-UNVERIFIED/BLOCKED 구분 명시.
- Claude(Cowork)는 결과를 파일/해시 직접 대조로 재검증함 — 구두 보고만으론 완료 처리 안 됨.
- §90에서 `BLACKHOLE Core v2` 정식 예약 작업과 8790 로컬 코어가 실제 실행 중이다. Codex 터미널에서 만든 `%LOCALAPPDATA%\BLACKHOLE`과 예약 작업이 보는 같은 표기 경로의 파일 가시성이 달라, 터미널에서 직접 실행한 `status`를 정식 설치 상태의 근거로 쓰면 안 된다. 예약 작업 문맥의 상태 보고와 실제 8790 HTTP 응답을 기준으로 확인한다. 첫 설치 기본값은 안전한 난수 페어링 키 자동 생성이며 소유자에게 키 입력·복사를 요구하지 않는다.

## 2026-09-28 §118~§119 상태 갱신

- 스케줄러 회귀 우선 작업 완료: 기본 조건 단독 3/3 실패를 힙 상한 768MiB 조건에서 5/5 통과로 재현·토글했다. 제품 스케줄러와 4초 관찰창은 불변. 전체 `npm.cmd test` 1,237/1,216/0/21, §118 참조. 위 P1의 회귀 실패 설명은 과거 상태다.
- Obsidian 공식 5.3.0 릴리스 파일을 Vault `.obsidian/plugins/obsidian-local-rest-api/`에 설치하고 활성화 목록에 등록했다. PC 화면 잠금 때문에 실행 중인 Obsidian은 아직 새 플러그인을 로드하지 않았고 27123/27124 리스너 및 실제 검색 결과는 없다. §119 및 Vault `CHANGELOG.md` (46) 참조. 잠금 해제 후 앱 재로드와 실제 검색이 남았다.
- S1+ 지시서를 구현하기 전에 계약 정정 필요: 기존 `solo-leveling.mjs`는 D=검증 성공 1건, C=서로 다른 입력 성공 2건이다. 지시서의 D=3건과 동시에 만족할 수 없다. `shadow:scout` 형식도 기존 skill ID 정규식에 맞지 않으며, `levelingHistoriesFromState`는 영속 필드가 아니라 상태에서 이력을 재계산한다. 등급을 임의 보정하지 말고 실제 증거→기존 규칙에 맞는 ID 매핑과 재시작 지문을 설계한 후 진행한다.

## 2026-09-28 §122 상태 갱신

- 위 S1+ 계약 정정은 반영됐다. 그림자 개체별 UUID를 `shadow-<uuid>`로 매핑하고 실제 검증 임무에서 D→C 승급·재시작·같은 역할의 이름 배정 및 JARVIS 400px 표시까지 격리 시험으로 확인했다. 등급 B/A/S는 필요한 실제 조합·자율·외부 성과 근거가 없어 열지 않았다. §122와 `build-artifacts/living-20260927/s1plus/` 참조. 실모델·운영 수락으로 확대해서 읽지 말 것.
- §118의 768MiB 러너만으로는 스케줄러 파일의 Windows 네이티브 종료가 재발했다. 15.1MiB 입력도 실제 백업 용량 한도를 넘는다는 단언을 추가하고 테스트 자식 힙을 512MiB로 제한한 최종 전체 회귀가 1,239/1,218/0/21로 통과했다. 중간 실패와 미확정 `0xC0000409` 종료 원인은 §122에 기록했다. 위의 과거 §118 합격 기록을 보편적 안정성 증거로 보지 말 것.
- Obsidian 앱의 실제 플러그인 로드·Vault HTTPS 읽기 검색, Android 실기기, 원격 모델 A1은 계속 별도 수락 대기다. §121 재사용 기준에 해당하는 후속 로컬 작업은 매번 다시 묻지 않고 진행한다.

## 2026-09-30 오픈소스 조립 원칙 (Claude)

- `docs/CODEX_DIRECTIVE_OSS_ASSEMBLY_20260930.md`: 직접 만들기 전에 오픈소스를 먼저 찾는다. A(복사·기록만)/B(별도 프로세스·처음 켤 때 1회 승인)/C(제외). 감사 `docs/OSS_ASSEMBLY_AUDIT.md`, 신규 작업 검사 `docs/OSS_FIRST_CHECKS.md`. 교체는 어댑터+폴백, 모듈 하나씩, 기존 시험 약화 금지. 직접 만드는 것은 정책층(증거 인정 기준·욕망 정의·그림자 정책·JEV 기준·승인 조건)뿐, 엔진층은 고유 모듈이라도 오픈소스 후보 먼저(동결 3파일 제외). 목표헌장 부록 B.
- 2026-09-30 재설계 초안: `docs/BLACKHOLE_REDESIGN_OSS_FUSION_20260930.md`, 후보 지도 `docs/OSS_CANDIDATE_MAP_20260930.md` — AUD-1/AUD-4의 출발점(가설, Codex 관측값 우선).
