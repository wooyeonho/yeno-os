# BLACKHOLE Windows resident core

이 문서는 기존 "runtime/service.mjs"를 Windows 로그인 시 자동으로 실행하는 최소 운영 슬라이스다. 두 번째 스케줄러·두 번째 job engine·두 번째 provider를 만들지 않는다. 한 번 설치하면 노트북을 켜고 로그인할 때 BLACKHOLE의 기존 영속 코어가 다시 뜬다.

## 현재 구현 범위

- Windows Task Scheduler 작업 이름: BLACKHOLE Core
- 로그인 시 실행, 중복 인스턴스는 무시(MultipleInstances=IgnoreNew)
- 비정상 종료 시 최대 5회, 1분 간격으로 재시작
- 기존 runtime/service.mjs 호출
- 토큰은 %LOCALAPPDATA%\BLACKHOLE\secrets\pairing.token에 한 줄로 저장하고 현재 사용자만 읽도록 ACL 보호
- 데이터는 %LOCALAPPDATA%\BLACKHOLE\data에 저장
- 서비스 바인딩은 기본 127.0.0.1만 사용
- Node.js 20 이상 필요
- 모델 키가 없어도 Core·기억·큐·중단·복구가 부팅된다. 모델 호출은 별도 설정·예산·권한이 있을 때만 선택된다.

## 설치

저장소 루트의 PowerShell에서 실행한다.

    powershell -ExecutionPolicy Bypass -File .\scripts\blackhole-resident.ps1 -Action install

설치할 때만 pairing token을 한 번 입력한다. 실제 토큰은 채팅·Git·로그에 넣지 않는다. 설치 후 상태를 확인한다.

    powershell -ExecutionPolicy Bypass -File .\scripts\blackhole-resident.ps1 -Action status

삭제는 Task Scheduler 작업만 지우며 데이터와 토큰은 보존한다.

    powershell -ExecutionPolicy Bypass -File .\scripts\blackhole-resident.ps1 -Action uninstall

토큰까지 지울 때만 명시적으로 다음을 추가한다.

    powershell -ExecutionPolicy Bypass -File .\scripts\blackhole-resident.ps1 -Action uninstall -RemoveSecret

## 실제 수락시험

이 문서의 코드 검사만으로 Windows 상주 실행이 완료된 것은 아니다. 노트북에서 다음을 확인해야 한다.

1. install 후 taskState가 Running 또는 로그인 후 Ready인지 확인한다.
2. http://127.0.0.1:8790에서 기존 pairing token으로 상태를 읽는다.
3. 무해한 문서/상태 명령 하나를 제출하고 결과를 확인한다.
4. 작업과 브라우저를 닫고 다시 열어 같은 Core identity와 결과가 남는지 확인한다.
5. Windows 로그아웃/재로그인 후 status와 상태 API를 재확인한다.
6. 전체 멈춤을 켰다가 해제할 때 작업이 자동으로 재개되지 않는지 확인한다.
7. 실패 시 uninstall로 작업만 제거하고 데이터는 보존한다.

Android 폰에서 확인하려면 별도의 owner-configured HTTPS/Tailscale 경로가 필요하다. 이 슬라이스는 외부 포트를 열거나 Tailscale 계정을 자동으로 조작하지 않는다. 따라서 Windows live acceptance와 폰 재접속 acceptance는 아직 실행 전이다.

## 증거 경계

- 정적 테스트는 스크립트가 기존 서비스·토큰 파일·중복 방지·재시작 정책을 사용하는지만 증명한다.
- CI에서 Node 회귀를 통과해도 Windows Task Scheduler가 실제로 실행됐다는 뜻은 아니다.
- 실제 노트북 설치·로그인 재시작·폰 명령→결과는 소유자 기기에서 별도로 증명해야 한다.
- production(Koyeb/Vercel/Supabase)에는 변경하지 않는다.


## 폰 연결

폰 연결은 코어를 인터넷에 공개하는 방식이 아니라, 소유자 Tailscale 네트워크 안에서만 HTTPS로 전달한다. 먼저 Windows에 Tailscale을 설치하고 같은 계정으로 로그인한 뒤, 저장소 루트에서 다음을 실행한다.

    powershell -ExecutionPolicy Bypass -File .\scripts\blackhole-resident.ps1 -Action phone-install

이 명령은 기존 BLACKHOLE Core를 재시작해 허용된 Tailscale DNS 이름만 추가하고, BLACKHOLE Phone Bridge 작업을 로그인 시 함께 시작한다. 출력되는 https://<기기이름>.<tailnet>.ts.net:9443 주소를 Android controller의 코어 주소로 사용한다. Android 폰에도 Tailscale을 설치하고 같은 tailnet에 로그인해야 한다.

상태 확인:

    powershell -ExecutionPolicy Bypass -File .\scripts\blackhole-resident.ps1 -Action status

연결 해제:

    powershell -ExecutionPolicy Bypass -File .\scripts\blackhole-resident.ps1 -Action phone-uninstall

phone-uninstall은 BLACKHOLE Phone Bridge 작업과 이 저장소가 만든 host allowlist만 제거한다. 다른 Tailscale Serve 설정은 건드리지 않는다.

이 기능의 정적/CI 검사는 끝났지만 Tailscale 계정, Windows 노트북, Android 실기기에서의 명령→결과→재접속은 아직 실행 전이다. 그러므로 현재 상태는 PHONE_BRIDGE_CODE_READY이며 PHONE_LIVE_ACCEPTANCE_PENDING이다.
