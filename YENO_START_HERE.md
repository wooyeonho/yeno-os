# YENO OS — 실제 상주 서버 첫 연결

코어가 Koyeb에서 실행 중이다. 노트북을 켜지 않아도 기억 저장·검색과 입력 내용 문서화를 사용할 수 있다.

## 폰 앱에서 연결

1. 이미 설치한 YENO 앱을 연다.
2. 코어 주소: `https://global-iris-gyeol-98386a17.koyeb.app` — `/api/v1`을 붙이지 않는다.
3. 연결 키: 소유자에게 별도로 전달한 개인 연결 파일의 키를 사용한다. Koyeb Secrets의 `yeno-core-pairing`에도 보관되어 있다. 저장소·이슈·PR에 키를 붙여 넣지 않는다.
4. 보관소 암호: 소유자가 정한 8자 이상 암호를 입력한다. 연결 키와 다른 값이다.
5. **이 기기 연결**을 누른다.

첫 명령은 아래 순서로 보낸다.

```text
기억해: YENO 첫 연결을 확인했다
찾아줘: 첫 연결
문서 만들어: YENO 첫 실행 확인 문서
```

앱을 완전히 닫았다가 다시 열고 보관소 암호로 해제한 뒤 같은 기억·작업·결과를 확인한다. 이 Android 실기기 단계는 소유자 확인이 남아 있다. 서버 API 검사를 실기기 검사로 표시하지 않는다.

## 브라우저에서 연결

[YENO 조종석](https://global-iris-gyeol-98386a17.koyeb.app/)을 열고 같은 개인 연결 키를 입력한다. 기존 웹 화면의 PC 안내는 로컬 실행 때의 문구이며, 위 주소의 본체는 Koyeb 서버다.

## 확인된 것과 남은 것

- 실제 Docker 빌드·HTTPS 코어·인증·문서 생성·결과 다운로드·요청 중복 방지·서버 재시작 후 같은 인증/작업/결과 보존 확인. [실제 사용 검사](docs/LIVE_ACCEPTANCE.md)에 증거를 기록했다.
- 현재 AI 공급자는 연결하지 않았다. 기억·문서 기능을 일반적인 자유 대화나 자율 작업으로 해석하지 않는다.
- Windows EXE·노트북 파일/화면 제어·자동 개선 배포는 아직 제공하지 않는다. 노트북의 별도 0.2.3 설치도 변경하지 않았다.
- 기존 Koyeb Gyeol 실행기는 소유자 승인에 따라 일시정지했다. Supabase와 Vercel의 기존 앱·DB·구독은 유지했다. [비용 기록](docs/HOSTING_REUSE_AUDIT.md)에 실제 금액과 제한을 구분했다.

## 앱과 개발 기록

[실제 Android 빌드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/attempts/3)의 앱 소스는 `11a0e1f7f1cb09449a1a2f82b54f948fff416690`이다. 시험 APK 약 202 MB, ZIP 약 53.5 MB이며 개발용 디버그 빌드다. [GitHub APK 묶음](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/artifacts/10088424404)은 2026-09-16 보관 만료다.

실행 코어 소스는 `yeno-koyeb-pilot`의 `481d6ea4e679300b5644a0be6d36113a7c1374cc`다. 자동 배포는 껐으며 문서 커밋만으로 서버가 바뀌지 않는다. 현재 작업은 PR #1의 `codex` 브랜치에 있다. 다음 개발은 `AGENTS.md`, `docs/STATUS.md`, `docs/LIVE_ACCEPTANCE.md`를 먼저 읽고 기존 API·기기 인증·데이터를 보존한다.
