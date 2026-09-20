# BLACKHOLE Claude Code 단독 실행 — 진행 상태 (checkpoint)

이 문서는 runtime DB가 아니라 개발 증거다. `BLACKHOLE_CLAUDE_CODE_EXECUTION.md` 2장(Claude Code 단독 실행 지시 — 현행 작업 계약)의 §G 형식을 따른다.
작성 시각: 2026-09-20. 이 문서 자체는 GitHub를 새로 조회한 결과가 아니라, 아래 표에 적은 실제 조회 시각의 스냅샷이다.

## 1. 실행 계약 확인 (R0)

- `BLACKHOLE_CLAUDE_CODE_EXECUTION.md`를 읽고, 1~3장(현행 Claude Code 단독 실행 계약)이 4장 이하 부록(역사 원문)보다 우선함을 확인했다.
- `git status --short` / `git branch --show-current` / `git log -12 --oneline --decorate` / `git diff --stat`을 실행해 실제 작업 트리 상태를 확인했다 (변경 없음, clean, 이전 세션이 남긴 `blackhole/grok-provider-adapter-claude-20260920` 브랜치 위).
- GitHub API로 PR #26~#34 및 이후 PR을 재조회했다 — 실제 Open 18개, Closed는 별도 미조회(범위 밖). PR #33(semantic verification), #34(Grok adapter)는 실제로 존재하며 CI green 상태를 재확인했다(§2 표). 다시 만들지 않았다.
- Issue #25 최신 상태를 조회했다 — 마지막 댓글은 이전 세션이 남긴 PR #34 보고이며, 소유자의 새 지시는 없었다.

## 2. 현재 branch/base/head/PR

