# CODEX 지시서 — 릴 7종 흡수: 상태 오브 · 정찰 도구 후보 · 측정 실험 · 보류 목록 (2026-09-30)

작성: Claude(Cowork). 구현: Codex. 출처: 소유자가 공유한 인스타 릴 7개의 요약(Codex 정리)과 Claude가 직접 확인한 상류 자료. **릴의 성과·비용·매출·작동 주장은 증거가 아니다**(BLACKHOLE 원장에서는 `self_reported`도 아닌 "출처 미확인 주장"). 이 지시서는 그 주장을 사실로 받아들이지 않고, BLACKHOLE의 방식(영수증)으로 시험하거나 도구만 흡수한다.
전제/위치: `BLACKHOLE_GOAL_CHARTER_20260930.md`의 P1 뒤 **P1.5**로 끼운다(전체 Goal 루프 안에서 실행). 충돌 시 charter 4~6장, 자율성 기준, S0 정정본이 우선. 불변: `authorizesDispatch:false`, `solo-leveling.mjs`/`recovery-one-of-qpu.mjs`/`static-guard.mjs` 무수정, 자격증명 소유자 전용, 커밋/push 금지, Vault 무수정.

## 0. 흡수를 BLACKHOLE 자기 방식으로 (dogfooding)

흡수 대상 오픈소스는 **방금 만든 독립 근거 검증기**(repository-evidence)로 먼저 확인한다. 검색 공급자를 거치지 않고 소유자가 준 GitHub 주소만 입력한다.
- `Jakubantalik/thinking-orbs`, `Panniantong/Agent-Reach` 를 실제 GitHub 공개 메타데이터로 확인(무인증, 호출 한도 내 최소 횟수). 관측값(SPDX 라이선스, archived, 기본 브랜치 HEAD sha, stars, pushed_at)을 그대로 기록. 기대값을 미리 정하지 말고 달라도 그대로 보고. Claude가 확인한 참고값(변동 가능): 둘 다 MIT, thinking-orbs 스타 16개(작은 프로젝트).
- 결과는 `absorb-inbox`에 기록하되 새 kind가 필요하면 저장 먼저(S0 F3): `reference-claim`(출처 URL, 주장 요약 ≤300자, `verificationStatus:'unverified'`, 소유자 공유 사유). 릴의 주장은 이 kind로만 저장되며 어떤 등급·점수·욕망 정산에도 쓰이지 않는다.

## A. S17-a — 상태 오브 (Thinking Orbs 흡수)

**소스**: `thinking-orbs`(MIT, 캔버스 2D, React 컴포넌트지만 바닐라 JS로도 동작, 상태: working / searching / solving / listening / composing / shaping, 움직임 줄이기·라이트/다크 지원). 의존성으로 추가하지 말고 **검증된 커밋 sha의 소스와 LICENSE를 `runtime/public/vendor/thinking-orbs/`에 복사**하고 파일별 SHA-256과 출처 커밋·라이선스 고지를 함께 기록(`VENDOR.md`). 우리 UI는 바닐라 ESM이므로 React 없이 캔버스 부분만 사용. 기존 `jarvis-orb.mjs`(메인 오브, three.js)는 그대로 두고 **작은 오브(대략 24~64px)를 추가 표면**에 붙인다.

**상태 매핑 — 반드시 저장된 실제 기록에서만**:
| 오브 상태 | 실제 원천 |
|---|---|
| working | 활동 상태 `executing` 또는 `planning`(`ACTIVITY_KO`), 진행 중 job |
| searching | G1 `researching`/검색 예약 진행, 저장소 근거 확인 호출 진행 |
| solving | 활동 상태 `verifying`, 의미 검증 진행 |
| listening | `waiting_owner`(승인 대기), 이후 S12 음성 입력 중 |
| composing | 산출물 생성 중, C1 색욕 자기 미화 초안 작성 중 |
| shaping | 커비 흡입/복사·그림자 "일어나라" 진행 기록이 있는 순간(C2/C3 기록이 실제로 있을 때만) |
| (정지) | idle / paused / stopped / 비상 정지: **움직이지 않는다**(멈춘 점 구체) |

규칙: 장식용 회전 금지. 상태 원천이 없으면 오브는 정지 상태. 각 표면(메인 헤더 1개, 욕망 패널 욕망별 1개, 그림자 명부 개체별 1개)은 자기 원천만 읽고, 캔버스는 **공유 애니메이션 프레임 하나**로 그리며 화면 밖·탭 비활성 시 정지(저RAM PC 고려). 색은 기존 `DRIVE_COLOR` 토큰만, 움직임 줄이기 설정 시 정지 이미지 + 텍스트 상태 라벨 병기(색·움직임만으로 상태를 전달하지 않는다).
**시험**: (1) 상태 원천 → 오브 상태 순수 함수 표 시험(원천 없음=정지, 원천 충돌 시 우선순위 표), (2) 무작위 상태 주입 시 기록과 다른 상태를 그리지 못함, (3) 움직임 줄이기·다크/라이트, (4) 400/768/1440 캡처와 프레임 비용(모션 켜짐 상태에서 유휴 CPU 측정치 기록, 임계값 지어내지 말고 측정치만), (5) `VENDOR.md` 해시가 실제 파일과 일치.
**수용**: 실제 격리 코어 미션 1건이 planning→executing→verifying→완료로 흐르는 동안 헤더 오브가 working→solving→정지로 바뀌고, 기록과 화면이 일치하는 캡처 3장.

