# YENO OS — 첫 APK 생성 완료, 다음은 상주 코어 연결

[실제 Android 빌드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/attempts/3)가 성공했다. 반복 실행 버튼을 누를 필요는 없다.

## 지금 확인할 것

- [APK 묶음 다운로드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/artifacts/10088424404): ZIP 안에 APK 1개, SHA256SUMS.txt와 build-info.json이 있다. GitHub 보관은 2026-09-16까지다.
- 시험 APK는 약 202 MB, 다운로드 ZIP은 약 53.5 MB다. 현재는 개발용 디버그 빌드다.
- 폰 설치와 동작은 아직 확인하지 않았다. 설치한 앱이 명령을 수행하려면 상주 HTTPS 코어 주소와 기기 등록이 필요하다. 주소가 없는데 임의 주소를 입력하거나 연결 성공으로 표시하지 않는다.

## 다음 한 연결

노트북이 꺼진 동안에도 실행될 상주 서버 계정이 필요하다. 개발 담당자가 사용할 계정·소유 권한을 확인한 뒤 `docs/PERSISTENT_CORE.md`에 준비한 설정으로 Docker 빌드·영속 저장·인증·재시작을 검증하고 HTTPS 코어와 폰을 연결한다. 신규 비용이나 실제 배포는 확인된 범위에서 진행한다.

## 개발을 이어갈 때

현재 후보는 PR #1과 `codex` 브랜치에 있다. APK를 만든 커밋은 `11a0e1f7f1cb09449a1a2f82b54f948fff416690`이며, 이후 코어 복구 개선의 검증 결과는 `docs/STATUS.md`를 따른다. 이미 있는 구현을 0.1.1 원본 해시에 맞추려고 되돌리지 않는다.

추가 앱 수정 뒤 빌드는 `docs/ANDROID_BUILD.md`를 따른다. workflow 자체를 바꿨으면 새 Run workflow가 필요하다. source_ref=codex인 기존 workflow에서 소스만 바뀌었다면 개발 담당자가 재실행할 수 있으며, 실제 소스 커밋을 로그로 확인한다.
