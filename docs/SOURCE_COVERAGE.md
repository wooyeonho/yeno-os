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

## Canonical project intake (PR #36)

- 역사 레지스트리의 canonical project ID 50개(C00/C01, E01–E09, V01–V11, A01–A05, B01–B04, B04-01–B04-13)가 `runtime/lib/canonical-intake.mjs`에 보존되어 있다.
- `POST /api/sources/import-canonical-intake`를 owner가 호출하면 기존 `state.sources` 하나에 URL 없는 `sourceLocator` 자료로 추가된다.
- 호출 전 자동 등록은 없다. 호출 후에도 각 항목은 `readingStatus=unread`, `decision=pending`이며 구현·검토·배포 완료가 아니다.
- 반복 호출·재시작은 같은 ID를 재사용하고, 사용자 편집을 덮어쓰지 않는다.
- **실제 CI가 잡아낸 검색 정확성 결함(수정됨)**: `GET /api/sources?q=<code>`가 코드 하나당 정확히 1건이 아니라 여러 건을 반환하는 비결정적 버그가 있었다(CI에서는 E04, 로컬 재현에서는 실행마다 A03/B02/B04로 다르게 나타남). 원인 둘: ① `sourceMatches()`가 `source.id`(무작위 UUID)까지 부분일치 대상에 넣어서, 짧은 코드가 우연히 다른 레코드 UUID의 부분 문자열이 되면 결과가 실행마다 달라졌다. ② `aliases`도 부분일치였는데, 계층 코드의 부모가 자식 코드의 접두어라("B02"는 "B02-1".."B02-6"의 접두어, "B04"도 동일) 부모 코드 검색이 모든 자식까지 끌어왔다. `runtime/public/source-reference-labels.mjs`에서 `id`/`aliases`/복원된 참조명은 전체 일치로, 자유 텍스트(title/summary/sourceLocator/url)는 기존처럼 부분일치로 수정했다. 부수적으로 `runtime/lib/canonical-intake.mjs`의 B04-01~13 summary가 부모 코드 "B04"를 문장에 그대로 반복해 같은 종류의 충돌을 추가로 만들고 있어 표현을 정리했다. 수정 후 `canonical-intake.test.mjs`를 5회 반복 실행해 결정적으로 통과함을 확인했다.
- PR #36 exact-head CI: 수정 커밋 `f13d4cd`에서 실제 조회함 — developer-worker run #105(`id:35513051558`), `status:completed`, `conclusion:success`. 아티팩트 `sha256:807a030ae9cbb9f13f28793009ffc555293d9b58c51fcbddba1ba475434b63e4`.

## R2 — ALL/NOW/QUEUED/BLOCKED/AGING가 실제 API·UI에서 동작함 (PR #37)

- 자료 탭(web)에 실제 select(ALL/NOW/QUEUED/BLOCKED/RETIRED)와 AGING 전용 체크박스를 추가했다. 서버 `GET /api/sources?view=&aging=`가 쓰는 것과 **같은** `sourceBucket()` 함수를 호출한다(로직 분리 없음 — `sources.mjs`가 `source-reference-labels.mjs`에서 재수출).
- `runtime/test/r2-search-coverage.test.mjs`(신규)가 실제 HTTP로 확인: 13개 필수 검색어 전부 + 표본 canonical 코드(C00, C01, E01, B04-13, V11) 전부가 `GET /api/sources?q=`로 유일하게 검색되고, 모두 `decision:pending`이며, 실제 bucket(대부분 QUEUED, `implementationStatus:tested`인 A03/B02-4만 NOW)에 정확히 들어가고, 재시작 후에도 유지됨을 확인했다.
- Android는 자료 관련 코드가 없어(이전 checkpoint에서 확인됨) 이번 검색 UI 변경의 대상이 아니다.

## 아직 registry에 없는 것

- 원본 49개 canonical project(C00~V11) 전체와 §4.3/§4.4의 나머지 intake 항목들은 이번 slice에서 import하지 않았다. `docs/CLAUDE_EXECUTION_STATE.md`의 NEXT SINGLE ACTION 참고.
- 다른 세션·개인 SNS 저장함의 원문은 이번 세션에서 읽지 않았다. "전체"라고 주장하지 않는다.
- `docs/ALL_PROJECTS_AND_SOURCES_20260911.md` 등 기존 문서에 이름이 있던 프로젝트들도 실제 `state.sources`/`state.projects`에 기계적으로 반영되기 전까지는 "등록됨"이 아니다.
