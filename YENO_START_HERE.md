# YENO OS — Codex 연결부터 시작

개인 비공개 저장소 `wooyeonho/yeno-os`가 생성됐고, 이 커밋에는 실제 소스가 폴더로 들어 있습니다. 저장소를 다시 만들거나 ZIP을 올릴 필요는 없습니다.

## 지금 폰에서 할 일

1. 폰 브라우저에서 [Codex Cloud](https://chatgpt.com/codex)를 열고 현재 ChatGPT 계정으로 로그인합니다.
2. GitHub 연결을 요청하면 `wooyeonho` 계정의 `yeno-os` 저장소 접근을 허용합니다. 이 대화의 GitHub 접근과 Codex 환경 선택은 별도로 확인해야 합니다.
3. 저장소 또는 환경 선택에서 `wooyeonho/yeno-os`를 선택합니다. 환경이 없으면 Codex 설정의 환경 목록에서 새 환경을 만듭니다.
4. 환경 이름은 `YENO`, 저장소는 `wooyeonho/yeno-os`로 둡니다. 패키지 버전 설정이 보이면 Node.js `24`를 선택합니다. 기초 코드에는 설치할 외부 패키지가 없어서 별도 설치 스크립트나 모델 API 키가 필요하지 않습니다.
5. 작업 화면으로 돌아가 해당 환경과 `main`을 선택한 뒤 아래 요청을 보냅니다.

```text
AGENTS.md, docs/STATUS.md, docs/FIRST_TASK.md를 읽고 첫 구현 작업을 수행해.
기준선 검증 후 Android에서 명령·결과·재접속을 확인할 코어 연결과 앱을 구현해.
실제로 실행한 검사와 빌드 결과를 보고하고, 막힌 부분은 정확히 구분해.
```

[OpenAI 공식 시작 안내](https://learn.chatgpt.com/docs/cloud) · [환경 설정 안내](https://learn.chatgpt.com/docs/environments/cloud-environment)

## 화면이 다르거나 저장소가 안 보이면

현재 화면을 캡처해서 개발 대화에 보내면 그 화면 기준으로 다음 버튼을 안내합니다. 로그인 비밀번호나 인증 코드는 대화에 보내지 않습니다.

앱 개발에 필요한 새 패키지·Rust·Android SDK/NDK는 실제 환경을 조사한 다음 설치 설정을 작성합니다. 최초 환경 생성만으로 이 도구들이 설치되거나 APK가 빌드됐다고 보지 않습니다.

## 첫 성공 기준

폰에서 명령 접수 → 실제 결과 파일 생성 → 앱을 닫았다 다시 열어 같은 작업과 결과 확인 → 중단·재개 동작 확인.

Codex Cloud에서 개발하고, 계속 일할 YENO 본체는 별도 상주 서버에 연결합니다. 클라우드 개발 환경 생성과 운영 서버 배포는 서로 다른 단계입니다.
