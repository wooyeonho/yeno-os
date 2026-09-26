# Codex 지시서 — 자비스 살아있는 얼굴 `/jarvis` (세계 최고 수준 UI)

작성: Claude(Cowork), 2026-09-26. 소유자 지시: "그냥 자비스를 만들어, UI 깔끔하게" → "UI가 너무 구려. 이걸 보고 사람들이 전세계 1위인 것 같겠니" → "Claude는 코딩하지 말고 Codex한테 지시하고 틀린 거나 잡아라."
역할: Codex = 구현·설계·자체검증. Claude = 이 지시서 + 결과 독립 검증(실제 서버 기동·Chromium 렌더·회귀). 소유자 = 최종 승인.

## 0. 현재 상태 (Claude가 만든 초안 — 그대로 쓰지 말고 재설계)
- `runtime/public/jarvis.html`, `runtime/public/jarvis.mjs` (미커밋). 실제 `/api/state`·`/api/commands`·`/api/artifacts/:id`에 붙어 있고, `web-client.mjs`의 `connectBrowser()`로 운영실과 같은 세션을 씀. 로컬 모델 경로(`YENO_AGENT_PROVIDER=local` + Ollama `/v1/chat/completions`)로 `목표: …` → agent job → artifact 발화까지 실제 서버에서 검증됨(§46, `build-artifacts/jarvis-face-20260926/`).
- **결함 1 (반드시 수정):** `jarvis.html`이 인라인 `<style>`과 `style=""` 속성을 씀. 서버 CSP가 `style-src 'self'`라 실제 서버에서는 **스타일이 전부 차단**된다(Claude의 렌더 검증은 CSP 없는 재생 서버였음 — Claude 검증 누락). CSS는 `runtime/public/jarvis.css` 외부 파일로, allowlist에 `'/jarvis.css':'jarvis.css'` 추가, 인라인 style 속성 0개. Google Fonts 불가(`style-src 'self'`): 시스템 폰트만.
- 결함 2: 화면이 밋밋함(핵 하나 + 글 한 줄). 아래 기준으로 재설계.

## 1. 목표
열자마자 "살아있는 존재가 나를 보고 있다"고 느껴지고, 캡처 한 장으로도 세계 최고급 제품이라고 믿게 하는 얼굴. 화려한 대시보드가 아니라 **한 존재의 얼굴**이다. 정보는 적게, 존재감은 크게.

## 1-1. 세부 판단 기준 (2026-09-26 소유자 정정)
소유자 발언: "그런 거 하나조차도 전세계 최고의 수준으로 생각해서 맞추면 되지." 이 지시서에 명시로 안 적힌 세부 선택(요소를 보여줄지 숨길지, 애니메이션 곡선, 여백, 문구 톤 등)은 매번 소유자에게 묻지 않는다. 판단 기준은 하나: "이 화면을 스크린샷 한 장으로 처음 보는 사람이 전세계 1위 제품이라고 믿겠는가?" — 정보를 더 넣어서가 아니라 필요 없는 걸 덜어내서 그 기준을 넘기는 쪽을 기본값으로 삼는다(§2의 "일곱 욕구 비노출" 정정이 실제 사례: 데이터를 화면에 더 얹는 대신 조용한 색 전이 하나로 정리한 것이 세계 최고 기준에 더 가깝다고 판단한 것). 이 기준으로 스스로 못 정할 정도로 방향이 갈리는 결정만 소유자에게 묻는다.

