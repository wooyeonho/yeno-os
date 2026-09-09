# YENO Koyeb 실제 HTTPS·결과 보존 검사

2026-09-09 UTC. **전용 YENO 서비스의 실제 Docker 빌드, HTTPS 접속, 기기 인증, 문서 생성, 요청 중복 방지, 인스턴스 교체 후 결과 보존을 확인했다.** Android 앱에서의 등록·명령·재접속 검사는 아직 남아 있다.

## 실제 배포 대상

| 항목 | 확인 값 |
| --- | --- |
| HTTPS origin | `https://global-iris-gyeol-98386a17.koyeb.app` |
| Koyeb 서비스 ID | `7fb597dd-726e-45ee-bfde-7f695f6dc8ba` |
| 소스 커밋 접두사 | `481d6ea` |
| 빌드 파일 | `Dockerfile.koyeb` |
| 첫 정상 배포 | `153770e4-d07d-4896-8c86-96acf1f87d9a` |
| 재시작 후 정상 배포 | `86051e67-c4f7-4390-b3e8-870a8828322c` |
| 재시작 방식 | Koyeb에서 기존 빌드를 재사용한 새 배포. 이전 인스턴스는 Stopped, 새 배포는 Healthy임을 화면에서 확인 |
| 데이터 경로 | 전용 볼륨 `/var/lib/yeno` 아래 `/var/lib/yeno/data` |

공유 시작 코드가 실제 마운트·쓰기 가능 여부와 상속된 독점 flock/procfs를 검증한 뒤 상태를 열었다. 해당 검사를 생략하는 설정은 사용하지 않았다. 이미지의 `USER node:node` 실행 구성을 사용했으며, 별도로 `id`를 출력해 실제 숫자 UID를 측정한 것은 아니다. 이 문서는 원래 Gyeol 서비스의 동작 검증이나 데이터 이전을 뜻하지 않는다.

## HTTPS로 실행한 검사

재시작 전 검증 완료: **2026-09-09T12:58:56Z**.

| 요청·동작 | 실제 결과 |
| --- | --- |
| `GET /api/v1/health` | HTTP 200. `YENO OS`, 버전 `0.2.0`, API `1`, `authRequired:true` |
| 인증 없이 `GET /api/v1/state` | HTTP 401 |
| 새 시험 기기 등록 `POST /api/v1/devices/enroll` | HTTP 201. 이후 요청은 반환된 기기별 bearer로 수행 |
| 기기 인증 후 `GET /api/v1/state` | HTTP 200 |
| `POST /api/v1/commands` 문서 명령 | HTTP 201, 작업 1개 생성 후 `completed` |
| `GET /api/v1/artifacts/<id>` | HTTP 200, 실제 문서 569 bytes, 제출한 시험 문구 포함 |
| 동일한 본문·`requestId` 재전송 | HTTP 201, 같은 작업 ID 반환. 해당 작업은 상태에 정확히 1개 |
| AI 설정 | `ai.configured:false`; 이 검사에 유료 모델 호출 없음 |

시험 명령은 `문서 만들어: YENO Koyeb live deployment acceptance. This result must survive the core restart.`이며 실제 개인 데이터는 사용하지 않았다.

- 작업 ID: `fde464ee-edd1-481d-816f-95059b649e7e`
- 결과 ID: `9421557a-4fa7-4694-b950-5a6d58d74c89`
- 결과 SHA-256: `b361460ae0afa18ed51a280a5087e8d56293c925f4d26af8fa4f9fc2f4590204`
- 다운로드한 바이트의 SHA-256과 서버의 `X-Content-SHA256` 헤더가 일치했다.

## 실제 인스턴스 교체 후 검사

새 코어가 저장한 시작 이벤트: **2026-09-09T13:00:29.257Z**. 재시작 전 검사 완료 시각 이후의 이벤트임을 확인했다. 재시작 후 보존 검증 완료: **2026-09-09T13:01:51Z**.

1. 재시작 전에 저장한 동일 기기 bearer로 상태를 조회해 HTTP 200을 받았다.
2. 같은 작업 ID가 정확히 1개, `completed` 상태로 유지됐다.
3. 같은 결과 ID를 내려받아 569 bytes 및 위 SHA-256이 모두 같고 서버 헤더와도 일치함을 확인했다.
4. 원래 명령 본문과 `requestId`를 다시 보내 같은 작업 ID가 반환돼 요청 기록의 보존을 확인했다.
5. 보존 검증 후 임시 시험 기기를 폐기해 HTTP 200을 받았으며, 폐기한 bearer의 상태 조회는 HTTP 401로 거절됐다. 소유자 폰의 기기를 폐기한 것이 아니다.

페어링 키와 기기 bearer는 이 문서·소스·검사 출력에 기록하지 않았다. 시험용 연결 정보만 별도 비공개 파일에 0600 권한으로 저장했으며 임시 기기는 폐기됐다.

## 현재 증거의 범위

- APK 설치와 첫 연결 화면 표시는 소유자 캡처로 확인했다. **Android 폰에서 실제 페어링, 명령, 앱 종료·재실행, 정지·재개는 아직 미검증**이다.
- 실제 클라우드 검사는 정상 인스턴스 교체다. 클라우드에서 SIGKILL, 디스크 장애, 백업 복원, 장시간 부하를 시험한 것은 아니다. 기존 로컬 SIGKILL 시험과 구분한다.
- 실제 AI 연결, 자유 명령 도구 실행, 개발 작업자, 자동 개선 배포, Windows EXE는 이 검사로 완료되지 않는다.
- JSON 저장소와 독점 잠금은 **단일 writer**를 전제로 한다. 여러 인스턴스로 확대하지 않는다.
- Koyeb 볼륨은 공식 문서상 시험용 public preview이고 로컬 디스크의 중복 저장을 보장하지 않는다. 이번 재시작 보존 성공은 독립 백업·복원 또는 디스크 장애 보호의 증거가 아니다. 장기 개인 데이터의 유일한 보관소로 승격하기 전에 별도 백업과 복원을 검증한다. [Koyeb 볼륨 문서](https://www.koyeb.com/docs/reference/volumes)
