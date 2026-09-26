# EXTRA-136 독자 공간 가림 시험

원장 EXTRA-136의 부분 관찰 자료에서 **깊이에 따라 물체가 문 앞에 보이거나, 문 안쪽에서 일부만 보이거나, 완전히 가려지는 조건**을 독자 2D SVG 장면으로 시험한다. 원본 릴은 부분 관찰 상태이고 기기·엔진·AI 모델은 미확인이다. 원본 화면·캐릭터·브랜드 에셋은 사용하지 않았다.

`index.html`은 로컬 서버에서 여는 개발 화면이다. 더블클릭 가능한 단일 파일은 아래처럼 새 경로에 생성한다. 기존 결과 파일을 덮어쓰지 않는다.

```powershell
node experiments/extra-136-occlusion/build-offline.mjs build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline.html
node --test experiments/extra-136-occlusion/scene-core.test.mjs
node experiments/extra-136-occlusion/verify-browser.mjs build-artifacts/handoff-r3-20260926/extra136-browser
node experiments/extra-136-occlusion/verify-browser.mjs build-artifacts/handoff-r3-20260926/extra136-offline-browser build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline.html
```

사용자는 세 가지 사전 장면이나 수평 위치·물체 깊이 슬라이더를 조절한다. 깊이 50을 넘는 물체는 포털 내부 클립에만 나타난다. 실제 AR 공간 추적, 카메라, Android 설치·페어링, 원본 영상 전체 재현을 시험한 결과가 아니다. 이 시연 파일은 BLACKHOLE 제품 화면에 통합되지 않은 로컬 실험이다.

2026-09-26 실행 증거: `build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline-v3.html` SHA-256 `4672d40e6bbd75ee2857fd829cfb7fa8612858538762b581948718c9dbd25220`. `extra136-visual-v6/report.json`과 `extra136-offline-browser-v3/report.json`에서 각 17개 실제 Chrome 캡처·검사 통과. `extra136-prototype-handoff-v1/report.json`은 격리 코어의 source→job→artifact→result memory 및 재시작 회수 연결을 기록한다. 상태와 명령·한계는 `docs/CLAUDE_EXECUTION_STATE.md` §41을 따른다.