## B. 정찰 도구 후보 — Agent Reach (커넥터 패널 등록만)

Agent Reach는 CLI+스킬 형태(MIT, 공식 README: Twitter/X, Reddit, YouTube, Bilibili, XiaoHongShu, Facebook, Instagram, LinkedIn, GitHub, 웹, RSS, Exa 검색 / 일부는 쿠키 내보내기 필요 / 설치는 "URL을 에이전트에 붙여넣기"). BLACKHOLE에서는:
1. CP1 레지스트리에 `agent-reach` 커넥터 서술자 추가(kind: `scout`, mode: `process`, `implemented:false`, status `not_implemented`). 실제 검사·설치·실행 코드는 이 지시서에서 **만들지 않는다**.
2. 서술자에 정책을 명시: 설치는 소유자가 버전·해시를 고정해 직접 수행 / 쿠키·로그인 정보는 소유자만 입력 / 첫 범위는 공개 소스(GitHub, RSS, 웹, YouTube 자막)만 / 소셜 플랫폼 수집은 이용약관·계정 위험 때문에 소유자 별도 승인 / 출력은 항상 "발견 단서(데이터)"이며 근거 검증기를 통과해야 초안이 된다 / 에이전트가 URL 지시로 스스로 설치하는 경로는 금지.
3. S11 정찰자 `toolScope` 표에 "agent-reach(공개 소스 한정)"를 **후보 항목**으로만 적는다(비활성).
**시험**: 서술자 스키마·`not_implemented` 표시·비밀 필드 없음·기존 30개 후보 회귀 없음.

## C. 측정 실험 층 — SEO · 카드뉴스 · 판매 흐름 (S9에 연결, 주장 대신 실험)

목적: "이 릴의 방법이 통하는가"를 릴의 숫자가 아니라 **소유자의 실제 측정값**으로 시험한다.
- **가설 기록**: `reference-claim`에서 파생한 실험 가설을 `experiment`로 저장(가설 문장, 측정 지표, 사용할 출처 유형, 시작일). 가설은 참·거짓이 아니라 "미검증".
- **측정 출처(S9 계약 재사용, 새 지표·권한 금지)**: 소유자 사이트의 검색 성과는 공식 검색 콘솔 읽기 전용 API(`analytics_platform`, `fame.views` 등 기존 지표)로, 게시물 도달·팔로워는 해당 플랫폼 공식 읽기 API(`publication_platform`, `fame.followers`), 수익은 결제·정산 플랫폼 읽기 전용(`wealth.revenue`). 어느 것도 소유자 키 입력 전에는 `needs_owner`. 소유자는 이미 제휴 수익 트랙(토스 쉐어링크, 다음 채널)을 운영 중이므로 첫 실험 후보는 그쪽으로 한다(소유자 선택).
- **콘텐츠 초안**: 색욕(창조)이 카드뉴스/글 **초안**을 `absorb-inbox`(kind `content-draft`, 저장 먼저)에 만들 수 있으나 게시·전송·계정 조작은 하지 않는다. 게시는 소유자 직접.
- **정산**: 실측값이 원장에 찍히기 전에는 욕망 v3 정산에서 "충족"으로 셈하지 않는다(산출물 참조만 확인 표시). 결과가 나오면 가설에 "관측 결과"만 붙이고, 통했다/안 통했다를 점수화하지 않는다.
- **하지 않는 것**: Shopify/광고/결제 계정 생성·상품 등록·광고비 집행·남의 홍보 영상 재사용·자동 게시. 판매 흐름은 **조사·초안·측정**까지만.
**시험**: 실험이 실측 출처 없이 성공으로 표기되지 않음, 소유자 키 없으면 `needs_owner`, 콘텐츠 초안이 게시 경로를 갖지 않음, 가설이 원장 등급에 영향을 주지 않음.

## D. 보류 목록(구현하지 않음, 기록만)

`docs/BLACKHOLE_PARKED_IDEAS.md`(신규, 짧게)에 다음을 사유와 함께 남긴다: **SPECS 교육 AR / CLAD** — Snap 전용 기기와 Lens Studio가 필요하고 기기 구매가 소유자 결정. 공식 자료(developers.specs.com CLAD 문서, Lens Studio AI 개발자 모드)가 있으므로 "공간 UI" 미래 항목. **홀로그램 손동작 영상** — 원 출처·작동 진위 미확인, 채택 근거 없음(연출 참고만 가능). **드롭쉬핑 자동화** — 계정 생성·결제·광고비는 소유자 전용 행동이라 자동화 금지.

## 순서와 보고

이 지시서 안 순서: 저장(`reference-claim`, `experiment`, `content-draft` 백업 허용 목록 + 옛 상태·옛 암호화 백업 복원 시험 먼저) → 0장 실제 확인 → A → B → C의 가설/초안 저장(측정 어댑터는 S9에서) → D. 전체 회귀는 추가하지 말고 charter의 다음 회귀 시점에 합산. 새 §번호(쓰기 직전 grep), VERIFIED / RAN-UNVERIFIED / BLOCKED, 산출물 SHA-256. 릴 원문 캡처나 영상은 저장소에 복사하지 마라(요약과 주소만).
