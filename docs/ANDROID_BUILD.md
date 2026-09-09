# Android APK 빌드와 연결

## 현재 결과 구분

앱 소스와 화면 빌드가 준비돼도 APK 생성·설치·실사용을 완료한 것은 아니다. 실제 결과는 `STATUS.md`에 기록한다. 이 앱은 코어의 `/api/v1`을 사용하며, 원격 HTTPS 주소와 기기 인증으로 연결한다.

## 폰에서 수동 테스트 APK 빌드

워크플로: `.github/workflows/android-debug.yml` (Build Android test APK).

1. GitHub 저장소의 **Actions**를 연다.
2. **Build Android test APK → Run workflow**를 선택한다.
3. 실행 워크플로 브랜치는 `main`, **Source branch or commit to build**는 `codex`로 둔다. 이렇게 하면 검토 중인 PR1 코드를 빌드하며 main의 앱 코드를 병합한 것으로 보지 않는다.
4. **Run workflow**를 누른다.
5. 성공한 실행에서 `yeno-android-debug-<실제 소스 커밋>` 결과물을 내려받는다. ZIP 안에 APK, `SHA256SUMS.txt`, `build-info.json`이 있어야 한다.

수동 실행 버튼이 표시되려면 워크플로 파일이 기본 브랜치에도 있어야 한다. 저장소의 초기 main에 워크플로만 등록하고 실제 빌드 소스는 위 입력으로 선택하는 구조다. 버튼이 없으면 코드 병합을 서두르지 말고 기본 브랜치의 워크플로 등록 상태를 확인한다.

이 워크플로는 수동으로만 실행되고, 동시 빌드는 하나이며 최대 45분이다. 실행 결과는 비공개 저장소의 artifact로 7일 보관된다. GitHub Actions의 포함 사용량과 결제 설정을 따르므로 항상 무료라고 간주하지 않는다. 새 운영 서버나 모델 계정, API 키를 만들지 않는다.

## 빌드 입력

- GitHub 실행 환경: Ubuntu 24.04.
- Node 24, Temurin JDK 17.
- Android platform 35, build-tools 35.0.0, NDK 28.2.13676358, `aarch64-linux-android` Rust 대상.
- JavaScript 직접 의존성과 npm lock 파일을 저장소에 고정한다.
- Rust 직접 의존성을 JS와 호환되는 버전으로 고정한다. `Cargo.lock`은 최초 Rust 의존성 해결 때 생성해 별도 결과물로 회수한다. 그 lock을 검토·등록하기 전까지 전체 Rust 의존성이 고정된 재현 빌드라고 표현하지 않는다.
- Rust stable은 첫 실행에서 실제 버전을 출력하며, 성공한 빌드의 Rust 버전과 lock을 이후 기준으로 삼는다.

```bash
cd apps/controller
npm ci --ignore-scripts --no-audit --no-fund
npm run build
rustup target add aarch64-linux-android
cargo generate-lockfile --manifest-path src-tauri/Cargo.toml
npm run tauri -- android init --ci --skip-targets-install
npm run tauri -- android build --debug --apk --target aarch64 --ci
```

`ANDROID_HOME`과 `NDK_HOME`이 실제 설치 경로를 가리켜야 한다. APK가 없으면 수집 단계에서 실패한다. 워크플로 작성이나 화면 빌드만으로 APK 생성 성공을 표시하지 않는다.

## 연결과 저장

코어는 단일 프로세스와 영속 `YENO_DATA_DIR`을 사용한다. HTTPS 역방향 프록시 주소를 `YENO_ALLOWED_HOSTS`에 포함한다. 실제 상주 주소와 배포는 아직 별도 연결 단계다.

앱은 사용자가 지정한 HTTPS 호스트의 `/api/v1/*` 경로에 접속할 수 있고 로컬 개발 HTTP는 localhost/127.0.0.1로 제한한다. HTTP 리디렉션을 따르지 않는다. 연결 키와 모델·서명 비밀은 소스나 APK에 넣지 않는다.

기기 인증은 Argon2로 파생한 키를 사용하는 Stronghold에 보관한다. salt와 보관소 파일은 한 설치의 데이터로 함께 유지해야 한다. 초기 미출시 후보가 사용하던 잘못된 원시 비밀번호 방식의 테스트 보관소와 자동 호환된다고 보지 않는다.

접수 대기 명령과 마지막 결과는 origin/기기별 localStorage에 저장하며, Stronghold 암호화 범위가 아니다. 민감한 실제 기록을 넣기 전 명령·결과 저장 방식도 운영 기준으로 검토한다.

디버그 APK는 시험용 서명으로 만들어진다. 서로 다른 실행에서 서명 키가 달라지면 기존 앱 위에 업데이트 설치가 안 될 수 있다. 기존 앱 데이터가 있으면 삭제부터 권하지 말고 보존·이전 방법을 먼저 확인한다. 정식 배포에는 연호님 소유의 지속 서명 키와 업데이트 절차가 필요하다.

## 실기기 완료 기준

기기 등록 → 문서 명령 → 결과 열기 → 앱 강제 종료·재실행 → 같은 작업/결과 → 중단·재개 → 기기 폐기와 재접속 차단.

추가로 잘못된 명령이 거절된 뒤 수정한 명령이 접수되는지, 네트워크 끊김 후 같은 요청 재시도가 작업을 복제하지 않는지 확인한다. `DEVICE_ACCEPTANCE.md`에 기기·Android 버전·APK SHA-256·작업 ID와 실제 관찰을 기록한다.

공식 근거: [Tauri CLI](https://v2.tauri.app/reference/cli/), [Stronghold](https://v2.tauri.app/plugin/stronghold/), [HTTP 권한](https://v2.tauri.app/plugin/http-client/), [GitHub 수동 실행](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [GitHub Ubuntu 이미지](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).
