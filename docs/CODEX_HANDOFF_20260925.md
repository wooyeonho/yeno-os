# Codex 인수인계 — Windows resident-v2 ↔ Android BLACKHOLE 앱 연결 완성 (2026-09-25)

이 문서는 Claude(Cowork) 세션이 연호님 지시로 작성한 인수인계 문서다. 연호님이 준 목표·요구사항은 아래 "연호님 지시 원문"에 **한 글자도 바꾸지 않고** 옮겼다. 그 아래 "현재 상태"는 Claude가 실제 PC 저장소에서 직접 확인한 사실만 적었다. AGENTS.md 81행에 따라 개발·설계·검증은 Codex 세션 담당이다.

## 연호님 지시 원문 (2026-09-25, 그대로)

목표: Windows resident-v2와 Android BLACKHOLE 앱을 연결해, 휴대폰에서 보낸 요청이 PC에서 실행되고 진행과 결과가 휴대폰에 표시되도록 완성한다.

먼저 실제 연결 폴더 C:\Users\우연호\Documents\Projects\yeno-os에서 remote, branch, HEAD, 작업 트리를 확인하고 AGENTS.md와 docs/CLAUDE_EXECUTION_STATE.md의 최신 항목을 읽어라. 예상 기준은 branch blackhole/p3-jev-recovery-port-20260924, HEAD 4aeccf2다. 다르면 현재 상태를 확인하고 기존 변경을 보존하라. 확인만 하고 멈추지 말고 구현을 이어가라.

이미 보고된 변경:
- scripts/blackhole-resident.ps1에서 페어링 키를 CSPRNG로 자동 생성하고 사용자 전용 권한으로 저장
- Windows 회귀 테스트 추가
- 저장소 안에 더블클릭 설치 파일 추가

이 변경을 실제 파일과 diff에서 확인한 뒤 다음을 완성하라.

1. 설치·실행
- 더블클릭 설치가 PowerShell의 수동 입력 없이 동작하도록 한다.
- 기존 승인 범위(사용자 권한의 예약 작업 등)를 넘는 변경은 하지 않는다.
- 연결된 PC의 클릭 도구로 저장소 안 설치 파일을 실행하고, 코어 health와 status를 확인한다. 비밀값은 화면·로그·채팅에 노출하지 않는다.

2. 안전한 휴대폰 페어링
- Android 앱이 장기 owner 키를 입력받지 않도록 실제 페어링 UI를 구현한다.
- 장기 키를 QR이나 로그에 노출하지 않는다. 필요하면 만료·1회 사용·기기 등록만 허용하는 별도 페어링 토큰과 소유자 확인을 사용한다.
- Android 앱의 QR 스캔, 서버 등록, 기기별 토큰의 안전한 저장, 취소·재등록까지 연결한다.
- 터미널에 QR을 출력하는 것만으로 완료 처리하지 않는다. 기존 인증 경계를 약화하지 않는다.

3. 검증과 기록
- Windows PowerShell 5.1 및 실제 예약 작업 테스트를 실행한다. Android 앱도 빌드하고, 가능한 범위에서 연결·명령·진행·결과·재시작 복구 시나리오를 검증한다.
- 수정 후 전체 완료 시나리오를 다시 실행해 회귀를 확인한다.
- docs/CLAUDE_EXECUTION_STATE.md에는 실행한 명령과 결과, 실패 원인, 재개 지점을 기록한다.
- 직접 실행해 확인한 것과 못 한 것을 분리한다. 실제 기기에서 확인하지 않은 동작은 VERIFIED라 부르지 않는다.
- 같은 원인 가설로 세 번 실패하면 접근법을 바꾸고, 세 가지 다른 접근도 막히면 원인과 남은 한 단계만 보고한다.

PowerShell 명령 입력이나 키 붙여넣기를 연호님께 반복 요청하지 마라. Tailscale 로그인처럼 소유자가 직접 해야 하는 단계가 남으면, 코드와 자동 검증을 먼저 끝낸 뒤 마지막에 필요한 조작 하나만 정확히 안내하라.

## 현재 상태 (Claude가 실제 PC 저장소에서 직접 확인, 2026-09-25)

### 저장소
- 경로 `C:\Users\우연호\Documents\Projects\yeno-os`, `origin` = `https://github.com/wooyeonho/yeno-os.git`
- 브랜치 `blackhole/p3-jev-recovery-port-20260924`. 이 인수인계 커밋의 부모는 `4aeccf2`(연호님 예상 기준과 일치).
- 이 커밋에 아래 "이미 된 것"이 모두 포함돼 있다. 작업트리는 이 커밋 후 깨끗하다.

### 이미 된 것 — 전부 CONFIGURED (코드는 있으나 실행·검증 안 됨)
Claude 세션은 이 PC에서 PowerShell을 실행하거나 터미널에 입력할 수 없고(플랫폼 등급 제한, `docs/CLAUDE_EXECUTION_STATE.md` §28), Android SDK/gradle/adb도 없다. 그래서 아래는 **코드 검토까지만** 된 상태다. RAN도 VERIFIED도 아니다.

