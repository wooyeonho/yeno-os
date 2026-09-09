# 변경 기록

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
