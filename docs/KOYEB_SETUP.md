# Koyeb 상주 코어 — 실제 배포 구성

2026-09-09. **YENO 서비스·1 GB 전용 볼륨·연결 Secret을 생성하고 실제 Docker 빌드·HTTPS·명령·재시작 후 결과 보존을 검증했다.** 실제 주소는 `https://global-iris-gyeol-98386a17.koyeb.app`이며 [검사 기록](LIVE_ACCEPTANCE.md)에 증거가 있다. APK 실기기 연결은 남았다. 기존 서비스가 있으므로 이 문서의 생성 순서를 다시 실행해 중복 서버를 만들지 않는다.

## 기존 서비스와 준비한 구성

기존 `gyeol-openclaw/gyeol-gateway` Nano는 소유자 승인으로 Pause했으며 실행 0개다. 운영 소스 `92176c90`과 환경·DB를 삭제하지 않았다. 별도 YENO 서비스 `global-iris/yeno-core`는 Frankfurt의 Micro 1개로 실행하며 전용 볼륨 1개를 사용한다. 계정은 기존 Starter를 유지한다.

| 항목 | 실제 YENO 설정 |
| --- | --- |
| 저장소 / 브랜치 | `wooyeonho/yeno-os` / `yeno-koyeb-pilot`. 검증한 커밋을 고정하며 `main`은 사용하지 않는다. |
| 서비스 | 별도 `yeno-core` Web service, 실제 앱 `global-iris` |
| 빌드 | Dockerfile, 파일 `Dockerfile.koyeb`, context 저장소 루트. Entrypoint·Command·Work directory override 없음. Privileged 꺼짐. |
| 인스턴스 | Standard Micro, 0.5 vCPU / 512 MB, Frankfurt 1개 |
| 실행 수 | Fixed 1. 자동 확장·scale-to-zero·자동 배포 꺼짐. |
| 영구 볼륨 | 새 `yeno-core-data`, Frankfurt 1 GB, `/var/lib/yeno` 마운트 |
| 실제 데이터 | `/var/lib/yeno/data`. 인스턴스 설명의 5 GB 임시 Disk와 별개다. |
| 포트 / 경로 | HTTP `8790`, Public HTTPS access, 경로 `/`, TCP proxy 꺼짐 |
| Health check | HTTP GET `/api/v1/health`, 포트 8790. Host 헤더 `localhost`, grace 30초, interval 30초, timeout 5초, restart limit 3. |
| 연결 키 | `yeno-core-pairing` Secret을 `YENO_TOKEN={{ secret.yeno-core-pairing }}`으로 참조. 32-byte 이상의 난수로 만들며 소스·앱·시작 로그에 넣지 않는다. |
| AI | 공급자 키·환경값을 추가하지 않는다. 현재 문서 도구로 첫 연결을 확인한다. |

이미지의 기본값은 `YENO_HOST=0.0.0.0`, `YENO_PORT=8790`, `YENO_DISK_MOUNT_PATH=/var/lib/yeno`, `YENO_DATA_DIR=/var/lib/yeno/data`다. 플랫폼의 `KOYEB_SERVICE_ID`와 `KOYEB_PUBLIC_DOMAIN`을 읽어 정확한 공개 호스트를 허용한다. `PORT`를 수동 설정한다면 8790으로 일치시킨다. 선택적으로 `YENO_ALLOWED_HOSTS`에 추가 도메인을 지정할 수 있으며 와일드카드는 거절한다.

## 비용과 적용 조건

