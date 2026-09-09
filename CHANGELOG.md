# 0.2.2 호환성 수정 — Android 최초 연결 Origin 오류

- 사용자 실기기 캡처의 `Origin does not match Host`를 실제 HTTPS에서 같은 native Origin으로 재현했다. 기존 API 검사에서 Origin 헤더를 빠뜨려 APK 통신과의 차이를 놓친 회귀다.
- 잠긴 HTTP 플러그인이 보내는 정확한 `http://tauri.localhost`를 `/api/v1/`에 한해 허용한다. Host 검사, 기기 등록 키와 기기 bearer 인증, 기존 웹 출처 제한을 유지한다. wildcard CORS·모든 localhost 허용·키 교체는 하지 않는다.
- 실제 APK의 Origin을 포함한 등록·문서 생성·결과·재시작·폐기와 거부 경계를 회귀 검사에 추가한다. 기존 APK 재빌드는 필요하지 않으며 폰의 연결 완료는 소유자 확인 전까지 미검증이다.
- 정확한 실행 검사·배포 증거는 `docs/ANDROID_ORIGIN_FIX.md`에 기록한다.

# 0.2.2 — 출처를 보존하는 개선 자료 접수

- 전체 63/63 검사 통과. 실제 Koyeb 빌드·76개 자료 등록·결과 생성·재시작 보존과 20개 프로젝트의 업그레이드 보존 검사 완료. 상세 증거는 `docs/LIVE_ACCEPTANCE.md`.
- 저장 실패 뒤 미저장 영수증/조회 결과를 성공으로 반환하지 않도록 재저장 게이트 추가.

- 자료 등록·검토·프로젝트 연결과 원자적 JSON 가져오기. 내용 확인 상태와 채택 판단 분리.
- 미확인 자료의 개선 후보 승격 제한, URL 중복·버전 충돌·요청 재전송 보존.
- 기존 APK 명령으로 자료 목록·브리핑·개선 후보 준비서 생성. 웹 자료 화면 추가.
- 실행 검사·배포 상태는 `docs/STATUS.md`와 `docs/LIVE_ACCEPTANCE.md`에서 구분한다.

# 변경 기록

## 2026-09-09 — 프로젝트 관리 0.2.1 구현·검사와 Supabase 비용 축소

- 프로젝트 등록·수정·버전 충돌 처리와 프로젝트별 실제 문서 결과를 추가했다. 기존 API 1 및 Android 명령 응답을 유지한다.
- 웹 프로젝트 화면, 기기 재인증 뒤에도 보존되는 요청 ID, 보류/보관과 외부 서버 상태의 구분을 구현했다. 개발 작업자는 미연결로 표시한다.
- 긴 목록, 잘못된 저장 레코드, 유니코드 이름 정규화와 응답 유실 경계 오류를 수정했다. Node 24.19.0 전체 검사 55/55 통과, 실패·취소·건너뜀 0, 14.507초. 화면·서버·프로젝트 모듈 구문 검사도 통과했다.
- hankki-anbu를 기존 Free 조직으로 이전했다. 같은 프로젝트 ID·ACTIVE_HEALTHY·테이블/뷰/함수 개수와 함수 정의 해시를 확인했다. DB 삭제·일시정지는 하지 않았다. Vercel Pro는 유지했다.
- 이 커밋 시점에는 새 프로젝트 기능의 Koyeb 배포·실제 등록·서버 재시작 시험이 남아 있다. 이후 실제 결과는 LIVE_ACCEPTANCE에 추가한다. 기존 APK를 다시 빌드하거나 Android 실기기 시험을 한 것은 아니다.

## 2026-09-09 — YENO 실제 상주 배포·재시작 검증과 Gyeol 일시정지

- 승인된 Micro 서버와 1 GB 전용 볼륨, 암호화 Secret 참조로 YENO를 실제 Koyeb에 배포했다. Docker 이미지 빌드와 HTTPS 코어 기동 성공.
- 실제 기기 등록·문서 생성·결과 해시·동일 요청 중복 방지, 이전 이미지로 재시작 후 동일 인증/작업/결과 보존을 확인했다. 시험 기기만 폐기하고 401을 확인했다.
- 기존 Gyeol 실행기는 소유자 승인으로 Pause, 실행 0개를 확인했다. 기존 DB·서비스·환경값은 삭제하지 않았다.
- Supabase 실제 청구 주기 누적 $30.97/예상 $49.46, Vercel 예정 $20을 확인했다. 두 서비스 구독·데이터 변경은 없다.
- 소유자 개인 연결 안내를 별도로 전달하며 비밀값을 소스에 넣지 않았다. Android 실기기 연결과 실제 AI 호출은 여전히 남은 검증이다.
- 이번 단계는 운영 배포/실검사와 문서 변경이며 기존 로컬 46/46 검사를 새 실행으로 재표시하지 않는다. 자세한 증거는 `docs/LIVE_ACCEPTANCE.md`.

## 2026-09-09 — 기존 Supabase·Vercel 재사용과 비용 감사

- 소유자의 요청에 따라 새 Koyeb 생성을 보류하고 기존 구독을 먼저 확인했다. Supabase Pro 프로젝트 3개의 크기·건수·활동 메타데이터와 Vercel Pro 실제 청구 화면을 읽었다.
- Vercel 연결 도구의 빈 목록과 실제 프로젝트 목록의 불일치, 같은 저장소를 쓰는 배포 후보, Supabase의 주기적인 tick과 실제 작업 활동 차이를 구분해 기록했다.
- 기존 Koyeb Gyeol이 담당하는 자동 작업과 Supabase/Vercel 의존성을 실행 중 커밋 기준으로 확인했다. 최신 main을 현재 운영 버전으로 오인하지 않았다.
- `docs/HOSTING_REUSE_AUDIT.md`에 재사용·휴면 검토·요금제 조건·복원 순서를 기록했다. Supabase Pro 프로젝트는 직접 Pause할 수 없다는 공식 조건을 반영했다.
- 서비스 중지·삭제, 구독 취소·변경, DB 이전, cron 변경, 새 리소스 생성은 실행하지 않았다. 이번 문서 변경에 새 코드 검사는 추가하지 않았으며 기존 46개 통과 기록과 구분한다.

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
