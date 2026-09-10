# 폰에서 연결할 상주 코어 후보 — Render

2026-09-09. Android 설치 후 `본체 연결` 화면이 표시된 사용자 캡처를 확인했다. **실제 상주 서버는 아직 생성하지 않았다.** `https://yeno.example.com`은 앱의 예시 주소다. 현재 입력할 실제 코어 주소나 등록 키가 발급된 상태는 아니다.

## 준비한 구성과 비용

| 항목 | 준비한 값 |
| --- | --- |
| 소스 | 비공개 `wooyeonho/yeno-os`의 별도 `yeno-core-pilot` 브랜치. 최초 생성할 검증 후보를 보관하며 `codex` 개발과 분리한다. |
| 실행 | Render native Node 24.19.0, Singapore, web service 1개 |
| 서버 크기 | `0.5c-512mb` — 기존 이름 Starter, 0.5 CPU / 512 MB |
| 영구 디스크 | 1 GB, `/var/data` 마운트, 실제 상태는 `/var/data/yeno` |
| 기본 월 비용 | 서버 $7 + 디스크 $0.25 = **$7.25/월**. 무료 Hobby workspace 기준; 세금·환율·포함량 초과 트래픽/빌드·AI 사용료 별도. 전체 청구액 상한을 뜻하지 않는다. |
| 업데이트 | 서비스 자동 배포와 preview 생성을 끈다. Blueprint Auto Sync도 끄고, 후보 교체는 검토한 커밋으로 수동 진행한다. |
| 주소 | Render가 실제 발급하는 HTTPS `onrender.com` 주소. 별도 도메인 구매 불필요. |
| 연결 키 | Blueprint가 처음 생성하는 `YENO_TOKEN`. 256-bit 난수이며 소스·앱·시작 로그에 넣지 않는다. |
| AI | 공급자 환경값은 비어 있다. 이번 배포로 유료 모델이 연결되거나 자동 호출되지 않는다. |

