# YENO OS — 폰 첫 실행 확인, 다음은 상주 코어 연결

[실제 Android 빌드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/attempts/3)가 성공했다. 반복 실행 버튼을 누를 필요는 없다.

## 지금 확인할 것

- [APK 묶음 다운로드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/artifacts/10088424404): ZIP 안에 APK 1개, SHA256SUMS.txt와 build-info.json이 있다. GitHub 보관은 2026-09-16까지다.
- 시험 APK는 약 202 MB, 다운로드 ZIP은 약 53.5 MB다. 현재는 개발용 디버그 빌드다.
- 사용자 캡처로 폰 설치 후 `본체 연결` 첫 화면 표시를 확인했다. 실제 명령·보관소·재접속 검증은 남았다. 화면의 `https://yeno.example.com`은 예시이며 실제 서버 주소가 아니다.

## 다음 한 연결

노트북이 꺼진 동안에도 실행될 상주 서버 계정이 필요하다. `render.yaml`과 `docs/RENDER_SETUP.md`에 Render 서버 1개 + 영구 디스크 1 GB 후보를 준비했다. 기본 월 비용은 $7.25이며 세금·포함량 초과 사용·AI 요금은 별도다. 아직 생성·결제·HTTPS 연결은 하지 않았다. 소유자 계정과 비용을 확인한 뒤 `yeno-core-pilot` 브랜치의 후보를 배포하고 실제 인증·재시작·폰 연결을 검증한다. 기존 Linux Docker 서버를 사용한다면 `docs/PERSISTENT_CORE.md`를 따른다.

## 개발을 이어갈 때

현재 후보는 PR #1과 `codex` 브랜치에 있다. APK를 만든 커밋은 `11a0e1f7f1cb09449a1a2f82b54f948fff416690`이며, 이후 코어 복구 개선의 검증 결과는 `docs/STATUS.md`를 따른다. 이미 있는 구현을 0.1.1 원본 해시에 맞추려고 되돌리지 않는다.

추가 앱 수정 뒤 빌드는 `docs/ANDROID_BUILD.md`를 따른다. workflow 자체를 바꿨으면 새 Run workflow가 필요하다. source_ref=codex인 기존 workflow에서 소스만 바뀌었다면 개발 담당자가 재실행할 수 있으며, 실제 소스 커밋을 로그로 확인한다.
