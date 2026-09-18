# Android 릴리스 서명·버전 파이프라인 (준비 단계)

상태: **NOT_WIRED → WIRED_UNVERIFIED**. 스크립트·워크플로·정적 테스트만 있다. 실제 서명 빌드·실기기 설치는 소유자 keystore 비밀이 GitHub secret으로 등록된 뒤 한 번도 실행되지 않았다. 이 문서로 "릴리스 준비 완료"를 주장하지 않는다.

## 왜 필요한가

- 2026-09-12 테스트 APK(`android-debug.yml`)는 **debug 서명**이라 원래 전달 APK 위에 업데이트할 수 없고, 매 CI 실행마다 서명이 달라질 수 있다.
- Android는 같은 `applicationId`(`kr.yeno.controller`) + 같은 서명 인증서 + 더 큰 `versionCode`일 때만 기존 설치 위에 업데이트하며, 그때만 앱의 저장 상태(vault·기기 토큰·연결 정보)가 보존된다.
- Google Play 제출은 APK가 아닌 **App Bundle(.aab)** 이 필요하다.

## 구성 요소

| 파일 | 역할 |
| --- | --- |
| `scripts/android-release.mjs` | `check`(버전 단조 증가·identifier 고정·서명 비밀 존재 여부만 확인) / `configure`(`tauri android init` 뒤 `gen/android/keystore.properties` 작성 + `app/build.gradle.kts`의 `release`를 소유자 keystore에 바인딩) / `ledger`(빌드 결과 SHA·서명 인증서 digest를 `docs/builds/android-release-ledger.json`에 추가) |
| `scripts/android-release.test.mjs` | 정적 테스트 6건 (버전 규칙, ledger 실패 폐쇄, gradle 패치 idempotent, keystore 저장소 밖 강제, debug 인증서 거부) |
| `docs/workflows/android-release.yml.template` (workflow scope 있는 owner 경로에서 `.github/workflows/android-release.yml`로 그대로 승격) | `workflow_dispatch` 전용. **정확한 commit SHA**만 입력받아 release APK + AAB를 빌드. 비밀이 없으면 `check` 단계에서 exit 2로 종료(산출물 없음). debug 서명 fallback 없음. 배포·게시 없음 |
| `docs/builds/android-release-ledger.json` | 릴리스 원장. `versionCode` 단조 증가, 서명 인증서 변경 시 추가 거부 |

## 소유자가 한 번만 할 일 (비밀은 저장소·채팅·로그에 넣지 않는다)

1. keystore 생성 (소유자 PC, 저장소 밖):
   ```bash
   keytool -genkeypair -v -keystore yeno-release.jks -alias yeno-release \
     -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=YENO Owner"
   ```
   이 파일과 비밀번호를 잃으면 이후 어떤 빌드도 기존 설치 위에 업데이트할 수 없다. 오프라인 백업 2곳.
2. GitHub 저장소 **Settings → Secrets and variables → Actions**에 다음 4개를 등록:
   - `YENO_ANDROID_KEYSTORE_BASE64` — `base64 -w0 yeno-release.jks` 출력
   - `YENO_ANDROID_KEYSTORE_PASSWORD`
   - `YENO_ANDROID_KEY_ALIAS` (`yeno-release`)
   - `YENO_ANDROID_KEY_PASSWORD`
3. 릴리스 후보 SHA가 정해지면 Actions → **Build Android release candidate** → `source_ref`에 그 SHA를 입력해 실행.

## 버전 규칙

- `apps/controller/src-tauri/tauri.conf.json`의 `version`(versionName, `MAJOR.MINOR.PATCH`)과 `bundle.android.versionCode`가 유일한 출처다.
- 릴리스마다 `versionCode`는 원장의 마지막 값보다 **반드시 커야** 하고, `versionName`은 낮아질 수 없다. 재사용·역행은 `check`가 거부한다.
- `identifier`가 바뀌면 다른 앱이 된다 — `check`가 거부한다.

## 검증 구분

- 이 leaf: `scripts/android-release.test.mjs` = **UNIT/정적**. `node scripts/android-release.mjs check`는 현재 환경에서 `SIGNING: BLOCKED: ANDROID_SIGNING_SECRET`로 종료한다(예상된 결과).
- 실제 서명 빌드 성공 + `apksigner verify --print-certs`에 debug 인증서 없음 → `SYNTHETIC_VERIFIED`(빌드 파이프라인).
- 소유자 실기기에서 기존 설치 위 업데이트 후 vault/기기 상태 보존 + 19항목 acceptance → `DEVICE_VERIFIED`. 그 전까지 Android는 `UNVERIFIED`.

## 하지 않는 것

- 기존 `android-debug.yml`을 바꾸지 않는다(테스트 APK 경로 유지).
- Play Console 업로드, production/Koyeb 배포, 자동 실행 트리거는 없다.
- 소유자의 기존 폰에 설치된 debug 서명 앱을 삭제하라고 안내하지 않는다 — 서명이 다르므로 업데이트 불가라는 사실만 기록한다.
