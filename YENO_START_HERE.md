# YENO OS — 폰 첫 실행 확인, 다음은 상주 코어 연결

[실제 Android 빌드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/attempts/3)가 성공했다. 반복 실행 버튼을 누를 필요는 없다.

## 지금 확인할 것

- [APK 묶음 다운로드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/artifacts/10088424404): ZIP 안에 APK 1개, SHA256SUMS.txt와 build-info.json이 있다. GitHub 보관은 2026-09-16까지다.
- 시험 APK는 약 202 MB, 다운로드 ZIP은 약 53.5 MB다. 현재는 개발용 디버그 빌드다.
- 사용자 캡처로 폰 설치 후 `본체 연결` 첫 화면 표시를 확인했다. 실제 명령·보관소·재접속 검증은 남았다. 화면의 `https://yeno.example.com`은 예시이며 실제 서버 주소가 아니다.

## 다음 한 연결

소유자의 기존 **Koyeb 계정 로그인과 YENO 저장소 연결**을 확인했다. 기존 서버에는 Gyeol이 실행 중이므로 별도 YENO 후보를 준비했다. `docs/KOYEB_SETUP.md`에 Micro 서버 1개 + 영구 볼륨 1 GB의 설정과 실제 검사 결과가 있다. 생성 화면의 서버 견적은 월 $5.36 추가이며, 볼륨은 공개 preview 무료 안내가 있지만 생성 시 요금·플랜 조건을 재확인한다. 세금·초과 사용·AI 비용은 별도다.

**아직 YENO 서버·볼륨·연결 키는 생성하지 않았다.** 새 비용과 시험 배포가 승인되면 `yeno-koyeb-pilot` 후보를 배포해 실제 HTTPS·인증·재시작·폰 연결을 검증한다. 이 볼륨은 시험용 preview이므로 장기 기억을 쌓기 전 별도 백업·복원 또는 운영용 저장소를 검증한다. Render 후보는 보류했고 기존 Linux Docker 경로는 `docs/PERSISTENT_CORE.md`에 유지한다.

## 개발을 이어갈 때

현재 후보는 PR #1과 `codex` 브랜치에 있다. APK를 만든 커밋은 `11a0e1f7f1cb09449a1a2f82b54f948fff416690`이며, 이후 코어 복구 개선의 검증 결과는 `docs/STATUS.md`를 따른다. 이미 있는 구현을 0.1.1 원본 해시에 맞추려고 되돌리지 않는다.

추가 앱 수정 뒤 빌드는 `docs/ANDROID_BUILD.md`를 따른다. workflow 자체를 바꿨으면 새 Run workflow가 필요하다. source_ref=codex인 기존 workflow에서 소스만 바뀌었다면 개발 담당자가 재실행할 수 있으며, 실제 소스 커밋을 로그로 확인한다.