위 값은 생성할 **후보**다. 새 서버 비용과 계정 접근은 소유자 확인이 필요하다. 공식 [요금표](https://render.com/pricing), [디스크 비용 안내](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses), [compute plan 이름](https://render.com/docs/compute-plans)을 2026-09-09에 확인했다. 생성 화면의 실제 요금이 다르면 그 화면을 기준으로 다시 확인한다.

512 MB는 현재 가벼운 코어의 첫 연결용이다. 코딩 작업자, 대규모 파일 처리, 무제한 기록 누적까지 이 서버 크기로 보장하지 않는다. 디스크 공간과 RSS를 관찰하고 증설은 별도 결정한다.

## 소유자 계정에서 생성할 때

1. [Render 로그인](https://dashboard.render.com/login)에서 소유자 계정을 연결한다. 비밀번호·일회용 코드·API 키를 대화창에 보내지 않는다.
2. GitHub 연결을 요청하면 이 비공개 저장소에 필요한 접근을 승인한다. **New → Blueprint**에서 `wooyeonho/yeno-os`를 선택한다.
3. Blueprint branch를 **`yeno-core-pilot`**, Blueprint Path를 **`render.yaml`**로 지정한다. 기본 `main`은 이 후보 소스가 아니다. Root Directory는 비워 둔다.
4. 화면에서 서버 1개, 위 compute plan, 디스크 1 GB, 비용을 확인한다. 같은 이름의 기존 서비스가 보이면 덮어쓰지 않고 확인한다. 유료 workspace 업그레이드는 이 구성에 필요하지 않다.
5. 소유자가 새 비용을 확인한 뒤에만 **Deploy Blueprint**를 실행한다. 초기 배포 중에는 끊기지 않는 HTTPS 서버가 아직 준비된 것으로 표시하지 않는다.
6. Blueprint의 **Auto Sync**를 끄고 서비스의 Auto-Deploy가 꺼져 있는지 확인한다. `autoDeployTrigger: off`와 Blueprint Auto Sync는 별도 설정이다. 운영 중인 `yeno-core-pilot` 브랜치를 자동으로 최신 개발 커밋으로 옮기지 않는다.

계정 연결·비용 확인·GitHub 접근 권한이 없는 동안에는 개발자가 생성 완료나 실제 URL을 만들어 말하지 않는다. 실제 화면이 문서와 다르면 관찰한 화면을 기준으로 다음 한 단계만 안내한다. [Blueprint 생성 절차](https://render.com/docs/infrastructure-as-code)

## 배포 전에 자동으로 확인하는 것

`buildCommand`는 전체 `npm test`다. 디스크는 빌드 중에 연결되지 않으므로 빌드에서 운영 상태를 만들지 않는다. 시작은 `sh scripts/start-render.sh`다. 일반 `npm start`는 등록 키를 로그에 표시하는 로컬 실행 경로이므로 이 호스트의 Start Command로 쓰지 않는다.

시작 경로는 Render의 실제 hostname과 port를 사용하고 영구 디스크 마운트를 검증한다. 데이터 디렉터리는 마운트 안에 있어야 하며, 디스크가 없으면 임시 저장소로 대신 시작하지 않는다. 같은 프로세스로 상속한 독점 `flock`을 검증한 뒤 공유 `runtime/service.mjs`가 코어를 실행한다. 일반 CLI의 PID 파일과 혼용하지 않는다.

정상 종료·강제 종료 후 기록 보존, 기기 인증, 요청 중복 방지는 로컬 Linux 프로세스 검사와 실제 Render 검사를 구분한다. Render의 `flock`/procfs/디스크 권한/HTTPS/재시작은 **최초 배포에서 실제 확인할 항목**이다. 시작 검사 실패를 해결하려고 잠금이나 디스크 검사를 제거하지 않는다.

## 서버가 Live가 된 뒤 앱에 입력할 세 값

| 앱의 칸 | 입력할 값 |
| --- | --- |
| 코어 주소 | 서버 화면의 실제 HTTPS URL. 경로 없이 `https://발급된이름.onrender.com` 형태. `/api/v1`은 붙이지 않는다. |
| 연결 키 | 서버 **Environment → YENO_TOKEN**의 실제 값. 앱에 직접 입력한다. 이 값이 보이는 캡처·로그를 채팅이나 GitHub에 올리지 않는다. |
| 보관소 암호 | 연호님이 새로 정하는 8자 이상 암호. 휴대폰에 저장하는 기기 인증정보를 잠그는 암호이며 서버 연결 키와 다르다. |

이후 **이 기기 연결**을 누른다. 최초 기기 등록 이후에는 기기 전용 토큰을 사용한다. 보관소 저장, 앱 종료·재실행 후 잠금 해제, 기기 폐기는 실제 폰에서 별도로 검증한다. 폰을 닫아도 계속할 서버 작업과, 인터넷이 끊긴 폰에서 아직 전송하지 못한 명령을 혼동하지 않는다.

## 첫 사용 확인

1. 실제 URL의 `/api/v1/health`가 200이며 `name: YENO OS`, `apiVersion: 1`, `authRequired: true`인지 확인한다. 인증 없이 `/api/v1/state`는 401이어야 한다.
2. 폰을 등록하고 `기억해: YENO 첫 연결을 확인했다`를 보낸다. `찾아줘: 첫 연결`로 같은 기억이 조회되는지 확인한다.
3. `문서 만들어: YENO 첫 실행 확인 문서`를 보낸다. 앱을 닫고 다시 열어 같은 작업의 완료 상태와 실제 결과를 확인한다. 이 문서는 현재 결정형 문서 도구가 생성하며 AI가 추론했다는 증거가 아니다.
4. 서버를 수동 재시작하고 동일 기기의 인증·기억·작업·결과가 유지되는지 확인한다. 미완료 작업은 자동 재실행하지 않고 일시정지 상태로 남아야 한다.
5. 실행 기록에 소스 커밋, 실제 URL, 검사 시각·결과를 남기되 토큰과 개인 내용은 제외한다. `docs/DEVICE_ACCEPTANCE.md`에 폰 관찰 결과만 추가한다.

디스크는 이 서비스의 단일 인스턴스에만 연결한다. Render 문서상 디스크 사용 서비스는 교체 시 잠깐 중단되며 무중단 배포를 보장하지 않는다. 일일 디스크 스냅샷과 전체 복구 시험도 다르다. 개인 데이터 축적 전 별도 내보내기·백업·복구 절차를 확인한다. 새 코어는 노트북의 기존 0.2.3 데이터나 Obsidian Vault를 가져오지 않는다. [영구 디스크의 범위와 제한](https://render.com/docs/disks)

## 이번에 실행한 검사

- 전체 `npm test`: 43개 통과, 실패·건너뜀 0, 약 14.112초.
- 기존 커널 잠금 9개와 Render 시작 경로 4개를 포함한다. Render 양성 검사에서 마운트 메타데이터는 시험 fixture이며, 프로세스·flock·HTTP·SIGKILL·재시작은 실제 로컬 실행이다.
- shell/Node 구문 검사와 공식 Render JSON Schema 검증 통과. 소유자 계정의 실제 Blueprint 검증·배포는 아직 미실행이다.
