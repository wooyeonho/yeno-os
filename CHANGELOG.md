# 변경 기록

## 2026-09-13 — Black Hole 일곱 욕망 MVP 편입

- 별도로 검증된 무의존성 Node.js MVP(`blackhole/`)를 편입했다. 일곱 욕망 퀘스트 제안, 승인·실행·증거·독립 평가·스킬 추출·제한 활성화, wealth/honor/fame 장부, 상태 저장·이벤트 로그·재시작 복구, 휴대폰 브라우저용 최소 제어 화면을 포함한다.
- `docs/BLACK_HOLE_SEVEN_DRIVES_STRATEGY.md`에 레벨업 성장 엔진을 포함한 전략 설계 문서를 추가했다.
- 루트 `package.json`에 `test:blackhole` 스크립트를 추가했다. 기존 `test`/`start`(runtime 코어)는 바꾸지 않았다.
- `blackhole/`의 자체 테스트 7개가 통과함을 확인했다. 실제 API 키·결제·게시는 연결하지 않았다.
- `runtime/`의 YENO 코어, `codex` 브랜치, 별도로 진행 중인 developer-worker 작업(PR #2)은 이번 변경에서 건드리지 않았다.

## 2026-09-08 — 비공개 GitHub 저장소 초기 등록

- `wooyeonho/yeno-os`의 기존 README 제목을 보존하고 실행·개발 안내를 추가했다.
- 준비된 실행 코어 0.1.1, 개발 지침, YENO 행동 기준과 수동 검증 워크플로를 수입했다.
- 이미 생성된 저장소에 맞춰 폰 안내와 첫 Codex 작업을 수정했다.
- Node 24 개발 기준을 명시했다.
- 실제 확인 상태와 남은 연결·빌드 작업은 `docs/STATUS.md`에 기록한다.

본 기록은 소스 등록에 관한 것이다. 운영 서버 배포, APK/EXE 생성, 실기기 확인을 뜻하지 않는다.
