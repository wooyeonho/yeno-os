# CODEX 지시서 — OpenClaw 통합 Phase 1: 텔레그램 채널로 폰↔PC 연결 (2026-09-28)

## 0. 배경 — 왜 이 지시서가 나왔나

소유자 지시(2026-09-28, 두 번째 반복): "스타 많은 오픈소스들은 죄다 다 우리 OS에 넣어야한다니깐 내가 첨부터이야기햇잖아." 이전에도 "내가 안 알려줘도 알아서 찾아서 사용가능하게"라고 했던 것과 같은 맥락 — 검증된 인기 오픈소스를 찾을 때마다 매번 허락받지 말고 적극적으로 통합할 것. 이번엔 소유자가 이미 자기 PC에 내려받아 둔 실제 폴더(`C:\Users\우연호\openclaw-main\openclaw-main`)를 Claude(Cowork)가 직접 열어 확인했다.

**확인한 사실** (추정 아님, 실제 파일 직접 읽음):
- OpenClaw(github.com/openclaw/openclaw) — Node.js/TypeScript 모노레포, `LICENSE` 파일 직접 확인 결과 **MIT**(Peter Steinberger, 2025). Node 엔진 요구 `>=22.12.0`(이 PC는 시스템 Node 22.23.2 보유, BLACKHOLE 번들 Node 24.19.0도 호환).
- `src/telegram`은 스텁이 아니라 실제 성숙한 모듈(계정·핸들러·디스패치·스레드별 테스트 다수). 핵심 의존성에 `grammy`(텔레그램 봇 프레임워크, MIT)·`@whiskeysockets/baileys`(왓츠앱, 오픈소스)가 이미 들어있음.
- `extensions/device-pair`, `extensions/phone-control`, `apps/android`, `apps/ios`, `apps/macos`도 실제 존재.
- 저장소 자체 용량 56MB(설치 전), 루트 직접 의존성 73개 — 감당 가능한 크기.

## 1. 핵심 통찰 — 왜 텔레그램이 첫 단계인가

지금까지 몇 주째 막혀있던 **Android 실기기 연결**(ADB 0대, QR 페어링·커스텀 APK 설치·재시작 복구 전부 미검증)은 "USB/ADB로 커스텀 앱을 페어링한다"는 **경로 자체**의 문제였지, "폰에서 PC로 메시지를 보낸다"는 목표 자체가 막힌 게 아니었다. OpenClaw의 텔레그램 채널은 ADB·USB·APK 설치가 전혀 필요 없다 — 소유자 폰에 이미 깔려있는 텔레그램 앱으로 봇에게 메시지를 보내면 끝이다. 그래서 이번 지시서는 막혀있던 커스텀 Android 앱 경로를 계속 붙잡고 있는 대신, **검증된 별도 경로로 오늘 당장 폰↔PC 왕복을 실제로 뚫는 것**을 목표로 한다.

## 2. 아키텍처 — 병합 금지, 분리 프로세스 + loopback 다리만

**OpenClaw 소스 코드는 BLACKHOLE 저장소에 병합하지 않는다.** 이유: (a) 완전히 다른 모노레포·의존성 트리를 억지로 합치면 두 프로젝트 다 깨지기 쉽고, (b) 업스트림 업데이트를 계속 받으려면 원본 그대로 두는 게 낫고, (c) 기존 계약 동결(§2 공통 규칙류)이 걸린 BLACKHOLE 코드와 완전히 분리해야 감사하기 쉽다.

- OpenClaw는 별도 디렉토리에 그대로 둔다(권장: 저장소 바깥 `C:\Users\우연호\openclaw-main\openclaw-main`을 그대로 쓰거나, `vendor/openclaw`로 원본 그대로 복사 — 어느 쪽이든 **OpenClaw 자체 소스 파일은 한 글자도 수정하지 않는다**. 수정이 필요해 보이면 방법을 못 찾은 것이지 수정 대상이 아니다).
- BLACKHOLE 쪽에는 새 파일 `runtime/lib/openclaw-bridge.mjs` 하나만 만든다. 기존 `memory-embeddings.mjs`의 `localEmbedEndpoint()`/`provider-config-engine.mjs`의 `localEndpoint()`와 **완전히 같은 loopback 전용 계약**(`127.0.0.1`/`localhost`만, HTTPS 아님, query·fragment·credential 없는 URL만)으로만 OpenClaw 프로세스와 통신한다. OpenClaw가 실행 권한이나 새 외부 네트워크 목적지를 BLACKHOLE에 부여하는 일은 없다.
- OpenClaw는 **텔레그램 채널 하나만** 켠 최소 설정으로 띄운다(`.env` 또는 config로 다른 채널 전부 비활성 — discord/slack/whatsapp/signal 등 이번 단계에서 켜지 않음, 필요해지면 별도 지시서).

## 3. Phase 1 스코프 — 순서대로