| 항목 | 값 |
|---|---|
| BASE | `blackhole/grok-provider-adapter-claude-20260920` @ `4df6ec8e36e2320f3fcba976c0845291dd702282` (실제 조회한 PR #34 exact green head) |
| BRANCH | `blackhole/single-ledger-intake-claude-20260920` |
| PR | 이 커밋 직후 PR #34 브랜치를 base로 하는 새 stacked Draft PR로 연다 (Issue #25 보고에 실제 번호 기록) |
| 대상 slice | R1 — 단일 원장(source registry)에 URL 없는 프로젝트/키워드(topic-only intake)를 보존하고 검색 가능하게 함 |

## 3. 구현한 동작 / 기존 엔진 연결

기존 `runtime/lib/sources.mjs`(state.sources, 이미 존재하는 canonical registry)를 그대로 재사용했다. 두 번째 DB·엔진을 만들지 않았다.

- `sourceLocator`: 확인된 외부 URL이 없는 항목(예: 자동매매, 엔화 원요청)을 위한 `url`의 대안 필드. 생성 시 `url`/`sourceLocator` 중 정확히 하나만 허용.
- `aliases`, `entityType`(SYS/APP/OPS/IP/HW/RND/REF/UNRESOLVED), `implementationStatus`(idea/scoped/queued/coding/tested/live/blocked/retired), `origin`(user/assistant/external) — `readingStatus`/`decision`과 완전히 분리된 필드. 서로 추론하지 않는다.
- `sourceBucket()`: ALL/NOW/QUEUED/BLOCKED/AGING 계산. AGING은 14일 경과 경고 플래그일 뿐 별도 차단 게이트가 아니다.
- `planRequiredIntakeSeed()` + `POST /api/sources/seed-required-intake`: 필수 검색 사례(자동매매, 엔화, 당근, 식물로봇, PhytoMotive, Scrapagotchi, 음식물쓰레기, 다마고치, 산양게임, 코리아타운, 소설, God Eye, Grok)를 **owner가 명시적으로 호출해야만** 등록하는 멱등 액션으로 구현했다 — `openStore()`가 매번 자동으로 주입하는 마이그레이션이 아니다(처음에는 그렇게 구현했으나, 기존 테스트 스위트 전체의 소스 개수 단정을 깨뜨려 되돌렸다 — 모든 신규/테스트 스토어에 소유자가 요청하지 않은 콘텐츠를 자동 주입하는 것은 이 코드베이스의 "명시적 승인 없이 범위를 넓히지 않는다" 원칙에 맞지 않는다고 판단).
- `GET /api/sources?view=&aging=&q=`: 기존 인증된 목록 API에 추가한 선택적 파라미터. 파라미터를 생략하면 기존 응답과 완전히 동일(하위 호환).
- `migrateLegacySource()`: 기존 저장소/백업의 URL 기반 레코드에 새 필드의 정직한 기본값을 채우는 additive migration. `store.mjs`/`backup.mjs` 양쪽에서 검증 직전에 실행.
- `runtime/public/source-reference-labels.mjs`의 `sourceMatches()`가 `aliases`/`sourceLocator`도 검색하도록 확장 (서버·브라우저 공유 파일).
- `runtime/public/app.js`: source 카드가 `url` 없는 항목에서 깨지지 않고 `sourceLocator`/`aliases`를 표시하도록 렌더링 보강. `apps/controller`(Android)는 source 관련 코드가 전혀 없음을 확인 — 이번 slice에서 변경 불필요.

### 변경 파일
`runtime/lib/sources.mjs`(신규 함수·필드), `runtime/lib/store.mjs`(migrateLegacySource 배선), `runtime/lib/backup.mjs`(동일), `runtime/server.mjs`(seed 라우트, view 필터, addSource dedup), `runtime/public/source-reference-labels.mjs`, `runtime/public/app.js`, `runtime/test/sources.test.mjs`(기존 fixture에 새 필드 반영), `runtime/test/backup.test.mjs`(동일), `runtime/test/single-ledger-intake.test.mjs`(신규).

## 4. 실제 검사 / 기존 실패와 신규 실패 / exact-head CI

- `node --test runtime/test/sources.test.mjs`: 9/9 pass.
- `node --test runtime/test/backup.test.mjs`: 11/11 pass.
- `node --test runtime/test/single-ledger-intake.test.mjs`(신규): 8/8 pass.
- `npm test`(전체 951개): 921 pass · 23 fail · 7 skip. 실패 23개는 이 slice 이전부터 있던 것과 정확히 동일한 목록(QuickJS/WASM 샌드박스 네이티브 모듈 부재, `URLPattern` 스크립트 테스트) — **신규 실패 0개**. base(4df6ec8)의 실패 목록과 대조했다.
- `node scripts/verify-web-ui.mjs`: 통과(구조 검사, JSDOM).
- exact-head CI(developer-worker): 이 커밋을 push한 뒤 실제 조회하여 Issue #25 보고에 실행 ID·conclusion을 기록한다. 이 문서 작성 시점에는 아직 push 전이므로 **pending**으로 기록한다.

## 5. STRUCTURAL / SYNTHETIC / LIVE / PHYSICAL

- STRUCTURAL: 스키마 검증(정확히 하나의 url/sourceLocator, aliases 경계, 불변 필드), dedup 로직, bucket 계산 — 전부 실제 로컬 시험 통과.
- SYNTHETIC: 실제 HTTP 서버 + 실제 디스크 스토어로 생성·검색·재시작·시딩 왕복 확인 (provider/model 호출 없음, 필요하지도 않음).
- LIVE: 해당 없음 — 이 slice는 외부 provider나 실기기 요소가 없다.
- PHYSICAL: 해당 없음 — backend-only, Android APK 빌드 없음(§F에 따라 명시).

## 6. ARTIFACT / APK / HASH

- APK: 없음 — backend + web(runtime/public) 변경만. `apps/controller` 변경 없음.
- 개발자 워커 CI 아티팩트: push 후 실제 실행 ID/해시를 Issue #25 보고에 기록.

## 7. 보안·권리 확인 범위 / 미확인 / 승인 필요

- 확인함: 새 라우트(`POST /api/sources/seed-required-intake`)는 기존 소스 라우트와 동일한 인증(기기 토큰 또는 owner pairing)만 요구하며 별도 결제·외부 게시·계정 연결이 없다. 시딩되는 God Eye 항목은 기존 `absorption-routing.mjs`가 이미 검토한 실제 공개 URL을 재사용했을 뿐, 새로 조회하지 않았다.
- 미확인: 이 slice가 등록하는 각 항목(자동매매, 엔화 등)의 실제 라이선스·약관·개인정보 조건은 검토하지 않았다 — 등록은 이름·분류 보존일 뿐 채택이 아니다.
- 승인 필요: 없음(production 미접근, 결제 없음, 외부 게시 없음).

## 8. 원요구 backlog 상태 (요구 보존 대조표)

| 원요구 검색어 | 상태 | 비고 |
|---|---|---|
| 자동매매 | registry (RND, pending) | 관찰→백테스트→모의투자만 후보 범위로 명시 |
| 엔화(JPY) | registry (RND, pending) | FX 전략은 assistant 제안이었음을 summary에 명시, 미해결 원문으로 보존 |
| 당근 인플루언서 | registry (OPS, pending) | |
| PhytoMotive/식물로봇 | registry (HW, pending) | |
| Scrapagotchi/다마고치/음식물쓰레기 | registry (HW, pending) | 세 검색어를 alias로 한 entity에 연결(동일 실체) |
| 산양게임 | registry (IP, pending) | "사냥게임" 교정 없음 |
| 코리아타운 청소게임 | registry (IP, pending) | |
| 소설(B04) | registry (IP, pending) | |
| God Eye | registry (SYS, pending) | 실제 확인된 URL(`instagram.com/reel/DcjMGA9vHxU`) 기반, absorption-routing.mjs의 기존 world 분류 재사용 |
| Grok Bot | registry (REF, pending) | native 앱과 xAI API 별개임을 summary에 명시 |

전체 49+1 canonical project 목록의 완전한 import는 이번 slice 범위 밖이다(다음 단일 작업 참고).

## 9. ROLLBACK

`git revert`로 이 브랜치의 커밋을 되돌리면 `sources.mjs`/`store.mjs`/`backup.mjs`/`server.mjs`/`app.js`/`source-reference-labels.mjs`가 PR #34 head 상태로 복원된다. 이 slice는 additive-only(새 필드는 전부 optional·기본값 존재, 새 라우트는 신규 경로)이므로 기존 저장된 데이터를 파괴하지 않는다 — revert 후에도 이 slice가 등록한 소스 레코드가 남아있을 수 있으나(디스크에 저장된 경우) `validateSourceRegistry`가 새 필드를 모르는 채로 재실행되면 실패하므로, revert 시에는 반드시 같은 커밋의 `migrateLegacySource` 제거도 함께 되돌려야 한다(단일 커밋이므로 자동으로 함께 되돌아간다).

## 10. BLOCKER

없음. owner 승인이 필요한 지점은 없다.

## 11. NEXT SINGLE ACTION

전체 49+1 canonical project(§4.2)와 §4.3의 나머지 intake 항목들을 동일한 `sourceLocator` 패턴으로 실제 registry에 소유자 승인 하에 일괄 import하는 `POST /api/sources/import`(이미 존재, url 필수라 topic-only 항목은 현재 거부됨 — `planSourceImport`/`validateSourceInput`도 sourceLocator를 받아들이도록 확장 필요)를 잇는 R1 후속 작업. 그 다음 R2(semantic verifier 보강 필요 여부 판단, Shadow UI를 PR #33/#34 head 위에 재적용)로 진행한다.

즉시 실행 가능한 명령:
```
git checkout blackhole/single-ledger-intake-claude-20260920
npm test
```

## 12. R1 canonical intake follow-up (PR #36)

- 실제 base: `blackhole/single-ledger-intake-claude-20260920` @ PR #35 exact head `f2c7538631c4551bf9505f2ced5579876c234d9f`.
- branch: `blackhole/canonical-intake-import-claude-20260920`.
- PR: #36 Draft/Open. 구현·테스트 커밋은 `74783810785cc93ea021f8223705fb58660773b8`; 이후 이 checkpoint 문서 커밋이 추가되었으므로 최종 head는 PR #36 메타데이터를 기준으로 확인한다.
- PR #35에서 이미 `planSourceImport()`가 `sourceLocator`를 받으므로 중복 구현하지 않았다.
- `runtime/lib/canonical-intake.mjs`가 역사 레지스트리의 50개 ID를 명시적으로 보존한다.
- `POST /api/sources/import-canonical-intake`는 owner 인증과 requestId를 요구하는 멱등·추가 전용 작업이다. 호출 전에는 registry를 자동으로 바꾸지 않는다.
- 모든 레코드는 URL 없는 `sourceLocator`, `readingStatus=unread`, `decision=pending`으로 시작한다. 이는 구현·검토·배포 완료가 아니다.
- 새 테스트는 50개 고유 ID, 검색 가능성, 반복/재시작 후 중복 방지, 소유자 수정 보존, 인증·입력 경계를 검사한다.
- Android/APK는 변경하지 않았다. production·merge·외부 게시도 하지 않았다.

### PR #36 CI 실패 → 실제 원인 → 수정 (BLACKHOLE_CLAUDE_CODE_EXECUTION.md §2 지시대로 PR #36 범위 안에서 수정)

- exact-head CI(`74783810…`, run #104)가 실제로 **failure**였다: `runtime/test/canonical-intake.test.mjs`의 HTTP 시험이 `canonical ID must resolve exactly once: E04`(2 !== 1)로 실패. 통과했다고 보고하지 않고 job 로그를 실제로 받아 원인을 추적했다.
- 로컬 반복 실행에서 매번 다른 코드가 충돌해(A03, B02, B04 …) 비결정적 버그임을 확인 — 근본 원인 둘:
  1. `runtime/public/source-reference-labels.mjs`의 `sourceMatches()`가 `source.id`(무작위 UUID)를 부분일치 대상에 포함해, 짧은 코드가 우연히 다른 레코드의 UUID 부분 문자열이 되면 실행마다 다른 오탐이 발생했다.
  2. 같은 함수의 `aliases`/복원된 참조명도 부분일치였는데, "B02"가 "B02-1".."B02-6"의 접두어이고 "B04"가 "B04-01".."B04-13"의 접두어라서 부모 코드 검색이 모든 자식 코드까지 끌어왔다.
  3. 부수적으로 `runtime/lib/canonical-intake.mjs`의 B04-01~13 `summary`가 부모 코드 "B04"를 문장에 그대로 반복해(부분일치 대상인 summary 필드에서) 같은 종류의 충돌을 하나 더 만들고 있었다.
- 수정: `id`/`aliases`/참조명은 전체 일치로, title/summary/sourceLocator/url은 기존처럼 부분일치로 유지(자연어 검색은 그대로 동작). B04 계열 summary에서 중복된 코드 문구 제거.
- 검증: `canonical-intake.test.mjs`를 5회 반복 실행해 결정적 통과 확인. **실제 base 비교**: 이 브랜치의 수정 전 exact head(`e816e91`, 코드는 `74783810`과 동일)에서 실제로 `npm test`를 다시 돌려 954개 중 923 pass·24 fail(기존 23개 + 이 버그 1개)을 확보했고, 수정 후 같은 명령이 924 pass·23 fail(기존 23개와 정확히 동일한 이름)로 줄어드는 것을 직접 비교했다 — 신규 실패 0개, 추정치 없음.
- 수정 커밋: `f13d4cd0def59d1c8c1ba9ef9ca4fd502b899ef9`. push 후 exact-head CI(developer-worker) 결과는 Issue #25 보고에 실행 ID·conclusion으로 기록한다.

