# YENO OS — 폰 첫 실행 확인, 다음은 상주 코어 연결

[실제 Android 빌드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/attempts/3)가 성공했다. 반복 실행 버튼을 누를 필요는 없다.

## 지금 확인할 것

- [APK 묶음 다운로드](https://github.com/wooyeonho/yeno-os/actions/runs/34309339030/artifacts/10088424404): ZIP 안에 APK 1개, SHA256SUMS.txt와 build-info.json이 있다. GitHub 보관은 2026-09-16까지다.
- 시험 APK는 약 202 MB, 다운로드 ZIP은 약 53.5 MB다. 현재는 개발용 디버그 빌드다.
- 사용자 캡처로 폰 설치 후 `본체 연결` 첫 화면 표시를 확인했다. 실제 명령·보관소·재접속 검증은 남았다. 화면의 `https://yeno.example.com`은 예시이며 실제 서버 주소가 아니다.

## 다음 한 연결 — 기존 구독 먼저 재사용

소유자가 **Supabase·Vercel의 기존 유료 구독을 활용하고 중복 비용을 줄이는 방향**을 요청했다. 실제 계정과 Gyeol 실행 소스를 확인한 결과는 [기존 구독 감사](docs/HOSTING_REUSE_AUDIT.md)에 있다. Supabase Pro의 기존 프로젝트를 YENO 기억·작업·결과 저장에, Vercel Pro를 웹 화면·API에 재사용하는 후보를 우선 검토한다. 저장소 어댑터와 실행 분리는 아직 구현 전이다.

**새 Koyeb 비용 동의는 받았지만, 기존 구독 재사용 검토를 위해 생성은 보류했다.** 기존 Gyeol 서버는 자동 활동을 실행하고 있어 아직 중지하지 않았다. 서비스·구독·DB를 삭제하거나 변경하지 않았으며 실제 절감액은 아직 0이다. 중단 대상의 용도와 복원 방법을 확정한 뒤 적용한다.

`yeno-koyeb-pilot`의 Micro 서버 + 1 GB 볼륨 후보와 `docs/KOYEB_SETUP.md`, Render 및 일반 Docker 후보는 비교·복귀용으로 보존한다. 실제 YENO HTTPS 주소·연결 키·폰 등록은 아직 없다. 기존 JSON 코어를 Supabase URL 입력이나 Vercel Import만으로 연결할 수 있는 것으로 안내하지 않는다.

## 개발을 이어갈 때

현재 후보는 PR #1과 `codex` 브랜치에 있다. APK를 만든 커밋은 `11a0e1f7f1cb09449a1a2f82b54f948fff416690`이며, 이후 코어 복구 개선의 검증 결과는 `docs/STATUS.md`를 따른다. 이미 있는 구현을 0.1.1 원본 해시에 맞추려고 되돌리지 않는다.

추가 앱 수정 뒤 빌드는 `docs/ANDROID_BUILD.md`를 따른다. workflow 자체를 바꿨으면 새 Run workflow가 필요하다. source_ref=codex인 기존 workflow에서 소스만 바뀌었다면 개발 담당자가 재실행할 수 있으며, 실제 소스 커밋을 로그로 확인한다.
