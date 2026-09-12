# Android APK 빌드와 연결

## 2026-09-12 운영실 APK

[빌드34702041819](https://github.com/wooyeonho/yeno-os/actions/runs/34702041819) 성공. 앱0.2.0·versionCode2000·ARM64, 실제 APK59.5MB. [기능과 검증](NATIVE_STUDIO_20260912.md), [파일/서명 증거](NATIVE_UI_VERIFICATION_20260912.json)를 따른다. **원래 전달 APK와 서명이 달라 기존 설치 위 업데이트가 불가능하며, 기존 앱을 삭제하지 않는다.** 기존 폰은 웹 운영실을 사용하고 서명/연결 정보를 보존한 전환을 별도로 확인해야 한다. 새 APK의 물리 Android 설치·재생·저장 검사는 미완료다.

## 현재 결과 구분

**첫 실제 APK 빌드가 성공했다.** 커밋·파일 크기·SHA-256·실제 검사와 다운로드는 `STATUS.md`를 따른다. 폰 실사용 확인은 별도 단계다.

앱 소스와 화면 빌드가 준비돼도 APK 생성·설치·실사용을 완료한 것은 아니다. 실제 결과는 `STATUS.md`에 기록한다. 이 앱은 코어의 `/api/v1`을 사용하며, 원격 HTTPS 주소와 기기 인증으로 연결한다.

## 자동 빌드와 수동 실행

워크플로: `.github/workflows/android-debug.yml` (Build Android test APK).

2026-09-10 소유자가 반복 실행 요청 없이 진행하도록 승인했다. `codex`에 앱 코드 또는 해당 빌드 입력 변경이 저장되면 자동 실행한다. 문서만 바꾸거나 코어만 수정하면 APK를 다시 만들지 않는다. 자동 실행은 트리거 커밋 SHA를 고정해 체크아웃하며 수동 실행의 `source_ref`와 구분한다. GitHub 실행 요약에 실제 업로드된 APK 링크·커밋·파일 해시를 표시한다. 자동 실행/빌드의 실제 성공 여부는 STATUS.md를 따른다.

1. GitHub 저장소의 **Actions**를 연다.
2. **Build Android test APK → Run workflow**를 선택한다.
3. 실행 워크플로 브랜치와 **Source branch or commit to build**는 모두 `codex`로 둔다. 수동 실행은 특정 소스 재빌드가 필요할 때만 사용한다.
4. **Run workflow**를 누른다.
5. 성공한 실행에서 `yeno-android-debug-<실제 소스 커밋>` 결과물을 내려받는다. ZIP 안에 APK, `SHA256SUMS.txt`, `build-info.json`이 있어야 한다.

수동 실행 버튼이 표시되려면 워크플로 파일이 기본 브랜치에도 있어야 한다. 저장소의 초기 main에 워크플로만 등록하고 실제 빌드 소스는 위 입력으로 선택하는 구조다. 버튼이 없으면 코드 병합을 서두르지 말고 기본 브랜치의 워크플로 등록 상태를 확인한다.

이 워크플로는 앱 관련 변경의 자동 실행과 수동 실행을 지원한다. 동시 빌드는 하나이며 최대 45분이다. 실행 결과는 비공개 저장소의 artifact로 7일 보관된다. GitHub Actions의 포함 사용량과 결제 설정을 따르므로 항상 무료라고 간주하지 않는다. 새 운영 서버나 모델 계정, API 키를 만들지 않는다.

## 빌드 입력

- GitHub 실행 환경: Ubuntu 24.04.
- Node 24, Temurin JDK 17.
- `android-actions/setup-android` v4의 확인한 커밋을 고정해 Android 명령줄 도구 16.0 (`12266719`)을 준비하고 `sdkmanager`를 PATH에 등록한다. 실행 이미지에 이미 설치되어 있다고 가정하지 않는다.
- Android platform 35, build-tools 35.0.0, NDK 28.2.13676358, `aarch64-linux-android` Rust 대상.
- JavaScript 직접 의존성과 npm lock 파일을 저장소에 고정한다.
- Tauri 직접·내부 패키지를 호환되는 release 조합으로 고정했고 `Cargo.lock`을 등록했다. 성공한 CI가 생성한 lock과 등록 파일이 바이트 단위로 일치했다. 현재 workflow가 lock을 재생성하므로 정식 릴리스 전 `--locked` 사용으로 전환해야 한다.
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

## 첫 실행에서 확인한 문제

[실행 #1](https://github.com/wooyeonho/yeno-os/actions/runs/34308639802)은 검사 30개·의존성 설치·화면 빌드는 통과했지만 `sdkmanager: command not found`로 Android 준비 단계에서 종료됐다. APK와 Cargo lock 결과물은 생성되지 않았다. 위의 명시적 SDK 준비 단계는 이 실패를 수정하기 위해 추가했다.

workflow 파일을 수정한 뒤에는 목록 화면에서 **Run workflow / 워크플로 실행**으로 새 실행을 시작한다. 기존 실행의 Re-run은 기존 workflow 커밋을 사용하므로 이 설정 변경을 검증하는 방법으로 사용하지 않는다. 수동 실행에서는 브랜치와 `source_ref`를 `codex`로 선택한다.

앱 소스만 수정했고 workflow 변경이 없다면 기존 실행을 재시도할 수 있다. 이 workflow는 `source_ref=codex` 브랜치를 명시적으로 체크아웃하므로 재시도 시점의 소스 커밋을 사용한다. 실제 적용 여부는 Record source revision 로그와 결과물의 build-info.json으로 확인한다.

SDK 준비 구현 근거: [setup-android 고정 버전](https://github.com/android-actions/setup-android/tree/40fd30fb8d7440372e1316f5d1809ec01dcd3699).

## 연결과 저장

코어는 단일 프로세스와 영속 `YENO_DATA_DIR`을 사용한다. HTTPS 역방향 프록시 주소를 `YENO_ALLOWED_HOSTS`에 포함한다. 현재 상주 코어 주소와 실제 배포 기록은 `STATUS.md`를 따른다.

앱은 사용자가 지정한 HTTPS 호스트의 `/api/v1/*` 경로에 접속할 수 있고 로컬 개발 HTTP는 localhost/127.0.0.1로 제한한다. HTTP 리디렉션을 따르지 않는다. 연결 키와 모델·서명 비밀은 소스나 APK에 넣지 않는다.

기기 인증은 Argon2로 파생한 키를 사용하는 Stronghold에 보관한다. salt와 보관소 파일은 한 설치의 데이터로 함께 유지해야 한다. 초기 미출시 후보가 사용하던 잘못된 원시 비밀번호 방식의 테스트 보관소와 자동 호환된다고 보지 않는다.

접수 대기 명령과 마지막 결과는 origin/기기별 localStorage에 저장하며, Stronghold 암호화 범위가 아니다. 민감한 실제 기록을 넣기 전 명령·결과 저장 방식도 운영 기준으로 검토한다.

디버그 APK는 시험용 서명으로 만들어진다. 서로 다른 실행에서 서명 키가 달라지면 기존 앱 위에 업데이트 설치가 안 될 수 있다. 기존 앱 데이터가 있으면 삭제부터 권하지 말고 보존·이전 방법을 먼저 확인한다. 정식 배포에는 연호님 소유의 지속 서명 키와 업데이트 절차가 필요하다.

## 실기기 완료 기준

기기 등록 → 문서 명령 → 결과 열기 → 앱 강제 종료·재실행 → 같은 작업/결과 → 중단·재개 → 기기 폐기와 재접속 차단.

추가로 잘못된 명령이 거절된 뒤 수정한 명령이 접수되는지, 네트워크 끊김 후 같은 요청 재시도가 작업을 복제하지 않는지 확인한다. `DEVICE_ACCEPTANCE.md`에 기기·Android 버전·APK SHA-256·작업 ID와 실제 관찰을 기록한다.

공식 근거: [Tauri CLI](https://v2.tauri.app/reference/cli/), [Stronghold](https://v2.tauri.app/plugin/stronghold/), [HTTP 권한](https://v2.tauri.app/plugin/http-client/), [GitHub 수동 실행](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), [GitHub Ubuntu 이미지](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md).

자동 트리거 근거: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). 앱 설치·실기기 확인·운영 코어 업데이트는 자동 APK 생성과 별도다. 무인 AI 개발이나 예약 폴링을 새로 연결한 것이 아니다.
