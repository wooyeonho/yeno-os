# 상주 코어 컨테이너 후보

2026-09-09. **배포 설정과 로컬 동작 검증을 준비한 상태다. 실제 서버·HTTPS 주소·폰 연결은 아직 없다.** Docker 빌드도 이 환경에서는 실행하지 못했다. 이 패키지는 현재 0.2.0 후보만 별도 실행하며, 꺼진 노트북의 0.2.3 설치나 데이터를 읽거나 바꾸지 않는다.

Android 설치와 첫 화면 표시는 사용자 캡처로 확인했다. 새 관리형 서버 후보는 [RENDER_SETUP.md](RENDER_SETUP.md)에 있다. 아래 내용은 기존 Docker 호스트용 경로다.

## 구성과 현재 한계

| 항목 | 동작 |
| --- | --- |
| 실행 | Node 24 코어 하나. `start()`를 직접 가져와 기존 API·저장 형식·환경변수를 사용한다. 토큰을 출력하는 대화형 CLI는 실행하지 않는다. |
| 데이터 | 로컬 named volume `yeno-core-data` → `/var/lib/yeno`. 기억, 작업, 요청 기록, 기기 등록, 결과 파일, 상태 백업을 함께 보존한다. 현재 JSON 저장소이며 SQLite 전환을 뜻하지 않는다. |
| 실행 권한 | UID/GID `1000:1000`, 읽기 전용 이미지, capability 제거. 빈 Docker 볼륨에 이미지의 소유권 `1000:1000`·권한 `0700`인 데이터 디렉터리가 복사되는 구성을 사용한다. |
| 연결 | 컨테이너 안 `0.0.0.0:8790`, 호스트에서는 `127.0.0.1:8790`만 공개한다. 같은 호스트의 HTTPS 역방향 프록시가 이 주소에 연결한다. |
| 인증 | 외부 비밀 파일을 `/run/secrets/yeno_pairing_token`에 읽기 전용으로 연결한다. 토큰 원문은 이미지·Compose 환경 설정·시작 로그에 넣지 않는다. |
| 단일 쓰기 | 영구 파일 `.container-runtime.flock`을 `flock --nonblock --no-fork`로 잡은 뒤 같은 프로세스에서 Node를 실행한다. 코어가 상속한 실제 독점 lock과 파일의 device/inode를 검증한 뒤에만 상태를 연다. 새 컨테이너 모드는 PID 파일을 만들지 않는다. |
| 정상 종료 | SIGTERM에서 작업을 일시정지 상태로 저장하고 연결을 닫는다. 정상 재시작 후에도 미완료 작업은 소유자가 개별 재개한다. |
| 상태 검사 | 인증이 필요 없는 기존 `GET /api/v1/health`의 API 버전·이름·인증 필요 표시를 확인한다. 토큰을 healthcheck에 전달하지 않는다. 개인 상태 API는 여전히 인증을 요구한다. |
| 공급자 | AI 환경값은 비워 두었다. 문서·기억·진단 기능을 실행하며 모델 호출·개발 작업자·예약·알림은 활성화하지 않는다. |

이 구성은 **Docker 호스트 하나의 로컬 볼륨**만 대상으로 한다. NFS·공유 디스크·여러 호스트·복제본 확장은 지원하지 않는다. 같은 볼륨을 다른 진입점이나 이전 버전의 CLI로 열면 안 된다. 이번 버전의 일반 CLI는 영구 guard가 있는 디렉터리를 거절하지만, 이 검사를 모르는 이전 CLI까지 강제할 수는 없다. `container_name`은 Compose 확장을 막고, `flock`은 같은 로컬 볼륨을 사용하는 패키지 실행끼리 배타성을 지킨다. `.container-runtime.flock` 파일을 삭제·교체하거나 상속된 FD를 닫으면 이 보호가 깨진다.

