# 변경 기록

## 2026-09-09 — 기존 Koyeb 계정 확인과 별도 YENO 후보

- 소유자 로그인과 YENO 저장소 선택 가능 상태를 확인했다. 기존 Gyeol 서비스의 소스·환경값·운영 배포는 변경하지 않았다.
- Koyeb 전용 Dockerfile/시작 경로와 정확한 hostname·port 설정, 실제 마운트/쓰기 권한 검증을 추가했다. 기존 Render와 공용 Docker 실행은 유지했다.
- 전체 Node 검사 46/46 통과, 실패·건너뜀·취소 0, 14.388초. shell/Node 구문 검사 통과. 실제 프로세스·인증·문서 결과·SIGKILL 복구를 실행했고 양성 마운트와 EACCES는 fixture임을 명시했다.
- 별도 Micro 서버·1 GB 볼륨 후보와 월 $5.36 서버 견적, 볼륨 preview 한계를 `docs/KOYEB_SETUP.md`에 기록했다. 실제 Docker/Koyeb/폰 연결은 남은 검증이다.
- YENO 서비스·볼륨·비밀값 생성과 새로운 결제·운영 배포는 실행하지 않았다. Render 후보는 보류했다.

## 2026-09-09 — 첫 실제 Android APK와 상주 코어 복구 후보

- 실제 CI 시도 3에서 Android ARM64 APK 생성·업로드에 성공했고 파일 해시·ZIP 무결성·native library를 확인했다.
- 서로 충돌하던 Tauri 내부 패키지를 release lock 기준으로 고정했다. 로컬 Rust 의존성 해결에 성공했고 성공한 CI의 Cargo.lock이 등록 파일과 일치했다.
- 영속 볼륨과 비밀 파일, 조용한 시작 경로, 단일 프로세스 컨테이너 구성을 준비했다.
- 실제 독점 flock을 검증하는 컨테이너 잠금으로 PID 재사용에 따른 crash 재시작 문제를 수정했다. 기존 PID 잠금은 임의로 삭제·우회하지 않는다.
- 강제 종료·재시작·데이터 보존 등을 포함해 로컬 검사 39개 통과. 실제 Docker 호스트·폰 연결·유료 모델·Windows 빌드는 아직 미검증이다.

## 2026-09-09 — 실제 Cargo 의존성 충돌과 기본 아이콘 누락 수정

- 두 번째 빌드는 SDK/NDK·Rust 설치를 통과했지만 HTTP 플러그인의 Tauri 최소 버전 조건에서 실패했다.
- 실제 배포된 crate 의존성으로 재확인해 Tauri를 2.8.2로 맞췄다. tauri-build 2.4.0과 JS API 2.8.0은 유지한다.
- 네이티브 컴파일 시 필요한 기본 PNG 아이콘을 SVG 원본과 Tauri CLI로 생성하고 설정에 명시했다.
- 이 수정의 완료 판정은 실제 CI 재실행 결과로 확인한다.

## 2026-09-09 — 첫 APK CI의 SDK 준비 실패 수정

- 첫 GitHub 빌드 실행에서 코어·명령 검사 30개와 화면 빌드 성공을 확인했다.
- Android 준비 단계의 `sdkmanager: command not found`를 확인해 SDK 설치·PATH 등록 action을 추가하고 확인한 커밋과 도구 버전을 고정했다.
- 수동 트리거·45분 제한·비공개 결과물 수집 구조를 유지하고 새 실행 안내를 갱신했다. 수정 이후 APK 컴파일 성공은 아직 검증하지 않았다.

## 2026-09-09 — Android 첫 빌드를 위한 후보 수정

- 네이티브 HTTPS API 권한과 Stronghold Argon2 설정을 수정했다.
- 거절된 명령으로 후속 제출이 막히는 문제, 기억 검색 결과 누락, 중복 제출과 재접속 상태 혼용을 수정했다.
- 기기 등록 응답 캐시에 토큰 원문을 저장하지 않도록 변경하고, 기존 데이터·인증을 보존하는 캐시 정리를 추가했다.
- 앱 패키지 lock과 Rust 직접 버전을 고정하고, 수동 ARM64 디버그 APK 빌드 및 결과 수집 설정을 추가했다.
- Node 24에서 30개 검사와 TypeScript·Vite 빌드가 통과했다. APK 컴파일·폰 설치·HTTPS 코어 연결은 아직 미검증이다.
- 현재 단계에 맞춰 개발 지침과 폰 실행 안내를 갱신했다. 검증 상세는 `docs/STATUS.md`를 따른다.

## 2026-09-08 — 비공개 GitHub 저장소 초기 등록

- `wooyeonho/yeno-os`의 기존 README 제목을 보존하고 실행·개발 안내를 추가했다.
- 준비된 실행 코어 0.1.1, 개발 지침, YENO 행동 기준과 수동 검증 워크플로를 수입했다.
- 이미 생성된 저장소에 맞춰 폰 안내와 첫 Codex 작업을 수정했다.
- Node 24 개발 기준을 명시했다.
- 실제 확인 상태와 남은 연결·빌드 작업은 `docs/STATUS.md`에 기록한다.

본 기록은 소스 등록에 관한 것이다. 운영 서버 배포, APK/EXE 생성, 실기기 확인을 뜻하지 않는다.

## 2026-09-09 — native controller candidate

- Added the versioned native controller API with persistent revocable device credentials.
- Added the Tauri 2 Android-first controller source and encrypted Stronghold connection vault.
- Added Android build and device acceptance procedures; no APK or device verification is claimed.


## 2026-09-09 — Android 첫 화면 관찰과 관리형 상주 서버 후보

- 사용자 Android 캡처에서 설치 후 본체 연결 화면 표시를 확인했다. 등록·보관소·명령·재접속은 아직 미검증으로 구분했다.
- Render native Node 서버 1개와 영구 디스크 1 GB를 선언한 `render.yaml`, `docs/RENDER_SETUP.md`를 추가했다. 자동 배포·preview는 끄며 별도 후보 브랜치를 사용한다.
- Docker와 관리형 호스트가 같은 조용한 서비스 실행 코드를 쓰도록 준비했다. 실제 마운트·host/port·독점 커널 잠금 검사를 거쳐 시작한다.
- 기본 월 비용 $7.25를 공식 요금 자료로 확인했다. 신규 계정 생성·결제·서비스 생성·실제 HTTPS 연결은 실행하지 않았다. 기존 노트북 설치와 Vault 데이터는 다루지 않았다.

- 수정 후 전체 Node 검사 43/43 통과(14.112초), shell/Node 구문·공식 Render JSON Schema 검증 통과. Render 양성 검사 마운트 메타데이터는 fixture이며 실제 호스트 검증과 구분했다.
