# BLACKHOLE Android 연결 안내

현재 경로는 Android Controller 앱의 **일회성 QR 등록**과 Windows resident다. 이전 `START_PHONE_WINDOWS.cmd`/`launch.mjs --phone` 브라우저 실험판의 owner 연결 키 수동 입력 절차는 신규 기기 연결에 사용하지 않는다. 그 실험판의 키는 터미널에 출력되지 않는다.

PC와 휴대폰이 같은 소유자의 사설 HTTPS 경로에 접근할 수 있어야 한다. 현재 resident의 `phone-install` 경로는 소유권을 확인한 뒤 기존 Tailscale Serve 설정을 덮어쓰지 않고 전용 9443 경로를 구성한다. Tailscale 설치·로그인·동의는 실제 사용자 기기에서 확인해야 하며, 이 저장소의 로컬 검사만으로 사설망이 준비됐다고 말할 수 없다.

PC에서 resident가 실행 중이고 사설 HTTPS 연결이 확인되면 `scripts/pair-blackhole-phone.cmd`의 소유자 GUI에서 5분짜리 단일 사용 QR을 표시한다. Android 앱 카메라로 QR을 읽어 기기별 토큰을 등록한다. QR 원문, owner 키, 기기 토큰을 콘솔·로그·채팅으로 옮기지 않는다. 잘못 등록한 기기는 철회한다.

연결 확인은 앱에서 무해한 문서 작업을 요청해 PC가 실행하고, 앱에 진행·완료/실패가 보이며, 결과 SHA-256을 확인하고, 앱 종료/재시작과 코어 재시작 뒤 같은 작업을 조회하는 방식으로 수행한다. PC 오프라인 시에는 오프라인으로 표시돼야 한다. APK 빌드·브라우저 대체 시험은 이 실기기 시험을 대신하지 않는다. 현재 상태와 근거는 `docs/CLAUDE_EXECUTION_STATE.md`를 참조한다.