1. **설치 가능성 먼저 확인**(코드 작성 전): `C:\Users\우연호\openclaw-main\openclaw-main`에서 `pnpm install`(pnpm 없으면 먼저 설치) 시도. 이 PC 실측 여유 RAM이 0.4~0.5GiB로 매우 낮으므로(§96·§99), 설치 중 메모리 부족으로 실패하면 원인을 정확히 보고하고 npm으로 대체 가능한지 확인한다. **Android/iOS/macOS 네이티브 앱 빌드는 이번 단계에서 시도하지 않는다**(Windows 환경과 무관, Phase 2 이후).
2. **텔레그램 봇 생성은 소유자 액션**: Codex가 대신 계정을 만들지 않는다. 소유자가 텔레그램 `@BotFather`에서 봇을 만들고 토큰을 발급받아야 하며, 그 토큰은 기존 DPAPI 방식(`provider.dpapi`류)과 같은 수준으로 암호화 보관한다(평문 로그 금지, 기존 `assertNoSecrets` 원칙 재사용).
3. OpenClaw를 텔레그램 채널만 켠 상태로 로컬에서 기동하고, **소유자 본인 폰의 실제 텔레그램 앱**으로 메시지를 보내 왕복되는지 1차로 그 자체만 검증(BLACKHOLE 연결 전, OpenClaw 단독 동작 확인).
4. `openclaw-bridge.mjs`: OpenClaw가 받은 텔레그램 메시지를 기존 `/api/commands` passthrough 계약으로 BLACKHOLE에 전달하고, BLACKHOLE의 응답을 다시 텔레그램으로 돌려보내는 **왕복만** 구현한다. 새로운 실행 권한을 만들지 않는다 — 텔레그램에서 온 메시지도 기존 명령 게이트(owner-approval, `pendingOwnerAction` 등)를 그대로 통과해야 한다. 텔레그램 발신자가 실제 소유자 계정인지 확인하는 allowlist(OpenClaw 자체 기능, `bot-access.ts`)를 반드시 켠다 — 아무나 봇에게 말 걸 수 있으면 안 됨.
5. **인수 T1**: 소유자가 실제 텔레그램 앱에서 BLACKHOLE 상태를 묻는 메시지를 보낸다 → 실제 운영 상태(예: 능력 개수, 원장 건수 등 `/api/state` 실측값)가 담긴 응답이 몇 초 안에 폰 텔레그램 화면에 온다. 증거: 실제 폰 화면 스크린샷(또는 텔레그램 데스크톱 앱 스크린샷 — 소유자가 직접 보낸 메시지와 받은 응답이 같은 스레드에 보이는 것), 서버 로그의 왕복 기록.

## 4. Phase 2(예고만, 이번 지시서 범위 아님)

- `extensions/memory-lancedb`(LanceDB, 실제 오픈소스 임베디드 벡터DB) — 기존 bge-m3+Ollama loopback 회수 경로와 비교해 볼 가치가 있음. 이번 단계에서 손대지 않음.
- `extensions/device-pair` + `extensions/phone-control` + `apps/android` — OpenClaw가 검증해 둔 방식으로 Android 네이티브 페어링을 다시 시도할 수 있음. 이번 단계에서 손대지 않음.
- 왓츠앱 등 다른 채널 — 텔레그램으로 왕복이 실제로 증명된 뒤에만 검토.

## 5. 하지 말 것

- OpenClaw 소스 파일 수정 금지(업스트림 그대로 유지).
- 이번 단계에서 텔레그램 외 다른 채널 활성화 금지.
- `authorizesDispatch:false`·JEV·기존 스케줄러 동결 계약 변경 금지 — OpenClaw 자체 daemon/cron은 OpenClaw 앱 내부 기능이지 BLACKHOLE에 새 스케줄러를 추가하는 게 아니다(Ollama와 같은 취급: 소유자가 직접 선택해서 띄워두는 상시 로컬 서비스). 다만 OpenClaw가 BLACKHOLE에 넘기는 모든 요청은 기존 owner-approval 게이트를 그대로 통과해야 한다.
- 텔레그램 봇 토큰 로그 노출 금지(`assertNoSecrets` 재사용).
- allowlist 없이 아무 텔레그램 사용자나 봇과 대화 가능한 상태로 두지 않는다.

## 6. 보고 형식

기존 §7 보고 형식(VERIFIED/RAN-UNVERIFIED/BLOCKED, 실제 해시·스크린샷)을 그대로 따른다. `docs/CLAUDE_EXECUTION_STATE.md`에 다음 번호로 기록.

## 7. 2026-09-28 실물 확인에 따른 정정

ADB 연결 0대는 휴대폰이 연결되지 않았다는 관측값이며, **USB/ADB 페어링 경로 자체가 고장났다는 증거가 아니다.** 텔레그램 채널은 추가 원격 요청 경로가 될 수 있지만 Android APK의 native pairing·상태·결과·재시작 복구 수락을 대신 완료한 것으로 판정하지 않는다. 소유자 폰에 텔레그램 앱과 봇이 이미 있는지도 이번 PC 조사에서는 확인되지 않았다.

현재 로컬 OpenClaw는 `2026.2.13` ZIP 추출본으로 `.git` 커밋 메타데이터가 없고, `node_modules`/Gateway listener도 없다. `packageManager`는 `pnpm@10.23.0`인데 PATH의 pnpm은 `11.19.0`이다. 0.62 GiB 가용 RAM에서 전체 설치·실행 성공은 확인되지 않았다. 설치 전에 출처를 커밋/배포 해시로 고정하고, 패키지 매니저 버전·자원·활성화되는 채널과 도구 권한을 검증한다. Telegram 발신이 BLACKHOLE의 기존 소유자 인증과 동일하다고 가정하거나 OpenClaw의 allowlist만으로 BLACKHOLE owner credential을 자동 부여하지 않는다. 실제 bridge 계약은 OpenClaw Gateway/플러그인 이벤트의 호출 방향과 인증 scope를 확인한 뒤 정한다.
