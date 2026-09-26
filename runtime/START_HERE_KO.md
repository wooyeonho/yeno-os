# BLACKHOLE Windows/Android 시작 안내

이 문서는 현재 Windows resident와 Android Controller 경로를 설명한다. 이전 `launch.mjs`/`START_YENO_WINDOWS.cmd` 브라우저 실험판은 owner 연결 키를 사람이 옮기는 방식에 의존했으므로 신규 기기 연결에 사용하지 않는다. 런타임은 그 키를 터미널에 더 이상 출력하지 않는다.

## PC

Windows resident 설치 경로는 `scripts/install-blackhole-resident.cmd`와 `scripts/blackhole-resident.ps1`이다. 설치 과정에서 사용자 전용 경로에 owner 키를 자동 생성·보관하고, 콘솔에 표시하지 않는다. 기존 설치가 있으면 소유권과 데이터 보존 조건을 먼저 확인한다. 현재 앱의 Windows 로컬 연결은 `apps/controller/src-tauri/src/local_resident.rs`가 해당 설치의 키 파일을 내부에서 읽어 기기별 토큰으로 등록하므로 키를 입력하거나 복사하지 않는다.

Windows resident의 실제 실행 상태는 설치 파일 존재만으로 판단하지 않는다. 예약 작업 소유권, 포트·health, 기기 등록, 작업·결과, 중지·재시작 후 상태를 확인해야 한다. 이 저장소의 실행 기록은 `docs/CLAUDE_EXECUTION_STATE.md`를 따른다.

## Android

Android 앱은 PC 소유자 전용 `scripts/pair-blackhole-phone.cmd` GUI가 표시하는 짧은 수명의 QR을 카메라로 읽어 등록한다. QR이나 owner 키를 터미널·로그·채팅에 붙여넣지 않는다. 폰과 PC 사이에는 승인된 사설 HTTPS 경로가 필요하다. 연결 뒤 앱에서 무해한 문서 작업을 요청하고, PC 실행·진행/실패·결과 해시·앱/코어 재시작 복구와 기기 철회를 확인한다. 정확한 실기기 수락 절차와 현재 미완료 항목은 `docs/CLAUDE_EXECUTION_STATE.md`에 기록한다.

현재 디버그 APK 빌드와 브라우저 대체 검증은 실기기 설치·작동 증거가 아니다. 실제 휴대폰과 사설 HTTPS 연결을 확인하기 전에는 완료로 표시하지 않는다.