# BLACKHOLE reference absorption ledger — 2026-09-17

## 판정 원칙

소셜 링크는 기능의 증거가 아니라 탐색 단서로 취급한다. 영상의 설명·댓글·조회수는 공식 문서, 저장소, 재현 시험보다 낮은 신뢰도로 기록한다. 링크의 내용을 복제하거나 자동 게시하지 않고, 다음 네 가지를 분리한다.

- 관찰: 링크에서 실제로 확인한 내용
- 채택 후보: BLACKHOLE 설계에 반영할 수 있는 패턴
- 연결 상태: 현재 저장소에 구현·시험·외부 연결이 되었는지
- 경계: 권리, 비용, 개인정보, 보안, 금융·외부 쓰기 위험

쿼리 추적값('igsi', 'stkn', 'xmt', 'slof')은 원장에 저장하지 않고 canonical URL만 기록했다.

## 사용자가 보낸 링크 판정

| 링크 | 관찰 | 판정 |
|---|---|---|
| [Instagram Dbo6MdKB2RD](https://www.instagram.com/reel/Dbo6MdKB2RD/) | Times Square 전망대·연말 장면. 제품 기능이나 에이전트 패턴은 확인되지 않음. | 'discard' — BLACKHOLE 기능 흡수 대상 아님 |
| [Instagram Dcss_d0zqn1](https://www.instagram.com/reel/Dcss_d0zqn1/) | Claude와 Firecrawl MCP로 웹 정보를 수집·정리하는 튜토리얼로 보임. 원본 영상은 로그인/연령 제한으로 전문 재현 불가. | 'adopt_candidate' — Firecrawl 공식 MCP를 근거로 웹 수집 어댑터만 설계 |
| [Threads share BAVbqbnjbv](https://www.threads.com/share/BAVbqbnjbv/) | @after.yong 게시물로 리디렉션되며 Google ARTEMIS와 Android 자동 조작을 소개. | 'adopt' — [Google ARTEMIS](https://github.com/google/artemis) 기반 기기 제어 계약. 실제 기기 연결은 별도 시험 필요 |
| [Instagram DdNvXHnHyIt](https://www.instagram.com/p/DdNvXHnHyIt/) | 정치·밈성 캐러셀로 확인됨. | 'discard' — 저장·재배포하지 않음 |
| [Instagram DdN-W10Do2R](https://www.instagram.com/reel/DdN-W10Do2R/) | MiniMax H3 Max를 이용해 끝나지 않는 AI 영상 스트림을 만드는 사례. | 'adopt_candidate' — [fal H3 Max](https://fal.ai/minimax-h3-max)와 [fal.live](https://fal.live/)를 공급자 계약의 근거로만 채택. 유료 호출은 연결하지 않음 |
| [Instagram Dcz0wO7S715](https://www.instagram.com/reel/Dcz0wO7S715/) | 해외 취업·자격증 자료 나눔 콘텐츠. | 'observe' — 제품 런타임 기능으로 흡수하지 않음 |
| [Instagram DdTJFJwGmch](https://www.instagram.com/p/DdTJFJwGmch/) | AI 관련 자격증 티어표. 검증된 런타임 능력의 증거는 아님. | 'observe' — 교육·커리어 주장으로만 분류 |
| [Instagram DdVP8OfH4DZ](https://www.instagram.com/p/DdVP8OfH4DZ/) | 19세 크리에이터의 수익화 사례 주장. 독립 검증된 재무 자료가 아님. | 'hypothesis' — 성장 실험 아이디어로만 기록. 수익 보장·복제 전략으로 사용하지 않음 |
| [Threads DdVYJDyDFVh](https://www.threads.com/@usa.mminz/post/DdVYJDyDFVh) | Meta Ad Library에서 공개 파트너십 광고를 찾아 세그먼트하는 리서치 방법. | 'adopt_candidate' — 공개 광고 관찰과 수동 검토만 허용. 대량 스크래핑·스팸·자동 접촉 금지 |
| [Instagram DdTSFLop4h2](https://www.instagram.com/reel/DdTSFLop4h2/) | “비밀 코드”라는 표현의 프롬프트·이미지·영상 제작 레시피. 비밀 기능이라는 주장은 확인되지 않음. | 'adopt_candidate' — 창작 레시피 메타데이터만 보관. 원본 이미지·음원·브랜드 자산 복제 금지 |
| [X mad_dogdebt](https://x.com/mad_dogdebt/status/2100138584476901382) | QQQI 분배금으로 월 현금흐름을 만드는 계산 주장. 커버드콜·원금 감소 위험이 있음. | 'guardrail' — 금융 주장 검증 큐에만 기록. 자동 매매·투자 권유·자금 이동 금지 |
| [Instagram DdLi5_4FWxC](https://www.instagram.com/reel/DdLi5_4FWxC/) | AutoResearch가 아이디어부터 실험·논문용 근거까지 자동화한다는 소개. | 'adopt' — [AutoResearch](https://github.com/EvoMap/AutoResearch)의 복구 가능한 연구·근거·실패 보존 패턴 채택 |

## 공식 자료에서 흡수할 설계

| 원천 | 흡수할 패턴 | BLACKHOLE 연결 상태 |
|---|---|---|
| [xAI Grok Bot](https://x.ai/bot), [설계 원칙](https://x.ai/news/designing-grok-bot) | 영속적인 정체성·기억·도구·루틴·인계. 봇이 여러 개여도 역할과 권한을 분리. | 이번 브랜치에 선언적 봇 원장과 승인 대기 인계 계약을 추가. 실제 Grok Bot 제품 연결은 NOT_WIRED |
| [Google ARTEMIS](https://github.com/google/artemis), [AndroidWorld](https://google-research.github.io/android_world/) | 자연어 Android 작업, 멀티모달 타깃팅, MCP, 로그·스크린샷, 독립적인 기기 시험. | NOT_WIRED; Android 기기·ADB·접근성 서비스·실측 결과가 없으므로 성공을 주장하지 않음 |
| [Firecrawl MCP](https://github.com/firecrawl/firecrawl-mcp-server) | 검색·스크랩·구조화 추출·재시도·레이트리밋·self-hosted 경계. | NOT_WIRED; API 키·요금·도메인 허용 목록 없이는 외부 호출하지 않음 |
| [fal H3 Max](https://fal.ai/minimax-h3-max), [fal.live](https://fal.live/) | 영상 공급자를 로컬 렌더러와 분리하고 비용·권리·중단·결과 해시를 기록. | NOT_WIRED; 현재 기본 영상 경로는 안전한 로컬 렌더러이며 유료 모델 호출 0 |
| [AutoResearch](https://github.com/EvoMap/AutoResearch) | 상태 저장·복구, 다중 모델 검토, 파일럿 후 확장, 음성 결과와 실패 결과 보존. | 기존 EUREKA/연구·근거 장부와 결합 후보. 연구 실행은 별도 provider·실험 검증 필요 |
| [Buzz](https://github.com/block/buzz) | 소유한 relay, 서명 이벤트, 채널/방, 감사 로그, 작업·리뷰·병합 근거. | 전체 Buzz 설치는 보류. 이벤트·인계·감사 개념만 흡수; 외부 relay 없음 |
| [X 게시물](https://x.com/mad_dogdebt/status/2100138584476901382) | 고수익 주장의 계산을 검증 대상으로 만드는 사례. | 금융 실행 권한으로 확장하지 않음 |

## 이번 후속 브랜치에서 실제로 바뀐 것

- runtime/lib/persistent-bots.mjs
  - Jarvis, Scout, EUREKA, Studio, Growth, Guardian의 역할·도구 범위를 고정한다.
  - 기억은 source, decision, constraint, result, risk로 분류하고 출처 URL·신뢰도·처분 상태를 함께 보관한다.
  - 루틴은 선언만 가능하며 enabled:false, status:not_wired를 강제한다.
  - 봇 간 인계는 awaiting_owner로만 기록되고 자동 실행되지 않는다.
  - HTTPS 출처만 허용하고, 임의 필드·자격증명·외부 쓰기 권한을 저장하지 않는다.
- runtime/test/persistent-bots.test.mjs
  - 원장 경계, HTTPS 출처, 비밀정보 필드 거부, 루틴 비활성, 소유자 승인 인계를 검증한다.

## 현재 “먼치킨” 상태를 사실대로 표현하면

BLACKHOLE은 여러 참고 시스템의 아이디어를 하나의 안전한 운영 계약으로 묶는 단계까지 왔다. 하지만 다음은 아직 실제 능력이 아니다.

- Grok Bot 제품에 로그인하거나 여러 클라우드 컴퓨터를 운용하는 것
- Android 휴대폰을 조작하고 99% 성공률을 재현하는 것
- Firecrawl·fal·외부 LLM의 라이브 API를 사용해 돈을 쓰는 것
- Buzz relay를 운영하거나 외부에 게시·영업·거래하는 것
- 콘텐츠 조회수·팔로워·수익을 보장하는 것

다음 실측 순서는 정적 테스트 → 격리된 AndroidWorld/ARTEMIS 시험 → 키 없는 웹 수집 fixture → 로컬 영상 결과 해시 → owner 승인 후 단일 staging provider다. 각 단계는 성공률·비용·실패·복구 방법을 남긴 뒤에만 다음 단계로 올라간다.


## Reddit 교차 확인

Reddit은 공식 증거가 아니므로 낮은 신뢰도의 운영 신호로만 사용했다.

- [r/AIDeveloperNews — ARTEMIS 소개](https://www.reddit.com/r/AIDeveloperNews/comments/1wdh8ar/google_has_opensourced_artemis_an_ai_android/)는 MCP 연결과 로그·스크린샷 중심의 사용 관점을 재확인하지만, 99%+ 수치는 원 저장소/독립 시험으로 다시 확인해야 한다.
- [r/mcp — 에이전트 권한을 어떻게 시험하는가](https://www.reddit.com/r/mcp/comments/1wbzkpb/how_do_you_test_that_an_ai_agents_permissions/)의 제안인 “초안은 허용, 승인된 수신자에게 보내기는 사람 승인, 차단 대상은 거부, 대량 export는 거부”를 Guardian의 승인·거부 규칙으로 흡수했다.
- [r/AI_Agents — 코드와 오케스트레이션의 경계](https://www.reddit.com/r/AI_Agents/comments/1w9vymt/did_claudecodex_actually_replace_no_code_tools_or/)는 코드의 로직과 워크플로 계층의 트리거·재시도·자격증명·관찰성·인계를 분리하자는 실무 신호를 제공한다. 이 때문에 이번 구현에서 루틴을 실행 코드가 아니라 선언형 원장으로 두었다.

이 교차 확인으로 추가한 것은 권한 경계와 감사 항목뿐이며, Reddit 게시물의 제품·성공률·수익 주장을 사실로 승격하지 않았다.
