# 실제 개발 상태 — 2026-09-09

## 현재 결과

현재는 **코어 0.2.0 후보와 Android controller 소스, 수동 APK 빌드 설정** 단계다. APK·EXE 생성, 폰 설치, 상주 HTTPS 코어 연결은 아직 완료하지 않았다. 개발 브랜치는 `codex`, 검토 대상은 PR #1이다.

- 기존 `/api`를 유지하면서 `/api/v1`, 기기 등록·인증·자기 기기 폐기를 구현했다. 기존 상태는 작업·기억·결과·요청 기록을 보존하면서 `devices` 저장소를 추가한다.
- 네이티브 HTTP 권한에 HTTPS 코어의 `/api/v1/` 경로와 개발용 loopback HTTP 범위를 추가했다. 요청은 리디렉션을 따르지 않으며 연결·응답 시간 제한이 있다.
- Stronghold는 지속 salt 파일과 Argon2 비밀번호 파생을 사용하도록 수정했다. 실제 네이티브 보관소 생성·재해제는 Android에서 확인해야 한다.
- 명령의 확정된 4xx 거절 후에는 새 명령을 보낼 수 있다. 네트워크·시간 초과·408·5xx 결과는 기존 요청 ID와 본문을 유지해 재접속 시 안전하게 재시도한다.
- 기억 저장·검색 결과와 마지막 명령 응답을 표시하고, 중복 클릭·다른 코어의 대기 명령 혼용을 방지한다. 결과 파일은 클립보드 지원 여부와 관계없이 화면에 표시한다.
- 기기 등록 토큰 원문이 요청 응답 캐시에 남던 문제를 수정했다. 새 토큰은 페어링 비밀과 무작위 기기 ID에서 HMAC으로 파생하고 저장소에는 해시와 공개 등록 정보만 남긴다. 재시작 후 등록 재시도는 동일 토큰을 돌려주며, 폐기·비밀 회전으로 복구할 수 없는 등록은 거절한다.
- 기존 캐시의 원문 토큰은 로딩과 상태·백업 재저장 시 제거한다. 기존 랜덤 토큰 인증과 소유자 데이터는 보존한다. 외부에 보관된 과거 사본 삭제를 뜻하지 않는다.

## 이번 환경에서 실제 실행한 검사

| 검사 | 실제 결과 |
| --- | --- |
| Node | v24.19.0 |
| 앱 의존성 설치 | 성공, `package-lock.json` 생성 |
| `npm --offline test` | 30개 통과, 실패 0, 건너뜀 0; 약 16.38초 |
| `npm run build:controller` | TypeScript 검사와 Vite 빌드 성공 |
| 네이티브 환경 확인 | 이 환경에는 Rust/Cargo와 Android SDK/NDK·adb·sdkmanager가 없어 APK 컴파일 미실행 |
| Astra 검토 | 프런트엔드·네이티브 설정·수동 빌드 경로 검토에서 추가 P1/P2 차단 문제 없음; 네이티브 실행 증거는 아님 |

30개 검사는 코어/기존 웹 요청 22개, 네이티브 앱 명령 처리 6개, HTTP URL 범위 2개다. URL 범위 검사는 Node의 URLPattern으로 설정 패턴을 확인한 것이며 Rust 플러그인의 실제 네트워크 요청 검증은 아니다. AI 어댑터 검사는 로컬 테스트 공급자를 사용한다. 실제 유료 모델 호출은 검증하지 않았다.

최초 Codex Cloud 작업에서는 Node 20.20.2에서 코어 검사 20개 통과, npm HTTP 403으로 앱 빌드 불가가 보고됐다. 위 표는 별도의 이번 Node 24 환경에서 재현한 최신 결과다.

## 빌드 설정과 남은 검증

`.github/workflows/android-debug.yml`은 수동 실행 전용이며, 기본 `source_ref=codex`를 체크아웃해 검사 → 화면 빌드 → Android ARM64 디버그 빌드를 수행한다. 컴파일 성공 시에만 APK·SHA-256·소스 커밋 정보를 7일간 보관한다. 동시 실행은 1개, 제한 시간은 45분이다. 수동 버튼을 제공하려면 동일 workflow 파일을 기본 브랜치 `main`에 등록해야 한다. 이는 PR 합병이나 APK 생성 결과가 아니다.

JS 의존성 lock은 포함했다. Rust 직접 의존성 버전은 고정했지만 전체 `Cargo.lock`은 첫 CI에서 생성·수집할 예정이므로 완전히 고정된 재현 빌드라고 부르지 않는다. 정식 서명과 업데이트 설치 경로도 아직 없다.

명령·마지막 응답 본문은 앱 localStorage에 저장되며 Stronghold 암호화 대상이 아니다. 기기 인증 정보는 Stronghold에 저장한다. 단일 프로세스 JSON 코어의 동시 운영 한계도 유지한다.

## 다음 한 작업

최초 [GitHub 실행 #1](https://github.com/wooyeonho/yeno-os/actions/runs/34308639802)은 소스 `b34dc9fc843c6ef6fd571f80057dfdf4c7eb1f7f`를 체크아웃했고, 30개 검사(약 14.82초)·npm 설치·TypeScript/Vite 빌드를 통과했다. Android 준비 단계의 `sdkmanager: command not found`(exit 127)로 종료돼 APK·Cargo lock 결과물은 0개다.

Android SDK 준비 action을 검증된 커밋으로 추가하고, SDK manager 경로·버전과 NDK 설치 경로 확인을 넣었다. 수정한 설정은 YAML 구문·단계 순서·셸 구문을 확인했으며, 새로운 GitHub 실행에서 실제 설치와 컴파일을 검증해야 한다.

[Android 수동 빌드](https://github.com/wooyeonho/yeno-os/actions/workflows/android-debug.yml)에서 **새 Run workflow**를 시작하고 실제 로그와 APK 결과를 확인한다. 기존 실패 실행의 Re-run은 수정 전 workflow를 사용한다. 절차는 `ANDROID_BUILD.md`를 따른다. 그다음 상주 HTTPS 코어 연결과 `DEVICE_ACCEPTANCE.md`의 폰 명령·결과·재접속 시험을 수행한다.

## 버전 구분

원래 수입한 0.1.1은 과거 기준선이다. 현재 저장소 코어는 0.2.0 후보이며, 노트북의 별도 0.2.3 설치를 읽거나 덮어쓰거나 마이그레이션하지 않았다.