Docker의 [볼륨 초기화와 영속성](https://docs.docker.com/engine/storage/volumes/), [Compose 서비스·비밀 설정](https://docs.docker.com/reference/compose-file/services/), [Dockerfile 문법](https://docs.docker.com/reference/dockerfile)을 기준으로 구성했다. 이미지 태그와 OS 패키지 저장소는 바뀔 수 있으므로 재현 빌드가 완전히 고정된 상태는 아니다. 최초 성공 빌드의 이미지 ID·소스 커밋을 기록하고 이후 운영 배포에서는 검증한 이미지 digest를 고정한다.

## 실제 배포에 필요한 입력

다음 한 질문은 **사용할 상주 Linux 서버 계정이 이미 있는가**다. 기존 계정이 연결되면 개발 담당자가 아래 항목을 확인해 이어간다. 사용자가 개발 도구를 폰에 설치하거나 꺼진 노트북을 켤 필요는 없다.

1. 계속 켜져 있는 Linux 호스트 접근 권한과 유지되는 로컬 디스크. Docker Engine·Compose v2·이미지/패키지 다운로드가 가능해야 한다. 새 비용이 필요하면 구체적인 서버·비용을 확인한 뒤 진행한다.
2. 그 호스트로 연결할 정확한 HTTPS 호스트명과 인증서/프록시 관리 권한. 앱에는 `https://실제호스트명`을 입력한다. `/api/v1`은 앱이 붙이므로 입력 주소에 넣지 않는다.
3. 검토 완료한 소스 커밋. 페어링 토큰은 아래 절차에서 해당 호스트에 새로 만들고 소유자에게 비공개로 전달한다. 기존 설치 토큰을 채팅이나 소스에 복사하지 않는다.

## 호스트에서의 최초 준비

아래 명령은 **검토한 커밋의 새 체크아웃 루트**에서 운영 담당자가 실행한다. 현재 기본 예시는 일반적인 rootful Linux Docker이다. `core.example.net`은 실제 HTTPS 호스트명으로 바꾼다. 비밀 파일은 체크아웃 밖에 둔다.

```bash
sudo install -d -m 0700 /etc/yeno-core
sudo sh -eu <<'SH'
umask 077
test ! -e /etc/yeno-core/pairing-token
openssl rand -hex 32 > /etc/yeno-core/pairing-token
chown 1000:1000 /etc/yeno-core/pairing-token
chmod 0400 /etc/yeno-core/pairing-token
SH
```

이미 토큰 파일이 있으면 위 절차는 덮어쓰지 않고 멈춘다. 토큰을 새로 생성하는 것은 최초 준비 때 한 번만 한다. 운영자가 보호된 경로로 소유자에게 전달하고, 앱의 기기 등록 후에는 기기별 토큰으로 접속한다.

```bash
sudo sh -eu <<'SH'
umask 077
test ! -e /etc/yeno-core/compose.env
cat > /etc/yeno-core/compose.env <<'ENV'
YENO_PUBLIC_HOST=core.example.net
YENO_PAIRING_TOKEN_FILE=/etc/yeno-core/pairing-token
ENV
SH
sudo docker compose --env-file /etc/yeno-core/compose.env config --quiet
sudo docker compose --env-file /etc/yeno-core/compose.env build --pull
sudo docker compose --env-file /etc/yeno-core/compose.env up -d --wait
sudo docker compose --env-file /etc/yeno-core/compose.env ps
curl --fail --silent --show-error http://127.0.0.1:8790/api/v1/health
```

파일형 Compose secret에는 `uid`·`gid`·`mode` 재매핑이 적용되지 않는다. 그래서 원본 비밀 파일을 UID 1000이 읽을 수 있게 준비했다. rootless Docker나 user namespace remap을 쓰면 해당 호스트의 매핑에 맞춰 볼륨·비밀 파일 소유권을 별도로 확인한다. 권한 문제를 해결하려고 코어를 root로 바꾸거나 토큰을 로그에 출력하지 않는다.

호스트의 HTTPS 프록시는 요청을 `http://127.0.0.1:8790`로 전달하면서 원래 `Host`와 `Authorization` 헤더를 보존해야 한다. `YENO_PUBLIC_HOST`에는 scheme·경로 없는 정확한 호스트명만 넣고, 기본 HTTPS 포트가 아니면 포트까지 일치시킨다. 유효한 인증서와 접근 경로를 확인한 뒤 `https://실제호스트명/api/v1/health`를 검사한다. 인터넷이나 폰에서 평문 8790 포트로 직접 연결하지 않는다. 같은 Docker 네트워크에 둔 프록시용 설정은 이 호스트 프록시 예제와 다르므로 별도로 검토한다.

최초 호스트 검증에서는 UID 1000 시작·볼륨 쓰기·비밀 파일 읽기·healthcheck·호스트 loopback 제한을 실제 컨테이너로 확인한다. 실제 컨테이너의 강제 종료·자동 재시작·단일 writer 거절도 확인한다. 그다음 `DEVICE_ACCEPTANCE.md`의 폰 등록 → 문서 명령 → 앱 닫기 → 재접속 → 실제 결과 확인 → 정지/재개를 실행한다. healthcheck 통과만으로 이 흐름이 검증되는 것은 아니다.

## 보존·정상 재시작·교체

`docker compose stop`과 일반 `docker compose down`은 데이터 볼륨을 지우지 않는다. **`down -v`, `docker volume rm yeno-core-data`, 볼륨 prune을 이 코어에 사용하지 않는다.** 데이터 보존과 디스크 장애 대비 백업은 별도이므로, 전체 볼륨과 외부 페어링 토큰을 함께 비공개 백업한다. 앱 안의 스냅샷은 기억·설정 범위이고 전체 백업이 아니다.

정상 정지와 백업 예시:

```bash
sudo docker compose --env-file /etc/yeno-core/compose.env stop
sudo docker ps --filter volume=yeno-core-data
sudo sh -eu <<'SH'
umask 077
mkdir -p /etc/yeno-core/backups
backup_dir="/etc/yeno-core/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$backup_dir"
docker run --rm --network none --read-only --user 0:0 \
  --mount source=yeno-core-data,target=/var/lib/yeno,readonly \
  --entrypoint tar yeno-core:local -C /var/lib/yeno -czf - . > "$backup_dir/core-data.tgz"
cp /etc/yeno-core/pairing-token "$backup_dir/pairing-token"
cp /etc/yeno-core/compose.env "$backup_dir/compose.env"
docker image inspect yeno-core:local --format '{{.Id}}' > "$backup_dir/image-id.txt"
tar -tzf "$backup_dir/core-data.tgz" > /dev/null
SH
sudo docker compose --env-file /etc/yeno-core/compose.env start --wait
```

`docker ps` 결과가 비어 있고, 호스트에서 같은 데이터에 접근하는 별도 코어도 없음을 확인한 후 백업한다. 위 tar 실행만 읽기 전용 root 권한을 사용하며 코어 프로세스를 시작하지 않는다. 백업은 같은 디스크 밖의 소유자 관리 위치에도 보관한다. 원본 토큰·개인 데이터·백업을 GitHub 소스나 공개 결과물에 넣지 않는다.

소스 교체 전에는 위 백업과 기존 이미지 ID·소스 커밋을 확보한다. 새 이미지는 정지된 같은 named volume에 연결하며, 롤백은 이전 이미지와 저장 형식의 호환성을 먼저 검증한다. 복구 시험은 **새 별도 볼륨**에 백업을 풀어서 진행하고 현재 볼륨을 덮어쓰지 않는다. 복구본의 토큰·상태·결과 파일은 같은 시점의 사본을 사용한다. 노트북 0.2.3 데이터의 자동 수입·이동은 이 절차에 포함하지 않는다.

## 강제 종료 복구와 기존 PID 잠금

초기 패키지 후보는 컨테이너 Node가 매번 PID 1이 되는 상황에서도 일반 `runtime.lock`을 사용해, 강제 종료 후 남은 PID 1을 살아 있는 소유자로 판단하는 문제가 있었다. 현재 패키지는 `start({ containerLease: true })`에서 **검증된 Linux kernel lock**을 사용한다. 환경변수만으로 lock 검증을 생략하는 경로는 없다.

`runtime/lib/container-lease.mjs`는 상속된 FD의 `/proc/self/fdinfo`에서 현재 프로세스가 가진 전체 파일 독점 FLOCK을 확인한다. FD의 device/inode가 데이터 디렉터리의 symlink가 아닌 단일 링크 guard 파일과 같아야 한다. procfs가 바깥 PID namespace를 표시할 수 있으므로, lock 소유자 번호를 같은 procfs의 `/proc/self/status`와 비교한다. 공유 lock·다른 파일의 lock·잠그지 않은 FD·상속 FD 누락·worker thread는 상태를 열기 전에 거절한다. 같은 프로세스의 두 번째 시작도 거절하고, FD와 소유권 기록은 정상 종료 처리 중에도 프로세스가 끝날 때까지 유지한다. [Linux procfs의 lock 표시](https://www.kernel.org/doc/html/latest/filesystems/proc.html), [flock의 exec 동작](https://man7.org/linux/man-pages/man1/flock.1.html)

새 모드는 `runtime.lock`을 만들지 않으므로 강제 종료 후 PID 숫자를 재사용해도 이 경로에는 충돌할 PID 파일이 없다. 커널은 프로세스가 SIGKILL로 끝나도 flock을 해제하고, 다음 패키지 프로세스는 같은 영구 guard 파일을 잠가 저장된 상태를 연다. 실제 로컬 프로세스의 SIGKILL → 재시작에서 기기 인증·기억·결과·요청 기록 보존을 확인했다. 미완료 작업은 자동으로 다시 실행하지 않고 일시정지해 소유자의 재개를 기다린다.

일반 CLI는 guard가 없는 디렉터리에서 기존 PID 잠금을 그대로 사용한다. guard가 있으면 PID 파일 생성 전·후 두 번 검사해 컨테이너 시작과의 경쟁에서도 상태를 열지 못하게 한다. guard 파일을 해제 용도로 삭제하지 않는다. `restart: unless-stopped`는 컨테이너 재시도 설정이며, 실제 Docker·호스트 재부팅·디스크 장애까지 이 환경에서 검증한 것은 아니다.

**초기 미배포 후보의 legacy `runtime.lock`이 이미 있는 볼륨은 자동 변환하지 않는다.** 현재 모드는 커널 lock을 검증했어도 해당 파일이 있으면 데이터를 열기 전에 거절하고 그대로 보존한다. 이 경우에만 운영자가 다음 일회성 이동 절차를 수행한다.

1. Compose 서비스를 정지해 재시도부터 멈춘다. 이 볼륨을 사용하는 모든 컨테이너와 별도 호스트 코어가 정지했는지 확인한다.
2. 위 절차로 **전체 데이터를 읽기 전용 백업**하고 백업을 열 수 있는지 확인한다. 상태 파일을 초기화하지 않는다.
3. 살아 있는 다른 쓰기 프로세스가 없다는 확인 후에만, 유지보수 컨테이너에서 같은 `.container-runtime.flock`을 비차단 독점 획득한다. 잠금을 얻지 못하면 복구를 진행하지 않는다.
4. 획득한 잠금을 유지한 채 `runtime.lock`만 `runtime.lock.recovery-날짜`처럼 보관 이름으로 이동한다. `.container-runtime.flock`은 그대로 둔다. 코어의 상태·결과·토큰을 수정하지 않는다.
5. 코어를 한 개 시작하고 기존 기기 인증·기억·결과 파일을 확인한다. 미완료 작업의 재개는 소유자가 선택한다.

## 이번 환경의 실제 검사

| 검사 | 결과 |
| --- | --- |
| Docker·Podman | 설치되어 있지 않음. 이미지 다운로드·빌드·Compose 실행·컨테이너 권한·포트 격리 검증은 미실행. |
| Compose 설정 | PyYAML로 YAML 구문과 포트·사용자·비밀 경로·AI 비활성·볼륨·단일 서비스의 6개 조건 확인. Docker Compose 자체 검증은 아님. |
| Node | v24.19.0. Dockerfile에서 실제 시작 모듈·명령·healthcheck를 추출해 임시 데이터로 실행. |
| 패키지 시작/HTTP | healthcheck, 무인증 상태 401, 잘못된 Host 403, 기기 등록, 기억 저장, 실제 문서 결과 생성·읽기 통과. |
| 단일 쓰기/보존 | 두 번째 `flock` 실행 거절 및 상태 불변, 실제 SIGKILL·SIGTERM 후 재시작, 미완료 작업 정지, 기기 인증·기억·결과·요청 중복 방지 보존 통과. 새 모드가 PID 파일을 만들지 않는 것도 확인. |
| 비밀/권한 | 토큰 원문이 시작 로그에 없음을 검사. 초기 패키지 검사에서 임시 상태·바깥 lock의 파일 권한 `0600` 확인. |
| 잠금 실패 | 상속 FD 없음·공유 lock·다른 파일·잠그지 않은 FD·symlink·기존 PID 1 lock을 거절하고 상태 보존. 같은 프로세스·worker thread·일반 시작의 거절, 기본 PID 생성 도중 생긴 guard의 재검사 통과. |
| 새 통합 검사 | `node --test runtime/test/container-lease.test.mjs`: Linux 실제 프로세스 검사 9개 통과, 실패 0, 건너뜀 0. 전체 `npm test`에도 포함한다. Docker 엔진의 crash 시험은 아님. |
| 전체 회귀 검사 | 루트 `npm test`: 39개 통과, 실패 0, 건너뜀 0; 약 15.06초. 새 유료 모델 호출·외부 배포·실제 소유자 데이터 사용 없음. |
| non-root 실행 | 이 환경은 UID/GID 0만 매핑되어 UID 1000 변경이 `EINVAL`로 거절됨. 로컬 동작 검사는 UID 0에서 수행했으며 컨테이너 non-root 시작을 검증한 것으로 표시하지 않음. |

다음 작업은 **이미 있는 상주 Linux 서버 계정 연결**이다. 연결 후 검토한 소스를 실제 빌드하고 위 남은 컨테이너·복구 검증을 마친 뒤 HTTPS 코어와 폰을 연결한다.
