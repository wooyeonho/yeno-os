# BLACKHOLE Source/Keyword Coverage — evidence snapshot

이 문서는 runtime DB가 아니라 개발 증거다. 실제 코드(`runtime/lib/sources.mjs`)가 하는 일을 요약할 뿐, 이 문서에 적힌 것 자체가 registry 상태를 바꾸지 않는다.

## 필수 검색 사례 (BLACKHOLE_CLAUDE_CODE_EXECUTION.md §C)

아래 13개 검색어는 `POST /api/sources/seed-required-intake`(owner 명시 호출, 멱등)가 등록하면 `GET /api/sources?q=<검색어>`로 실제 찾을 수 있음을 `runtime/test/single-ledger-intake.test.mjs`의 실제 HTTP 시험으로 확인했다.

| 검색어 | entity | 실제 URL 존재 | 비고 |
|---|---|---|---|
| 자동매매 | RND | 없음 (topic-only) | 관찰→백테스트→모의투자만 후보 |
| 엔화 | RND | 없음 (topic-only) | 사용자 원문 확인, FX 전략은 assistant 제안(미확정) |
| 당근 | OPS | 없음 (topic-only) | |
| 식물로봇 | HW | 없음 (topic-only, alias) | PhytoMotive의 별칭 |
| PhytoMotive | HW | 없음 (topic-only) | |
| Scrapagotchi | HW | 없음 (topic-only) | |
| 음식물쓰레기 | HW | 없음 (topic-only, alias) | Scrapagotchi의 별칭 |
| 다마고치 | HW | 없음 (topic-only, alias) | Scrapagotchi의 별칭 |
| 산양게임 | IP | 없음 (topic-only) | 사냥게임 아님 |
| 코리아타운 | IP | 없음 (topic-only, alias) | 코리아타운 청소게임의 별칭 |
| 소설 | IP | 없음 (topic-only, alias) | B04 소설 IP 스튜디오의 별칭 |
| God Eye | SYS | **있음** | `https://instagram.com/reel/DcjMGA9vHxU` — `absorption-routing.mjs`의 기존 world 분류가 이미 이 URL을 실제 검토함 |
| Grok | REF | 없음 (topic-only, alias) | Grok Bot의 별칭. native Grok Bot과 xAI Grok API는 별개 |

검색 성공은 기능 구현 성공이 아니다 — 위 항목은 모두 `decision:pending`, 대부분 `implementationStatus:idea`로 등록되며, 실제 구현·시험·채택은 각자 별도 slice가 필요하다.

## 아직 registry에 없는 것

- 원본 49개 canonical project(C00~V11) 전체와 §4.3/§4.4의 나머지 intake 항목들은 이번 slice에서 import하지 않았다. `docs/CLAUDE_EXECUTION_STATE.md`의 NEXT SINGLE ACTION 참고.
- 다른 세션·개인 SNS 저장함의 원문은 이번 세션에서 읽지 않았다. "전체"라고 주장하지 않는다.
- `docs/ALL_PROJECTS_AND_SOURCES_20260911.md` 등 기존 문서에 이름이 있던 프로젝트들도 실제 `state.sources`/`state.projects`에 기계적으로 반영되기 전까지는 "등록됨"이 아니다.
