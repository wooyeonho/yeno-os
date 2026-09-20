# BLACKHOLE — Indexed Browser Decision Adapter

상태: **코드·합성 검사 구현**, live 브라우저 실행은 아직 연결하지 않음  
기준 branch: `blackhole/jev-browser-decision-claude-20260920`  
원자료: [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)  
판독일: 2026-09-20

## 원자료에서 확인한 기능

`jev-ultrafast`는 한 번의 브라우저 결정에서 구조화된 DOM을 번호화하고, 결정 모델이 허용된 operation과 element를 고르는 구조다. README의 기본 operation은 `CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_UP`, `SCROLL_DOWN`, `WAIT`, `DONE`, `BLOCKED`다. 기본 루프는 스크린샷 대신 구조화된 DOM을 사용하고, 대상의 페이지 신선도·가시성·가림 여부를 검사한다. README 예시는 Google Flights 검색을 7.1초에 수행하지만, 이는 작은 예시 벤치마크이지 Black Hole의 일반 성공률이나 운영 보증이 아니다.

원 저장소 README에 표시된 라이선스는 MIT다. Black Hole이 코드를 복사하거나 의존성으로 배포하는 것은 별도 검토 대상이며, 이번 slice는 원 저장소를 vendoring하지 않고 동작 계약과 안전 경계만 독립 구현했다.

## 이번 slice에서 실제로 추가한 것

- `runtime/lib/browser-decision.mjs`
  - bounded indexed-DOM snapshot 검증
  - 허용 operation의 strict parser
  - snapshot revision 불일치·없는 대상·비가시/비활성 대상 차단
  - password/token/API key/비밀번호 등 민감 필드 redaction
  - read-only 역할 허용: link/tab/option/combobox/textbox
  - 버튼·제출·임의 JavaScript·shell·인증·구매·게시 동작을 허용하지 않음
  - `DONE`은 독립 outcome evidence 없이는 통과하지 않음
  - provider나 Chrome 프로세스를 호출하지 않는 정책 상태
- `POST /api/browser/decision`
  - owner-authenticated preview 계약
  - 실제 외부 브라우저 동작은 dispatch하지 않음
  - provider에 보낼 bounded decision input과 안전 판정을 함께 반환
- `GET /api/state`
  - `browserDecision`에 현재 정책 상태를 표시
  - 기존 `capabilities.browserAutomation:false`는 유지하여 live 기능을 과장하지 않음
- `runtime/test/browser-decision.test.mjs`
  - redaction, fresh target, unsafe role, stale revision, DONE fail-closed, HTTP preview를 검사

## 아직 하지 않은 것

- TypeSafe Jev API key/endpoint 연결
- Browser Harness/Chrome/Playwright live process 연결
- 로그인 세션, 비밀번호, 결제, 게시, 외부 메시지
- phone → live browser → result의 실기기 acceptance
- 실제 semantic success-rate benchmark

## 다음 연결 조건

1. owner가 별도 Secret에 TypeSafe 키를 연결한다. 키를 코드·문서·프롬프트에 넣지 않는다.
2. 정책 adapter와 분리된 Browser Harness를 sandbox에서 먼저 실행한다.
3. 첫 live task는 공개 URL의 제목·본문·링크를 읽어 source intake 초안으로 저장하는 read-only 작업으로 제한한다.
4. action trace, DOM revision, artifact hash, 독립 verifier 결과를 저장한다.
5. CI synthetic transport → sandbox live provider → owner-approved canary 순서로 진행한다.
6. 외부 side effect와 credential input은 별도 owner-approval 계약 없이는 계속 차단한다.

## 권리·개인정보·운영 조건

- MIT 표시는 원자료의 현재 README에서 확인했지만, 원 저장소의 모든 의존성·웹 사이트 약관·수집 대상 콘텐츠 권리까지 자동으로 해결하지는 않는다.
- 공개 페이지라도 개인정보·로그인 쿠키·토큰·결제 정보는 DOM snapshot과 artifact에서 제거해야 한다.
- 브라우저 harness의 telemetry와 profile 공유 여부는 live 도입 전에 별도 점검한다.
- synthetic test 통과는 live provider의 의미 품질이나 실기기 동작을 증명하지 않는다.
