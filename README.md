# yeno-os

연호님의 개인 OS. Android 앱과 Windows 앱에서 같은 기억·목표·작업 결과를 확인하는 시스템을 개발합니다.

현재는 **실행 코어 0.2.0 후보와 실제 빌드에 성공한 Android 시험 APK**가 있습니다. 상주 운영 서버 연결·폰 실사용·Windows EXE·일반 자연어 도구 실행과 자동 개선 적용은 아직 완료되지 않았습니다. 사용자 캡처로 Android 설치 후 첫 연결 화면 표시까지 확인했습니다. 정확한 실행 결과는 `docs/STATUS.md`를 확인하세요.

## 폰에서 개발 시작

[YENO_START_HERE.md](YENO_START_HERE.md)에서 폰 첫 실행 이후 상주 코어 연결 단계를 확인하세요. 소스는 이미 폴더로 등록되어 있고 Codex 첫 구현 작업과 PR 생성까지 진행됐습니다.

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
- [첫 구현 작업](docs/FIRST_TASK.md)
- [YENO 성격과 행동 기준](identity/YENO.md)
- [기능 발견과 개선 기준](docs/DISCOVERY.md)
- [설계 결정 기록](docs/BUILD_DECISIONS.md)
- [변경 기록](CHANGELOG.md)

Codex Cloud는 개발 환경입니다. 노트북과 앱이 꺼져 있어도 일을 이어갈 YENO 본체는 별도 상주 서버에 배포해야 합니다.
