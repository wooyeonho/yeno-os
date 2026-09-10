# yeno-os

연호님의 개인 OS. Android 앱과 Windows 앱에서 같은 기억·목표·작업 결과를 확인하는 시스템을 개발합니다.

현재는 **Koyeb에서 실제 실행 중인 코어 0.2.0과 Android 시험 APK**가 있습니다. [YENO 조종석](https://global-iris-gyeol-98386a17.koyeb.app/)에서 개인 연결 키로 사용할 수 있습니다. HTTPS 명령·문서 결과·중복 방지와 서버 재시작 후 보존을 검증했습니다. Android 실기기 등록·재접속, 실제 AI 모델 호출, Windows EXE·노트북 조작·자율 개선 배포는 아직 확인되지 않았습니다. 정확한 검사 범위는 `docs/LIVE_ACCEPTANCE.md`와 `docs/STATUS.md`를 확인하세요.

## 폰에서 개발 시작

[YENO_START_HERE.md](YENO_START_HERE.md)의 실제 주소와 첫 명령으로 연결하세요. 연결 키는 소스에 포함하지 않습니다.

첫 개발 요청:

```text
AGENTS.md와 docs/STATUS.md, docs/ANDROID_BUILD.md를 읽고 현재 작업을 이어가.
기존 구현을 보존하고 검사·실제 APK 빌드 결과를 확인해.
수동 빌드가 실패했다면 최초 실패 원인을 수정하고 아직 미검증인 부분을 구분해.
```

## 로컬 검증

Node 24 이상에서 실행합니다. 코어·명령 회귀 검사에는 외부 패키지나 모델 API 키가 필요하지 않습니다. 앱 화면 빌드에는 아래 의존성 설치가 필요합니다.

```bash
npm test
npm ci --prefix apps/controller --ignore-scripts --no-audit --no-fund
npm run build:controller
npm start -- --no-open
```

`verify:baseline`은 원본 수입 확인용입니다. 의도적으로 runtime 코드를 변경한 이후에도 원본 해시 통과를 요구하지 않습니다. 기능 검증은 테스트와 실제 사용 결과로 수행합니다.

## 개발 안내

- [개발 지침](AGENTS.md)
- [실제 상태](docs/STATUS.md)
- [상주 서버 실제 사용 검사](docs/LIVE_ACCEPTANCE.md)
- [기존 구독 재사용·비용 감사](docs/HOSTING_REUSE_AUDIT.md)
- [Koyeb 첫 연결 후보](docs/KOYEB_SETUP.md)
- [첫 구현 작업](docs/FIRST_TASK.md)
- [YENO 성격과 행동 기준](identity/YENO.md)
- [기능 발견과 개선 기준](docs/DISCOVERY.md)
- [설계 결정 기록](docs/BUILD_DECISIONS.md)
- [변경 기록](CHANGELOG.md)

Codex Cloud는 개발 환경입니다. YENO 본체는 별도 Koyeb 서비스에서 상주합니다. 노트북이 꺼져 있어도 서버의 기억·문서 기능은 사용할 수 있으며, 꺼진 노트북의 파일·화면을 조작하는 기능은 제공하지 않습니다.