## 2. 디자인 요구 (판정 기준)
- 전체 화면 캔버스 장면 (`<canvas>` 풀블리드, WebGL 또는 2D). 배경은 평면 검정이 아니라 깊이가 있어야 함: 미세 입자층(시차), 매우 옅은 방사 격자, 중심으로 갈수록 밀도↑.
- 중심 "핵": 다층 링 구조. (a) 안쪽 발광 코어 — 숨쉬듯 0.04 진폭으로 느리게 팽창수축, `core.lastHeartbeatAt`가 바뀔 때마다 밖으로 퍼지는 파동 1회. (b) **일곱 욕구는 화면에 별도 호(arc)나 표로 노출하지 않는다(2026-09-26 소유자 정정 — "7욕구 표도 나올 필요 없고 뒤에서 돌아가면 됨").** `/api/drives/status`는 계속 뒤에서 실제로 불러와 코어 색 전이에만 쓴다: 지배 욕구(`core.dominantDriveId`)에 따라 코어 색이 서서히 그 색으로 이동(색: greed #c98500 · gluttony #3987e5 · envy #199e70 · pride #9085e9 · lust #d55181 · wrath #e66767 · sloth #d95926). 화면에는 색과 움직임으로만 드러나고, 숫자·라벨·범례는 없다. (c) `core.activeShadowCount`만큼 작은 위성이 링 밖을 공전. (d) `pendingApprovalCount>0`이면 호박색 점선 링이 정지 상태로 뜸(움직이지 않음 = 기다림).
- 타이포: 시스템 폰트만. 표시용 `Segoe UI Light/Semilight`(영문)+`Malgun Gothic`(한글) 300~350 굵기, 자간 넉넉히. 데이터는 `Cascadia Mono/Consolas`. 자비스의 말은 화면 하단 중앙, 22~40px 가변, 한 번에 한 문장, 바뀔 때 페이드+6px 상승.
- 크롬은 두 줄뿐: 좌상단 워드마크(BLACKHOLE / JARVIS, 자간 0.4em 대문자 얇게), 우상단 상태 클러스터(활동·모델·심장 시각, 모노 11.5px). 하단은 유리질 알약 입력창 하나(backdrop-filter, 그림자 깊게). 그 외 패널·카드·표 금지.
- 상태는 숫자보다 형태로: 일하는 중=위성 공전 속도↑, 생각 중=코어 안쪽 회전 링, 승인 대기=호박색 정지 링, 끊김=코어 채도 0.
- 모바일(400px)에서도 깨지지 않을 것. `prefers-reduced-motion`이면 파동·공전 정지, 페이드만.
- "AI스러운 기본값" 금지: 보라-파랑 그라데이션 히어로, 카드 그리드, 이모지, 중앙 정렬 텍스트 덩어리, `rounded-lg` 남발.

## 2-1. 구현 기술 선택은 Codex 재량 (2026-09-26 소유자 정정)
소유자 발언: "허깅페이스도 막 쓰고 깃허브 기술들도 막 쓰고 그런 것들 내가 알려줘야 하는 게 아니고 그냥 해주면 안되나." 오픈소스 라이브러리·모델·구현 기법 선택은 매번 소유자 승인을 받을 일이 아니다 — `AGENTS.md`의 기존 계약("Choose a sensible default for routine implementation choices", "Continue reversible, authorized implementation and fixes without asking the owner to manage every step")을 그대로 적용해 Codex가 알아서 고른다. 단, 이 저장소의 기존 안전 계약은 그대로 유지된다: 외부 코드/모델을 실제로 저장소에 편입·상주 실행하는 것은 여전히 `capability-discovery.mjs`/`kirby.mjs`의 검토(라이선스·고정 커밋·해시·fixture) 경로를 통과해야 하고, 자격 증명·비밀값은 여전히 소유자 관리다. "물어보지 않고 알아서 쓴다"는 라이브러리·기법 선택에 적용되는 것이지, 안전 게이트 자체를 없애라는 뜻이 아니다.

## 3. 동작 요구 (기존 초안 유지 + 보강)
- 데이터는 오직 실제 API: `/api/state`(core·agent·events·jobs·revision), `/api/drives/status`, `/api/artifacts/:id`. 시뮬레이션·가짜 값 0.
- 입력 → `/api/commands {requestId, text}`. 운영실 명령(`자동 운영 …`, `목표 현황`, `일곱 욕망`, `성과 장부`, `봇 현황`, `세계 현황`, `목표 저장:`, `목표 실행:`, `연구:`, `교차 검토:`)은 그대로, 나머지는 `목표: <text>`. 모델 미연결 409면 `목표 저장:`으로 보관하고 그 사실을 말함.
- 자비스의 말 = 완료 job의 첫 artifact 본문(`---` 이후 출처 꼬리표 제거, 420자 컷). 새 artifact가 없으면 core에서 1문장 합성(지배 욕구·미션·활동). 말한 job id는 localStorage에 기억(중복 발화 금지).
- 페어링은 `connectBrowser()` 그대로(요소 id: pair-screen, pair-form, pair-token, pair-key-toggle, pair-error, remember-browser, web-retry). 단일탭 잠금 유지.
- 로컬 모델 안내 문구(모델 미연결 시): `YENO_AGENT_PROVIDER=local YENO_LOCAL_BASE_URL=http://127.0.0.1:11434/v1/chat/completions YENO_LOCAL_MODEL=qwen2.5:3b YENO_AGENT_DAILY_CALL_LIMIT=20` (상한 0–20만 허용, `provider-config-engine.mjs` L75).

## 4. 산출물
- `runtime/public/jarvis.html`(인라인 style 0), `jarvis.css`, `jarvis.mjs`(+ 필요시 `jarvis-scene.mjs`), `server.mjs` allowlist(`/jarvis`, `/jarvis.html`, `/jarvis.css`, `/jarvis.mjs`, 추가 모듈).
- 증거: 실제 `server.mjs` 기동 상태에서 (1) 모델 없음, (2) `local` provider + Ollama 실물(qwen2.5:3b) 두 경우의 `/jarvis` 스크린샷(데스크톱 1440·모바일 400), `/api/state` 응답 저장, `목표: …` 1회 실행 후 artifact 발화 캡처. `build-artifacts/jarvis-face-v2-<date>/`에.
- 회귀 `npm test` 전량 통과(현재 기준 1154/1133 pass/0 fail/21 skip 이상).
- `docs/CLAUDE_EXECUTION_STATE.md`에 새 § 로 VERIFIED / RAN-UNVERIFIED / BLOCKED 구분 기록.

## 5. Claude가 검증할 항목 (Codex 보고를 그대로 믿지 않음)
1. 실제 서버 응답 헤더의 CSP 아래에서 스타일이 적용되는지 — Chromium에서 `/jarvis`를 CSP 포함 상태로 열어 computed style 확인.
2. 인라인 style 속성 0개, 외부 폰트 요청 0개 (네트워크 로그).
3. `drives[].pressure`가 실제로 fetch되어 지배 욕구 코어 색 전이에 쓰이는지 (호/표로 노출되지 않는지도 함께 확인 — 노출돼 있으면 지시 위반).
4. `lastHeartbeatAt` 변화 시 파동 1회, 미변화 시 0회.
5. 모델 미연결 409 → `목표 저장:` 보관 실제 발생.
6. Ollama 실물 경로 artifact 본문이 화면 문장과 일치.
7. 400px 레이아웃 무파손, reduced-motion 정지.
8. 회귀 수치 재실행.
