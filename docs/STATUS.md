# 실제 개발 상태 — 2026-09-09

## 첫 실제 APK 생성 성공

[GitHub 빌드 #2, 시도 3](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/attempts/3)이 성공했다. 사용한 앱 소스 커밋은 `11a0e1f7f1cb09449a1a2f82b54f948fff416690`이다. SDK 설치·Rust 의존성 해결·Android 프로젝트 생성·실제 컴파일·APK 수집과 업로드까지 완료했다.

- 앱: YENO controller 0.1.0, Android ARM64 디버그 시험 빌드.
- APK 크기: 202,311,295 bytes. 개발용 빌드여서 크다. ZIP 묶음은 53,464,710 bytes.
- APK SHA-256: `38de18459ef84735ef2d0c36f890cc3f4bb188d57d7b77eec6f369eb7d47ddd6`.
- [APK·해시·빌드 정보 ZIP](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/artifacts/10088424404). GitHub 보관 만료는 2026-09-16이다.
- 내려받은 ZIP의 GitHub SHA-256, APK SHA-256, APK 내부 ZIP 무결성, AndroidManifest.xml·classes.dex·ARM64 native library 존재를 확인했다.
- CI의 Cargo.lock을 회수했고 저장소의 Cargo.lock과 바이트가 일치했다.

**사용자 캡처로 Android 설치 후 첫 연결 화면 표시를 확인했다.** 기기 등록·암호 보관·명령·재접속은 아직 실기기에서 확인하지 않았다. 상주 HTTPS 코어·실제 유료 모델 호출·Windows EXE도 미검증 또는 미구현이다. 첫 화면 표시를 개인 OS 1.0 완성으로 해석하지 않는다.

## 실제 검사 결과

| 대상 | 결과 |
| --- | --- |
| 성공한 Android CI의 코어·명령 검사 | 30개 통과, 실패 0 |
| 성공한 Android CI의 화면 빌드 | TypeScript + Vite 통과 |
| 성공한 Android CI의 네이티브 빌드 | ARM64 APK 1개 생성·업로드 |
| 서버 복구 수정 이후 로컬 Node 24.19.0 | 39개 통과, 실패·건너뜀 0; 약 15.06초 |
| 추가된 컨테이너 잠금 검사 | 위 39개 중 9개. 실제 Linux 프로세스 SIGKILL·재시작, 인증·기억·결과 보존, 중복 실행과 부정확한 잠금 거절 |
| Docker·실제 컨테이너·UID 1000 | 이 환경에서 실행 불가. Docker 이미지 빌드와 실제 컨테이너 권한·재시작 시험은 남음 |
| Astra 검토 | 실제 배포 crate와 Tauri release lock으로 호환 버전을 확인. 네이티브 실행과 별개로 검토 기록을 구분함 |

서버 복구 수정은 위 APK를 만든 커밋 이후의 코어 변경이다. Android 앱 소스·API 계약을 바꾸지 않았다. 39개 로컬 검사 결과를 APK의 CI 검사 수로 합쳐 표시하지 않는다. 모델 어댑터 검사는 로컬 시험 공급자를 사용했다.

## 폰 첫 화면 이후 상주 서버 준비 검증

- 사용자 Android 캡처: 설치 후 `본체 연결` 화면 표시 확인. 아직 실제 URL과 연결 키가 없어 등록 전이다.
- 관리형 시작 경로 수정 후 전체 `npm test`: **43/43 통과**, 실패·건너뜀 0, 약 14.112초.
- 그중 기존 커널 잠금 9개 + 새 Render 시작 검사 4개를 포함한다. 공유 실행 코드로 실제 Linux 프로세스·flock·HTTP 인증/호스트 거절·명령 접수·SIGKILL/재시작과 요청 기록 보존을 검사했다.
- Render 양성 통합 검사에서 **마운트 정보만 시험 fixture를 사용**했다. 실제 Render 디스크를 생성하거나 검증했다는 뜻이 아니다. 실제 로컬 임시 디렉터리와 tmpfs, 누락된 디스크는 시작을 거절했다.
- `sh -n scripts/start-render.sh`, 공유 service/config의 Node 구문 검사 통과.
- 공식 `https://render.com/schema/render.yaml.json`의 JSON Schema 2020-12로 `render.yaml` 검증 통과. Schema SHA-256: `f6cb3fbae8c598d41385069bf7084293b48b802f88e1bc98b1c4b9c24a15be47`. Render 계정 API/서버 측 배포 검증은 아직 실행하지 않았다.
- 실제 Render `flock` 설치·procfs·파일시스템 종류·UID/권한·HTTPS·재시작은 계정 연결과 비용 확인 이후의 남은 검증이다.

## 수정한 실제 실패

1. 최초 실행은 `sdkmanager: command not found`로 실패했다. SDK 도구를 명시적으로 설치하고 PATH를 설정하도록 수정했다.
2. 다음 실행은 HTTP 플러그인이 요구하는 Tauri 최소 버전과 충돌했다. 실제 배포된 요구 조건에 맞춰 Tauri 2.8.2로 변경했다.
3. 다음 컴파일은 서로 다른 시기의 Tauri runtime/wry 내부 조합 때문에 실패했다. Tauri 2.8.2 release lock의 호환 구성으로 내부 패키지를 고정하고 전체 Cargo.lock을 생성해 재검증했다.
4. 네이티브 코드 생성에 필요한 PNG 아이콘 누락도 찾아 SVG 원본과 Tauri CLI로 생성했다.

현재 workflow는 Cargo.lock을 다시 생성한다. 이번 실행의 lock은 기록한 파일과 일치했지만 앞으로 전체 그래프가 절대 변하지 않는다고 보장하지 않는다. 정식 릴리스 전 workflow를 `--locked` 검증으로 전환하고 정식 서명·업데이트 경로를 검증해야 한다.

## 현재 기능과 상주 코어 후보

- 코어 0.2.0 후보: 버전별 API, 기기 등록·인증·폐기, 기억 저장·검색, 실제 문서·진단 결과, 중단·재개·취소·전체 정지.
- 앱: HTTPS 코어 주소, 암호로 잠긴 Stronghold, 지속 요청 ID, 거절/통신 불확실성 구분, 기억 검색·결과 표시, 재접속 처리.
- 등록 토큰 원문을 응답 캐시에 남기지 않는 저장 방식과 기존 데이터 보존형 정리.
- `Dockerfile`, `compose.yaml`, `.dockerignore`, `PERSISTENT_CORE.md`: 영속 볼륨, 토큰을 출력하지 않는 시작 경로, 단일 쓰기, 정상 종료와 검증된 커널 잠금 기반 crash 재시작 후보.
- 컨테이너 모드는 상속된 실제 독점 flock을 확인해야 시작한다. 일반 실행은 해당 데이터 디렉터리를 거절한다. 과거 runtime.lock이 남으면 삭제하거나 무시하지 않고 시작을 거절한다.

단일 프로세스 JSON 저장소는 유지한다. 분산 운영·SQLite 마이그레이션·일반 자연어 도구 루프·자동 개선 배포는 완료되지 않았다. 앱의 대기 명령·마지막 응답은 localStorage에 저장되며 Stronghold 암호화 대상은 아니다.

## 다음 연결

노트북이 꺼져 있어도 일을 처리할 **소유자 관리 상주 서버 계정과 HTTPS 주소**가 필요하다. `render.yaml`과 `RENDER_SETUP.md`에 별도 `yeno-core-pilot` 후보 브랜치를 쓰는 Render native Node + 1 GB 디스크 구성을 준비했다. 기본 월 비용 $7.25이며 세금·포함량 초과 사용·AI 요금 별도다. 생성·결제·배포는 하지 않았다. 기존 Docker 경로는 `PERSISTENT_CORE.md`에 유지한다. 실제 호스트의 디스크·권한·잠금·복구·HTTPS를 확인한 뒤 앱의 등록 → 명령 → 결과 → 종료·재접속 시험을 수행한다.

원래 수입한 0.1.1과 노트북의 별도 0.2.3 설치를 구분하며, 기존 노트북 데이터를 읽거나 덮어쓰거나 마이그레이션하지 않았다.
