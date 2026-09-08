# yeno-os

연호님의 개인 OS. Android 앱과 Windows 앱에서 같은 기억·목표·작업 결과를 확인하는 시스템을 개발합니다.

현재는 **실행 코어 0.1.1과 개발 시작 파일**이 들어 있습니다. APK·EXE, 상주 운영 서버, 일반 자연어 도구 실행과 자동 개선 적용은 아직 구현·배포되지 않았습니다.

## 폰에서 개발 시작

[YENO_START_HERE.md](YENO_START_HERE.md)를 따라 Codex에 이 저장소를 연결하세요. 소스는 이미 폴더로 등록되어 있어 ZIP 업로드나 압축 해제가 필요하지 않습니다.

첫 개발 요청:

```text
AGENTS.md, docs/STATUS.md, docs/FIRST_TASK.md를 읽고 첫 구현 작업을 수행해.
기준선 검증 후 Android에서 명령·결과·재접속을 확인할 코어 연결과 앱을 구현해.
실제로 실행한 검사와 빌드 결과를 보고하고, 막힌 부분은 정확히 구분해.
```

## 로컬 검증

Node 24 이상에서 실행합니다. 현재 기준선에는 외부 패키지 설치나 모델 API 키가 필요하지 않습니다.

```bash
npm run verify:baseline
npm test
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