1. `scripts/blackhole-resident.ps1` — `-PairingToken`이 없으면 `[Security.Cryptography.RandomNumberGenerator]`로 32바이트 생성 → base64url 43자 → 기존 ACL 보호 `secrets\pairing.token`에 저장. `Read-Host` 대화형 프롬프트 제거. 콘솔 출력 없음. `-PairingToken` 명시 경로는 그대로(기존 CI 테스트가 쓰는 경로). 상세: §30 변경 1.
2. `scripts/test-resident-windows.ps1` — 새 단계 `auto_generated_pairing_key`: 격리 HomeDir/TaskName/Port로 키 없이 설치 → 키 파일 길이·공백·base64url·ACL 검증 → 그 키로 `/api/v1/devices/enroll` 실제 등록 → 누적 콘솔 출력에 키 미노출 검증 → stop/uninstall. 기존 단계 무변경. 상세: §30 변경 2.
3. `scripts/install-blackhole-resident.cmd` (신규) — `%~dp0` 기준으로 옆의 ps1을 찾아 `-Action install -InitializeNewStore` 실행. 관리자 권한 없음. 상세: §30 변경 3.

### 아직 안 된 것 (연호님 지시 기준)
- 지시 1의 "연결된 PC의 클릭 도구로 설치 파일 실행 + health/status 확인": Claude가 못 함(위 제한). Codex 환경에서 실행·확인 필요.
- 지시 2 전체(안전한 휴대폰 페어링): **미착수**. 이 저장소에는 QR 관련 코드·의존성이 0건이다(grep 확인). 현재 Android 앱(`apps/controller/src/main.ts` 299행 부근)은 소유자가 장기 pairing 키를 텍스트 필드에 직접 넣어 `POST /api/v1/devices/enroll`에 `Bearer <pairing key>`로 보내는 구조다 — 이걸 바꾸는 게 지시 2의 핵심이다.
- 지시 3의 실행·검증 전부.

### Codex가 바로 쓸 수 있는 코드 사실 (Claude가 §27에서 대조·확인)
- `resident-v2`는 별도 서버가 아니다: `runtime/resident.mjs:144`가 `runtime/server.mjs`의 `start({dataDir, token, host:'127.0.0.1', port})`를 그대로 호출한다. 8790의 라우트 표 = `server.mjs` 라우트 표.
- 컨트롤러가 쓰는 엔드포인트와 서버 라우트는 전부 일치한다(§27 표). 인증: `Authorization: Bearer <token>`, `server.mjs:1521 bearer()`, `1530 authenticate()`. 기기 등록: `1806 POST /api/v1/devices/enroll`(pairing 토큰 해시 대조 후 `enrollDevice`), 기기 토큰은 `deriveDeviceToken(id)` = HMAC(token, id).
- 중복 방지: `server.mjs:1572 mutation()`이 `requestId`로 영수증을 찾아 같은 응답을 돌려준다 — 컨트롤러 `command-session.ts`의 pending/receipt 모델과 일치.
- 기존 Windows CI 인수시험 `scripts/test-resident-windows.ps1`은 실제 예약작업·실제 HTTP·실제 ACL을 검사하는 진짜 시험이다. 지시 2 구현 시 여기에 페어링 토큰 시나리오(발급·만료·1회 사용·취소·재등록)를 추가하는 것이 자연스럽다.
- Android 빌드는 로컬이 아니라 GitHub Actions `android-debug.yml`이다(AGENTS.md 116행). 워크플로 실행 ≠ APK ≠ 기기 검증(같은 행).

### 이 PC의 환경 사실
- Tailscale 미설치 (`docs/CLAUDE_EXECUTION_STATE.md` §28). 휴대폰↔PC 실제 연결은 Tailscale Serve 브릿지(`runtime/resident.mjs:144-188`, `phone-install` 액션)를 전제로 하므로, 실제 기기 검증 직전에 "Tailscale 설치·로그인" 한 단계가 소유자 조작으로 남는다. 연호님 지시대로 코드·자동 검증을 먼저 끝낸 뒤 그 한 단계만 안내할 것.
- 기존 승인 범위: `blackhole-resident.ps1`은 일반 사용자 권한(`-RunLevel Limited`)의 예약 작업 1개만 등록, 방화벽·서비스·레지스트리 변경 없음(§27b). 이 범위를 넘는 변경은 하지 말 것(연호님 지시 1).

### 읽어야 할 곳
- `docs/CLAUDE_EXECUTION_STATE.md` §25~§30 (특히 §27 계약 대조 표, §27b 설치 스크립트 검토, §28 플랫폼 제한, §30 이번 변경 상세)
- `AGENTS.md` 81행(역할), 91행(첫 사용 흐름), 101행(requestId), 116행(Android CI)
- `runtime/server.mjs` 1521~1533(인증), 1572~1600(mutation/영수증), 1806~1811(enroll), 2170~2222(commands/control)
- `apps/controller/src/main.ts` 285~315(현재 페어링 흐름), `command-session.ts`