실제 생성 화면의 Micro 견적은 **$0.0072/시간, $5.36/월**이다. 새 YENO 서버의 계산 비용이며 세금·포함량 초과 사용·AI 비용을 포함한 청구 상한은 아니다. Starter에서 별도 Standard 서버는 무료 인스턴스가 아니다. [공식 요금 FAQ](https://www.koyeb.com/docs/faqs/pricing)

볼륨 생성 화면에는 별도 가격이 표시되지 않았다. 공식 공개 안내에는 public preview 동안 무료라고 되어 있고 현행 문서에도 preview 표시가 남아 있다. 다만 2024년 발표를 영구 무료나 현재 계정의 청구 확약으로 취급하지 않는다. 생성 시 추가 요금·플랜 업그레이드가 요구되면 실행 전에 확인한다. [볼륨 공개 안내](https://www.koyeb.com/blog/volumes-high-iops-and-low-latency-nvme-ssds-public-preview), [현행 볼륨 문서](https://www.koyeb.com/docs/reference/volumes)

소유자가 위 비용·배포·연결 키 설정·재시작 검증을 승인한 뒤 생성했다. 기존 Gyeol 중지도 승인 후 적용했다. 같은 범위의 작업을 다시 승인 요청하지 않는다. 신규 비용이나 데이터 삭제 등 범위가 달라지는 변경은 별도로 판단한다. 기존 Render 후보는 보류하며 `yeno-core-pilot` 브랜치를 함께 배포하거나 변경하지 않는다.

## 최초 생성 때 적용한 순서

1. 비용과 시험 배포 범위가 승인되면 **Volumes → Create volume**에서 이름·Frankfurt·1 GB를 재확인하고 새 볼륨을 생성한다. 기존 볼륨을 재사용하거나 지우지 않는다.
2. **Create service → GitHub → wooyeonho/yeno-os**를 선택한다. 현재 GitHub 연결에서 이미 저장소가 보이므로 권한 확대가 필요하지 않았다.
3. Dockerfile 경로를 `Dockerfile.koyeb`로 override하고, Standard Micro / Frankfurt를 선택한다. 마지막 화면 Source에서 브랜치를 `yeno-koyeb-pilot`로 지정하고 자동 배포를 끈다.
4. 표의 포트·health check·고정 실행 수·전용 볼륨 마운트·새 앱/서비스 이름을 설정한다. 연결 키는 Koyeb 비밀 입력 또는 Secret 참조로 넣는다. 비밀값이 포함된 캡처나 전체 환경 목록을 기록하지 않는다.
5. 정확한 소스 커밋과 견적, 볼륨 연결을 확인하고 Deploy를 실행한다. 빌드 성공·Healthy 표시·실제 API 정상 응답을 각각 확인한다. 이전 Gyeol 서비스를 재배포하지 않는다.

설정 화면이 저장소나 Dockerfile 내용을 자동으로 올바르게 선택했다고 가정하지 않는다. 실제 화면은 기본 `main`, 포트 `8000`, TCP health check를 제안했으며 이 값들은 YENO 후보 설정으로 수정해야 한다.

## 시작·복구 검사

`scripts/start-koyeb.sh`는 실제 영구 마운트와 현재 사용자 쓰기 권한, 토큰, hostname/port를 먼저 검사한다. 마운트가 없거나 임시 파일시스템이면 데이터 폴더를 만들며 우회하지 않는다. 통과한 뒤 독점 `flock`을 상속한 동일 프로세스가 `runtime/service.mjs`를 실행한다. 코어는 UID 1000으로 실행하며 기존 데이터를 자동 chown하거나 root로 코어를 실행하지 않는다.

Koyeb은 비-root 볼륨 권한 개선을 발표했지만 실제 마운트의 UID·모드와 `/proc` 잠금 보고는 최초 호스트에서 확인해야 한다. 시작이 거절되면 그 원인을 기록하고 잠금/영구 저장 검사를 제거하지 않는다. [Koyeb 변경 기록](https://www.koyeb.com/changelog)

실제 배포 후 검증 순서는 다음과 같다.

1. HTTPS `/api/v1/health`: 200, `name: YENO OS`, `apiVersion: 1`, `authRequired: true`. 인증 없는 `/api/v1/state`: 401.
2. 기기 등록 후 `기억해: YENO 첫 연결을 확인했다`, `찾아줘: 첫 연결`, `문서 만들어: YENO 첫 실행 확인 문서`로 기억과 실제 결과 파일을 확인한다.
3. 서버를 재시작해 같은 기기 인증·기억·요청 ID·결과가 남는지 확인한다. 미완료 작업은 일시정지되며 무조건 재실행하지 않아야 한다.
4. 폰에서 앱 종료 → 재실행 → 보관소 암호 해제 → 같은 작업과 결과를 확인한다. 일시정지·재개·전체 정지·기기 폐기도 실제 관찰 결과로 기록한다.

앱의 **코어 주소**에는 실제 발급된 HTTPS URL만 넣으며 `/api/v1`은 붙이지 않는다. **연결 키**에는 Koyeb에 보관한 새 키를 직접 넣는다. **보관소 암호**는 소유자가 정하는 8자 이상 암호이며 연결 키와 다른 값이다. 실제 주소는 위에 기재했고 연결 키는 소유자에게 별도로 전달했다. 키 원문을 저장소에 기록하지 않는다.

## 실제 검증과 남은 한계

- Node 24.19.0 전체 `npm test`: **46/46 통과**, 실패·건너뜀·취소 0, 14.388초. shell/Node 구문 검사 통과.
- 새 Koyeb 검사 3개는 실제 shell·Linux 프로세스·flock·HTTP 인증·호스트 거절·문서 결과·중복 writer 거절·SIGKILL/재시작을 실행했다.
- 로컬 양성 마운트 메타데이터와 EACCES 사례는 **시험 fixture**다. 이후 실제 Docker 빌드와 Koyeb 볼륨에서 시작 검증·HTTPS·인증·결과·재시작 보존을 별도로 통과했다. 이미지의 node 사용자 구성을 유지했으며 실제 숫자 UID를 출력해 측정한 것은 아니다. 폰 등록은 미검증이다.
- 기존 Render 시작 검사와 일반 Docker 시작 경로를 유지했다. Android 앱 소스와 기존 노트북 0.2.3 설치는 변경하지 않았다.

Koyeb 문서는 볼륨을 **시험용 public preview**로 설명하며 단일 로컬 디스크의 장애 보호를 보장하지 않는다. 이 후보는 첫 연결 시험용이다. 장기 개인 기억의 유일한 보관소로 사용하지 말고 별도 백업·내보내기·실제 복원 검증 또는 운영용 저장소 이전을 마친 뒤 일상 운영으로 승격한다. 현재 JSON 저장소는 단일 writer이며 여러 서버에서 공유할 수 없다. [볼륨 한계](https://www.koyeb.com/docs/reference/volumes)
