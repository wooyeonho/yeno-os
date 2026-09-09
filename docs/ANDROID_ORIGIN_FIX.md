# Android 최초 연결 Origin 호환성 수정

2026-09-09 UTC. 코어 버전 0.2.2 / API 1의 호환성 수정이다. 기존 로컬 노트북 0.2.3과 별개다.

## 문제와 재현

소유자 APK에서 주소·연결 키·보관소 암호를 입력하고 연결하면 `Origin does not match Host`가 표시됐다. 실제 운영 HTTPS `/api/v1/health`에 `Origin: http://tauri.localhost`를 보내 HTTP 403과 같은 오류를 확인했다. 같은 운영 HTTPS Origin은 HTTP 200이었다.

Tauri 2.8.2의 기본 Android/Windows 번들 출처는 `http://tauri.localhost`다. 잠긴 HTTP plugin 2.5.2는 native 요청에 WebView 출처를 추가한다. 따라서 Origin 없는 HTTP 검사만 통과한 것으로 APK 연결까지 검증했다고 판단할 수 없다.

- [잠긴 Tauri 버전의 출처 생성 코드](https://github.com/tauri-apps/tauri/blob/tauri-v2.8.2/crates/tauri/src/manager/mod.rs)
- [잠긴 HTTP 플러그인의 Origin 추가 코드](https://github.com/tauri-apps/plugins-workspace/blob/http-v2.5.2/plugins/http/src/commands.rs)

## 수정 범위

정확한 native 출처 `http://tauri.localhost`를 버전 API `/api/v1/`에서만 추가 허용한다. 기존 Host 허용 목록, 등록 키·기기별 bearer와 폐기, 웹의 출처 제한은 유지한다. Origin은 앱 신원 인증이 아니다. 임의 사이트·null·다른 localhost·포트·경로·유사 도메인을 허용하지 않는다. CORS wildcard와 `unsafe-headers`를 켜지 않는다.

APK·서명·연결 키·보관소 암호·데이터 스키마를 변경하지 않는다. 기존 APK에서 같은 입력으로 재시도할 수 있는 서버 수정이다.

## 검사·배포 상태

- 수정 전 기존 runtime 통합 검사: 16/16 통과. 이 기준선에는 실제 APK Origin을 포함한 수락 검사가 없었다.
- 수정 전 새 native Origin 검사 2개가 모두 실패했다(health 403/예상 200, 등록 403/예상 201). 수정 후 집중 검사 5/5 통과, 1.702초.
- 수정 후 Node 24.19.0 `npm test`: **66/66 통과**, 실패·취소·건너뜀 0, 14.668초. native 출처의 등록→문서 결과→재시작 영수증 보존→기기 폐기 및 인증·Host·출처·요청 경로 경계 포함.
- 별도 읽기 전용 코드 검토에서 배포를 막을 결함은 발견되지 않았다. 원래 요청 경로와 정규화 경로가 모두 `/api/v1/`인 경우에만 예외를 적용한다.
- 이 커밋 시점에는 실제 서버 반영과 반영 후 HTTPS 확인이 남아 있다. 아래 기록은 실제 배포 후 추가한다.
- 배포 전 실제 조회: 프로젝트 20개·자료 76개, AI 미설정. 기존 프로젝트·자료·기억 및 작업 결과의 비교 자료를 비공개로 확보했다.
- Android 실기기 재연결·보관소 해제·명령·앱 종료 후 같은 결과 확인은 서버 검사와 별도이며 소유자 확인 전까지 미검증이다.
