# YENO OS — 다음은 첫 APK 빌드

비공개 GitHub 저장소와 Codex 첫 구현, PR1 생성까지 진행했다. 현재 검토 중인 소스 브랜치는 `codex`이며, 이 문서는 그 후보의 다음 단계다.

## 지금 할 일

1. [YENO Actions](https://github.com/wooyeonho/yeno-os/actions/workflows/android-debug.yml)를 연다.
2. **Run workflow**를 누른다.
3. 브랜치는 `main`, **Source branch or commit to build**는 `codex`로 두고 실행한다.
4. 실행 페이지 주소를 개발 대화에 보낸다. 실제 로그·실패 원인·생성된 APK를 이어서 확인할 수 있다.

저장소 기본 브랜치에 수동 워크플로가 등록된 뒤 이 버튼이 나타난다. 작업을 실행하기만 하면 성공한 것으로 보지 않으며, 초록색 완료와 APK 파일 생성까지 확인한다. 실행 전에 main에 PR 전체를 병합할 필요는 없다.

성공하면 실행 결과의 Artifacts에서 APK 묶음을 받을 수 있다. 코어의 상주 HTTPS 주소 연결과 폰 설치 시험은 그다음이다. 아직 설치할 APK나 코어 주소가 생겼다고 가정하지 않는다.

## 추가 개발

Codex 작업은 `codex` 브랜치의 최신 커밋에서 이어간다. 이미 있는 구현을 새로 만들거나 0.1.1 원본 해시에 맞추려고 되돌리지 않는다. `AGENTS.md`, `docs/STATUS.md`, `docs/ANDROID_BUILD.md`를 먼저 읽는다.

워크플로는 최대 45분인 수동 시험 빌드다. GitHub Actions 사용량에 포함되며, 자동 반복·운영 서버 배포·유료 모델 호출을 켜는 설정이 아니다.
