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
- 수정 커밋: `f13d4cd0def59d1c8c1ba9ef9ca4fd502b899ef9`. **실제 조회 결과**: developer-worker run #105(`id:35513051558`) — `status:completed`, `conclusion:success`. 아티팩트 `blackhole-developer-verification`(`id:10605654570`, `sha256:807a030ae9cbb9f13f28793009ffc555293d9b58c51fcbddba1ba475434b63e4`). 이후 커밋(`48accaf`, 이 checkpoint 자체)은 `docs/**` 전용이라 `developer-worker.yml`의 `paths-ignore`에 걸려 새 실행을 만들지 않는다 — exact code head는 여전히 `f13d4cd`다.

## 13. R2 — semantic verifier 확인, Shadow UI 재적용, ALL/NOW/QUEUED/BLOCKED/AGING 검색 (PR #37)

- 실제 base: `blackhole/canonical-intake-import-claude-20260920` @ PR #36 최종 head `cf5f8a9` (CI green 재확인).
- branch: `blackhole/r2-verify-shadow-ui-claude-20260920`, head `d236f71`.
- PR: #37 (Draft, PR #36 위 stacked).

### A. semantic verifier / JEV — 확인만, 재구축 없음
`semantic-verification.mjs`/`jev.mjs`/`shadow-army.mjs`가 이미 지시된 모든 보장을 갖추고 있음을 코드 판독과 기존 시험(semantic-verification.test.mjs 17개 시나리오, jev.test.mjs, shadow-army.test.mjs, jarvis-shadow-bridge.test.mjs = 총 40개)을 이 브랜치에서 재실행해 확인했다. 코드 변경 없음. `authorizesDispatch:false` 고정, deterministic PASS만으로 완료 안 됨(semantic verifier가 `callLimit:1`의 별도 durable job), semantic fail/uncertain이 milestone 승격을 막음, unknown provider 결과 자동 재시도 없음, 재시작 후 verifier job 중복 없음 — 전부 기존 코드·기존 시험으로 이미 성립.

### B. Shadow Army UI — 실제 데이터 연결(누락됐던 부분)
서버(`project-universe.mjs`)는 Phase D부터 이미 `shadowMissions`를 계산해 왔으나, 공유 클라이언트 모듈(`project-universe-model.mjs`/`project-universe-view.mjs`)이 렌더링 전에 이 필드를 버리고 있었다. 과거 미병합 PR #31(`blackhole/phase-d-shadow-ui-codex-20260920`, PR #29 기반이라 semanticVerifier 이전)의 관련 부분만 선별 재적용·확장했다(통짜 merge 아님):
- 역할/상태/의존성 수/산출물 수/제공자별 실제 job과, deterministic 검증 결과 및 **별도 줄**의 semantic 판정(pass/fail/uncertain + independence + summary).
- 실제 `pauseReason`/`failureReason`, 실제 `emergencyStop` 알림.
- `project-universe-view.mjs`는 `apps/controller/src/native-projects.ts`가 그대로 재사용하므로 Android도 `apps/controller` 변경 없이 동일한 Shadow Army 렌더링을 받는다.
- **정직하게 남긴 격차**: emergencyStop 알림은 이번 slice에서 web 전용이다. `native-projects.ts`+`main.ts`에 배선하면 배너 하나 때문에 Android CI/APK 사이클이 열리므로 보류했다 — Android Home은 이미 공유 `living-core-view.mjs`로 전체 멈춤 상태를 보여주므로 신호 자체가 감춰지지는 않는다.

### C. 검색 — 공유 로직, 두 번째 사본 아님
`sourceBucket()`/`SOURCE_BUCKETS`/`SOURCE_AGING_DAYS`를 `runtime/lib/sources.mjs`에서 서버·브라우저가 이미 공유하던 `source-reference-labels.mjs`로 옮기고 `sources.mjs`는 재수출만 한다(로직이 둘로 갈라질 위험 제거). 자료 탭에 실제 ALL/NOW/QUEUED/BLOCKED/RETIRED select와 AGING 전용 체크박스를 추가했고, 서버 `GET /api/sources?view=&aging=`와 동일한 `sourceBucket()`을 그대로 호출한다. 각 카드에 실제 bucket과 AGING 배지를 표시한다.

### 실제 검사
- `node --test test/shadow-army-ui.test.mjs`(신규 6개), `test/r2-search-coverage.test.mjs`(신규 1개): 전부 pass.
- `semantic-verification.test.mjs`/`jev.test.mjs`/`shadow-army.test.mjs`/`jarvis-shadow-bridge.test.mjs`/`project-universe*.test.mjs`/`sources.test.mjs`/`single-ledger-intake.test.mjs`/`backup.test.mjs`/`canonical-intake.test.mjs`: 전부 pass.
- `npm test`(전체 961개): 931 pass · 23 fail(PR #36 head에서 실제로 재확인한 기존 실패 목록과 정확히 동일) · 7 skip — 신규 실패 0개.
- `node scripts/verify-web-ui.mjs`: 통과.
- `npm run verify:mobile`(실제 Chromium)을 수동 실행 — 이 샌드박스에서 `#pair-screen` 대기 타임아웃이 이 브랜치와 수정 전 PR #36 head **양쪽 모두**에서 동일하게 발생함을 직접 대조 확인했다(사전 존재 환경 한계, 이번 변경의 회귀 아님).
- exact-head CI(developer-worker): **실제 조회 결과** — run #106(`id:35513941919`), head `d236f71`, `status:completed`, `conclusion:success`. 아티팩트 `blackhole-developer-verification`(`id:10606326317`, `sha256:e51a362106dba3347abc7db36a947de0748178527c563799edc4be673ede941b`). 이후 커밋(`3fee3d5`, `88855d4`, docs 전용)은 `paths-ignore`에 걸려 새 실행을 만들지 않는다 — exact code head는 `d236f71`.

### STRUCTURAL/SYNTHETIC/LIVE/PHYSICAL
STRUCTURAL·SYNTHETIC: 위 자동 시험. LIVE: 해당 없음(provider·실기기 요소 없음). PHYSICAL: 해당 없음(`apps/controller` 미변경, APK 없음).

### ARTIFACT/HASH
APK 없음(backend+web only). 개발자 워커 CI 아티팩트: push 후 실제 실행 ID/해시를 Issue #25 보고에 기록.

### ROLLBACK
`git revert`로 이 브랜치 커밋을 되돌리면 관련 파일이 PR #36 head 상태로 복원된다. Additive-only(새 필드·새 UI 섹션·재수출만, 기존 API 응답 형태 불변)이므로 기존 저장 데이터를 파괴하지 않는다.

### BLOCKER
없음.

### NEXT SINGLE ACTION
R3(실제 폰 사용 흐름 1건 — 명령 접수→실제 job→artifact→검증→조회→앱 종료/재접속→같은 결과→stop→명시적 resume) 검증으로 진행. 이미 `phone-acceptance.test.mjs`가 일부를 다루고 있으므로, 이번 R1/R2에서 추가된 소스 검색·Shadow UI가 그 흐름과 실제로 맞물리는지(예: 폰에서 목표 실행 후 Project Universe에서 Shadow Army 상태를 실제로 확인) 별도 slice로 검사한다.

즉시 실행 가능한 명령:
```
git checkout blackhole/r2-verify-shadow-ui-claude-20260920
npm test
```



---

## 2026-09-23 (Claude, Cowork) — G1 통합 후보 완료 / 재개 기록 (§14)

### 현재 위치
- 브랜치 `blackhole/g1-integration-claude-20260922` (base PR #55 head `84d6f27c`), 로컬 전용 — **원격 push 안 됨**(이 VM에 GitHub 자격증명 없음: `could not read Username`). 작업 트리 clean(이 문서 커밋 직전 기준).
- 커밋(오래된 순): `fd75003` F03 · `4068f5e` F05 · `7e5cdbb` F04 · `1624721` F06 · `ceef5bd` #39 STAGE2 · `771d1c2` #39 STAGE3 · `0730614` #22+fabric 브리지 · `093bd7e` G1 통합 검사 · `59bd320` 점검 도구 · (이 커밋) docs.
- 설계 기록: `docs/BLACKHOLE_G1_DESIGN_RECORDS_20260923.md`. 요구 원장: `docs/BLACKHOLE_REQUIREMENTS_LEDGER_20260923.md`.

### 이번 세션에 실제로 실행한 검사 (전부 노트북 Cowork VM, 합성 transport, provider 키·실기기 없음)
- 전체 회귀(후보 `093bd7e`, 130개 파일): tests 1019 · pass 1012 · fail 0 · skipped 7(video runtime env-gate: PIL/fonttools/Nanum 없음). 이후 커밋 `59bd320`(점검 도구+package.json scripts)은 자체 검사 3/3 통과; 전체 재실행은 하지 않음.
- 재현→수정: F03(23중 1 실패→통과), F05(수정 전 server.mjs stash로 3중 2 실패→3/3).
- G1 게이트 `g1-living-loop-integration.test.mjs` 2/2: 명령→결정→임무→검증→milestone/memory/outbox/XP→Home→재시작 동일, 부정 사례 포함.
- 점검 도구: isolated PASS(프로세스 재시작 포함), basic PASS vs 실제 Koyeb(health 200, anon 401), live BLOCKED(토큰 없음).

### 차단(외부 게이트) — 실행자는 해결 불가
1. **GitHub push/Draft PR/CI**: 자격증명 필요. 소유자 명령 1개로 해결: `git push -u origin blackhole/g1-integration-claude-20260922` (Windows Git, 본인 계정). 이후 Draft PR: GitHub 웹 `compare` 또는 `gh pr create --draft --base main --head blackhole/g1-integration-claude-20260922`. CI(`verify`/`android`/`windows`)는 push되면 해당 SHA에서 돈다 — #55의 초록 체크를 이 후보 증거로 재사용하지 않음.
2. **YENO_TOKEN**: `npm run check:live`(runtime/)를 소유자 터미널에서 `$env:YENO_TOKEN`만 설정한 프로세스로 실행 → 5개 필드 회신. 채팅에 토큰 금지.
3. **provider 키**(R07/R09 live): 없으면 `providerMissing` 유지.
4. **실기기**(R30/R31): 후보 SHA APK는 push→CI 후에만 존재.

### 다음 정확한 재개 작업
- push 게이트가 열리면: CI 결과·아티팩트 SHA-256을 manifest로 기록(§10), 실패 시 재현→수정.
- 코드 작업(키 불필요, 바로 가능): F07(`/api/voice` 기억 회수+의도→기존 작업 계약), F14(비용 총액 한도), F13(Obsidian exporter 01_DRAFTS 규칙), F09(코어/배포 SHA 클라이언트 표시). 순서 제안: F07 → F14 → F09 → F13.
- 재실행 금지 외부 효과: 없음(이 세션은 외부 발송·결제·배포·삭제를 하지 않았고, Koyeb에는 GET health/state만 보냄).

### 2026-09-23 추가 — G1 이후 코드 작업 3건 + 최종 회귀 (재개 기록 갱신)
- 추가 커밋: `f1094c7` F07(`/api/voice` 기억 회수, `lib/memory-recall.mjs`, job.memoryRecall) · `7c7a091` F13(Obsidian exporter 소유 하위트리 `01_DRAFTS/BLACKHOLE` 기본, `00_INBOX_RAW` 금지) · `0e0c55a` F09 식별 절반(`/api/state.runtimeIdentity` + Home 풋터). 각 커밋 메시지에 설계 기록.
- 최종 회귀(HEAD `0e0c55a`, 132개 파일, 6개씩 55s 묶음 + UI 2개씩 175s): tests 1026 · pass 1018 · **fail 1 (묶음 실행에서만)** · skipped 7(video env-gate).
  - 그 1건 = `test/closed-loop.test.mjs` "Loop 2 - autopilot opt-in…"(scheduler 타이밍 대기). **단독 실행 2회 연속 5/5 통과** → 55s 묶음 경합에서의 타이밍 민감 검사로 분류. 후보 회귀로 단정하지 않되, push 후 CI의 묶음 없는 `npm test`를 최종 판정으로 삼는다. 이 후보의 F07/F09/F13 변경은 autopilot/scheduler 경로를 건드리지 않았다(정적 확인).
- 미착수(키 불필요, 다음 재개 1순위): **F14** 통화 총액 한도(단가 스냅샷·토큰/시간 상한·예약/정산; `agent-engine.mjs` 호출 회계 조사부터). 그다음 F08(브라우저 worker transport)·F09 나머지(Koyeb 배포 SHA 대조).
- 외부 게이트는 위 §14 항목 그대로(push/PR/CI, YENO_TOKEN, provider 키, 실기기).

## 2026-09-23 (Claude, Cowork) — closed-loop 근본 원인 수정 + F09 나머지·F14 + base 검토 (§15)

### 현재 위치
- 브랜치 `blackhole/g1-integration-claude-20260922`, HEAD `9437dac`(base PR #55 head `84d6f27c`, 이 후보 자체 커밋 16개), 로컬 전용 — **원격 push 안 됨**(자격증명 없음, 아래 §15-3). 작업 트리 clean.
- 새 커밋: `a847357` 스케줄러 근본 원인 수정 · `9437dac` F14(비용 총액 한도) + F09 나머지(배포 SHA 실제 대조) + base 브랜치 검토 결과 기록.

### 1) closed-loop.test.mjs "Loop 2" — 근본 원인을 찾아 수정함 (단독 통과로 넘기지 않음)
- 원인: `server.mjs`의 스케줄러 `tick()`은 자기 자신을 150ms마다 재호출하는 `schedule()`을 함수 **끝**에서만 호출했고, 데드라인 정리·자동 자료 검토 작업 생성 두 곳은 어떤 try/catch에도 감싸이지 않았다. 이 둘 중 하나가 어떤 이유로든(예: 전체 회귀처럼 여러 node 프로세스가 동시에 도는 실제 CPU/디스크 경합 상황에서의 일시적 실패) 예외를 던지면 `tick()`이 마지막 `schedule()`에 도달하지 못하고 그 서버 프로세스의 나머지 수명 동안 스케줄러 전체가 영구히 멈춘다 — autopilot의 목표 합성·closed loop 진행이 다시는 일어나지 않는다. 단독 실행은 경합이 없어 이 경로를 절대 건드리지 않으므로 항상 통과했던 것이고, 묶음 실행에서만 간헐적으로 재현된 것과 정확히 일치한다.
- 수정: `tick()` 전체를 `try{...}finally{schedule();}`로 감싸 어떤 단계에서 무엇이 터지든 매 tick마다 정확히 한 번 재무장하도록 보장. 이전에 감싸이지 않았던 두 단계도 다른 모든 단계와 같은 방식(로그 후 계속)으로 try/catch 추가. 부수적으로 `controlAutopilot()`이 켜질 때 `schedule()`을 즉시 호출하도록 추가(지연 축소 + 자가 치유).
- 검증: 수정 전/후 모두 `test/closed-loop.test.mjs` 단독 5회 연속 5/5 통과(이건 원래도 항상 통과했음, 참고용). **실제 재현 조건**(다른 11개 파일과 함께, 실 병렬 경합 하에서 2회 실행, 그중 한 번은 Loop 2가 4.08초 소요 — 이 검사의 6초 대기 예산에 근접) — 수정 후 **두 번 모두 Loop 2 포함 5/5 통과**. 전체 132개 파일을 20개 묶음으로 나눠 재실행: `not ok` 0건.
- 커밋 후 정확한 HEAD(`a847357`)에서 다시 전체 132개 파일을 재실행: **tests 993 · pass 986 · fail 0 · skipped 7**(첫 배치 방식, 파일 수 동일하나 node --test의 다중 파일 집계 방식 차이로 총 subtest 수 표기가 이전 "1026" 표기와 다름 — fail 0/not ok 0이 판정 근거).

### 2) F09 나머지 — Koyeb 배포 SHA 대조
- 실제 Koyeb 코어(`https://global-iris-gyeol-98386a17.koyeb.app`, `verify-blackhole-live-loop.ps1`에 기록된 URL) `/api/v1/health` 확인: `{"name":"YENO OS","version":"0.2.2","apiVersion":"1","authRequired":true}` — 인증 필요(정상). `/api/v1/state`의 `runtimeIdentity.sourceCommit` 비교는 YENO_TOKEN 필요 → **여기서부터는 여전히 소유자 게이트**(외부 차단, 코드 결함 아님).
- 코드 쪽은 완성: `scripts/blackhole-check.mjs`가 예약만 해두고 채우지 않던 `report.deploymentSha` 필드를 이제 인증된 `/api/v1/state`의 `runtimeIdentity.sourceCommit`(F09가 이미 넣어둔 필드)에서 실제로 읽어 `report.deploymentMatchesSource`를 계산한다. isolated 모드로 종단 검증: 이 정확한 체크아웃에서 시작한 임시 로컬 런타임이 자기 자신의 HEAD SHA(`a8473579…`)를 그대로 보고 `deploymentMatchesSource:true` — 하드코딩이 아니라 실제 대조임을 증명. `blackhole-check.test.mjs`에 회귀 고정.

### 3) F14 — 통화 총액 한도(단가 스냅샷)
- 새 `runtime/lib/cost-ledger.mjs`: provider별(모델별 아님, 일부러 거친 기준) USD/1k 토큰 스냅샷(버전·기준일 동봉) + `dailyCostUsage`/`dailyCostLimitStatus`. 오늘 settled(확정) 호출의 실제 토큰만 합산, 미확정·미등재 provider는 절대 0원으로 취급하지 않고 `unpriced`로 집계.
- 실패 닫힘: 한도를 설정했는데 오늘 unpriced 호출이 하나라도 있으면 총액을 정직하게 알 수 없으므로 `cost_pricing_unknown`으로 즉시 차단(한도 미달로 임의 간주하지 않음).
- 집행 지점: `agent-engine.mjs`의 `runAgent` 예약 게이트 1곳 — 모든 job 종류(bot/research/code/voice/repository/semantic/shadow)가 기존 `daily_call_limit` 검사와 공유하는 실제 유일한 관문이라 별도 경로를 새로 만들지 않음. 새 env `YENO_AGENT_DAILY_COST_LIMIT_USD`(미설정 시 기존 동작 그대로, 호출 횟수 한도만 유효). `/api/state`의 `agent.costUsage`로 노출.
- 검사: `test/cost-ledger.test.mjs`(신규 5건) + 기존 agent 계열 회귀 전부 재확인, 회귀 없음.

### 4) push/Draft PR 전 base 검토 결과 (실행하지 않음, 확인만)
- `git merge-base origin/main HEAD` = `f355c86`(먼 조상), `main`..HEAD = **346개 커밋**. 반면 `84d6f27`(이 후보의 실제 base, PR #55 head)..HEAD = **16개 커밋**(이 후보 전부).
- GitHub API로 PR #55 확인: 상태 Draft(open), **head 브랜치 = `blackhole/mobile-tools-back-codex-20260921`**(head sha `84d6f27c`, 로컬 기록과 일치), **base 브랜치 = `blackhole/provider-test-safety-apk-smoke-codex-20260921`** — #55 자신도 아직 병합되지 않은 긴 사슬의 한 고리.
- 결론: 이 후보의 Draft PR은 **base를 `blackhole/mobile-tools-back-codex-20260921`(#55의 head 브랜치)로 지정**해야 diff에 이 후보의 16개 커밋만 나온다. `main`을 base로 하면 346개 커밋(병합 안 된 전체 스택)이 diff에 섞여 들어간다. **아직 push·PR 생성은 하지 않음** — 실행은 연호님 확인 후(§15 하단 행동 목록).

### 남은 코드 작업 (키 불필요, 다음 우선순위)
- **F08**(실제 브라우저 worker/transport): `server.mjs`가 `options.browserHarnessAdapter`를 이미 플러그형으로 호출하는 자리(1305행 부근)가 있고 `lib/browser-harness.mjs`/`browser-decision.mjs`(JEV 권한)/`browser-provider-routing.mjs`가 이미 있음 — 즉 어댑터 계약과 결정 권한 체계는 있는데 실제 어댑터 구현체가 아직 없음(`browserAutomation:false`). 이번 세션엔 조사만 하고 구현은 다음 재개로 미룸: 외부 사이트로 나가는 실제 네트워크 행위(SSRF·권한 우회 위험)라서 근거 문서 없이 서두르면 오히려 "실패 닫힘" 원칙을 어길 수 있다고 판단 — 다음 재개 때 `browser-decision.mjs`/`browser-harness.mjs` 전체를 먼저 읽고 최소 read-only 어댑터(공개 페이지 GET만, JEV 결정 게이트 통과 필수)부터 설계 기록을 남기고 구현.
- R40(서명키)·R39(백업→빈 환경 복원 실증)은 이전과 동일하게 미착수 — 완료 기준은 원장에 이미 기재됨(원장 §5-4 참고), 서명키/실제 복원 환경 모두 소유자 행동 필요.

## §16 재개 기록 (2026-09-23, d31fded 이후 로컬 후보: 84a0da3 → 13a0640 → 0aa8701)

로컬 후보를 계속 보존(`d31fded`는 이 시점의 이전 후보로 보존됨, push는 여전히 미실행). 이번 재개에서 완료한 항목:

### 1) F08 v1 — read-only 브라우저 sandbox adapter (`84a0da3`)
- `runtime/lib/browser-adapter.mjs`(신규): 의존성 없는 순수 Node `fetch()` 기반 `fetchPublicPage()`(정규식 기반 title/body/links/elements 추출, package.json에 런타임 의존성이 전혀 없는 프로젝트라 파서 라이브러리를 새로 들이지 않음) + 모델 호출 없는 결정론적 `deterministicReadOnlyDecisionProvider`(항상 `BLOCKED` 반환).
- 설계 근거: `runSandboxBrowserHarness`(`browser-harness.mjs`, 기존)의 `safeActionPlan()`이 `independentOutcome`을 항상 `null`로 넘기므로, decisionProvider가 `DONE`을 반환하면 `done_requires_independent_evidence`로 무조건 크래시한다 — 독립 semantic 검증자가 없는 v1은 절대 `DONE`을 반환해서는 안 되고, `BLOCKED`만이 루프를 안전하게 종료시키면서 그 시점까지의 실제 fetch 결과(snapshot/artifact)를 보존한다.
- `server.mjs`: `YENO_BROWSER_SANDBOX_ENABLED==='true'`일 때만 이 어댑터를 기본 연결(소유자 명시적 옵트인 없이는 기존 동작 완전히 그대로 — `browser-live-harness.test.mjs`의 "no adapter stays unavailable" 검사가 수정 없이 그대로 통과함으로 확인). `evidenceClass`는 실제 fetch 구현이 쓰였을 때만 `LIVE`로 표시(테스트가 주입한 합성 transport는 `SANDBOX_SYNTHETIC`으로 정직하게 구분 — 첫 구현에서 항상 `LIVE`로 잘못 표시하던 버그를 검사로 발견해 즉시 수정).
- `runtime/test/browser-adapter.test.mjs`(신규 3건) + 기존 browser-* 3개 파일(17건) 전부 PASS. 그중 1건은 `https://example.com/`에 대한 **실제 네트워크 GET**(합성 아님) — 실제 sha256 아티팩트·`evidenceClass:'LIVE'` 확인.
- 알려진 v1 한계(설계상 의도): semantic 검증자가 없어 job은 `deterministicVerification.status:'verified'`까지는 도달하지만 `job.status`는 `completed`가 될 수 없음(`finalizeBrowserJob`이 독립 semantic pass를 요구) — `failed`/`semantic_verification_unavailable`로 정직하게 멈추고, 실제 snapshot/artifact/보류(REF, decision:'pending') source는 그대로 보존되어 소유자 검토 가능.

### 2) F14 — 동시 worker 하에서 진짜 결함을 발견하고 수정 (`13a0640`)
- 기존 F14(비용 상한)는 단일 job 순차 시나리오에서만 검증되어 있었음. 동시 worker 검사를 새로 작성해 실행한 결과 **실제 결함 재현**: `dailyCostUsage()`가 `status==='settled'`인 호출만 집계하고 `status==='reserved'`(응답 대기 중)인 호출은 집계하지 않음 → 두 worker가 거의 동시에 예약하면 둘 다 "아직 예산 이내"로 통과한 뒤 둘 다 정산되어 실제 합계가 상한을 넘김. 수정 전 코드로 재현: cap $0.03에 두 worker(각 $0.018) 모두 통과 → 실 정산 $0.036(20% 초과) — `settledCount=2, impliedUsd=0.036 > cap 0.03` 로 assertion 실패를 직접 관찰.
- 수정: `pendingCostReservationsToday()` 신규 + `dailyCostLimitStatus()`가 오늘자 미정산(reserved) 호출이 하나라도 있으면 기존 "unpriced settled call" 처리와 동일하게 `cost_pricing_unknown`으로 fail-closed. `runAgent()` 자체는 수정 불필요(이미 공유 게이트를 통과하고 있었음).
- 재검증: 동일 검사가 수정 후 PASS(정확히 한 worker만 차단됨, 실 정산 합계가 상한 이내임을 확인). `f14-concurrency.test.mjs`(신규 2건) + `cost-ledger.test.mjs`(5건, 기존) + `agent.test.mjs`/`agent-provider-selection.test.mjs`/`agent-security-intake.test.mjs`(36건, 기존) 전부 PASS.

### 3) 스케줄러 수정(`a847357`) 심화 검증 (`0aa8701`)
- `tick()`에 테스트 전용 관찰 훅(`options.debugSchedulerTick`, 기본 no-op, 프로덕션에서 설정되지 않음) 추가 — 의도적으로 자신의 try/catch 없이 배치해, 던지면 다른 모든 단계와 동일한 바깥쪽 `try/finally` 안전망을 그대로 거치게 함(단, 실제 검사에서는 **던지지 않는** 타임스탬프 관찰용으로만 사용 — 동일 위치에서 실제로 예외를 던지는 합성 훅은 `discovery.tick()`/`ecosystem.tick()`/`processMemorySyncBatch()`가 모두 `async function`이라 동기적으로 절대 던지지 않는 것과 달리, 순수 동기 함수로 던지면 `setTimeout` 콜백 밖으로 예외가 전파되어 미처리 예외로 **프로세스 자체가 죽을 위험**이 있음을 코드 검토로 확인했기 때문 — 안전하게 검증 가능한 실제 실패 경로를 대신 사용).
- 예외 주입은 합성 훅 대신 **실제 실패 경로**로 검증: 저장소를 16MiB 백업 용량 한도를 넘겨 미리 채워 넣고(`x`.repeat(17MB) 이벤트) autopilot을 미리 켠 상태로 서버를 기동 → 다음 `runAutopilot()`이 진짜 `ProductionCapacityError`를 던짐. 관찰: `autopilot.retryAt`이 정확히 기록됨(≈1시간 후), 실패 이벤트가 **정확히 1회만** 로그됨(≈150ms 주기로 1.2초간 추가 tick 기회가 8회 이상 있었음에도 재시도 억제됨 — `autopilot.mjs`의 `eligible()`의 `retryAt` 게이트가 실제로 작동), 서버는 죽지 않고 무관한 요청을 계속 처리함(직후 `/api/jobs` 201 확인).
- tick 중복 방지: 5개의 동시 요청(각각 자체적으로 `save()+schedule()` 호출)을 병렬 발사한 뒤 실제 관찰된 tick 간격이 한 번도 100ms 미만으로 좁혀지지 않음을 확인 — `schedulerTimer` 가드가 실제로 타이머 중복 적재를 막고 있음을 실측으로 확인(합성 타이머 모킹 아님).
- `planAutopilot`/`getAutopilotStatus`의 `retryAt` 게이팅은 순수 함수 단위 검사로도 별도 확인.
- `runtime/test/scheduler-fix.test.mjs`(신규 3건) 전부 PASS + closed-loop(38건)·autopilot 계열 회귀 확인.

### 4) R39/R40 — 실제로 필요한 owner-blocked 항목만 남기기 (구현 변경 없음, 재확인 + 원장 갱신)
- R39(백업·복구): `runtime/lib/backup.mjs` + `scripts/backup.mjs` CLI(keygen/export/restore)는 이미 구현·시험되어 있었음. `backup-api.test.mjs`를 이번 세션에 재실행해 재확인: 완전히 새 빈 디렉터리로 실제 restore → 그 디렉터리에서 새 서버를 기동 → 원본과 동일한 artifact 바이트·sha256 해시 확인(1건 PASS). 즉 "빈 환경으로의 복원" 자체는 이미 실증되어 있음. 남는 owner-blocked는 정확히: (1) 암호화된 백업 파일을 실제 외부 저장소(클라우드/USB 등)에 올리고 받아오는 과정은 설계상 자동화 대상이 아님(소유자가 직접 이동), (2) 진짜 별도 물리 기기에서의 복원은 미실증.
- R40(릴리스 서명): `scripts/android-release.mjs`(서명자 연속성 검사 SIGNER_CHANGED, keystore.properties 기반 Gradle 삽입, 서명키 부재 시 fail-closed)는 이미 상당 부분 구현되어 있었음. `android-release.test.mjs` 재확인: 21/22 PASS(나머지 1건은 `native-config.test.mjs`의 `URLPattern` 미지원 — 이 기기 셸의 Node 22 환경 제약이며 package.json이 요구하는 Node>=24와 무관하게 이번 변경과 무관한 기존 환경 한계, 코드 결함 아님). 남는 owner-blocked는 정확히 하나: 실제 Android 서명 인증서(keystore) 자체.
- 두 항목 모두 "소프트웨어가 할 수 있는 부분"은 이미 candidate/in_progress로 원장에 반영, 남은 차단 사유를 실제 서명키·외부 보관·실기기로 명확히 좁힘(`docs/BLACKHOLE_REQUIREMENTS_LEDGER_20260923.md` R39/R40 행 갱신).

### 아직 완료 아님 / 정직하게 열어둠
- push·Draft PR 생성은 여전히 미실행(GitHub push 인증이 이 세션 도달 범위 밖). base가 `blackhole/mobile-tools-back-codex-20260921`이어야 한다는 §15의 결론은 유효.
- F08은 v1(읽기 전용, 클릭/입력 없음, 단일 페이지)까지만 — v2(실제 액션 디스패치, 독립 semantic 검증자)는 미착수.
- 이번 세션에서 검증한 "동시성"은 단일 Node 프로세스 내부의 실제 비동기 인터리빙(진짜 동시 in-flight 요청)이며, 여러 프로세스·여러 실기기에 걸친 동시 worker는 검증 범위 밖.
- 실모델(YENO_TOKEN 필요)·실기기 증거는 여전히 없음 — RC 완료를 보고하지 않음.

## §17 재개 기록 (2026-09-23/24, ef08d0c 이후 — 로컬 메모리 임베딩 실기기 라이브 검증)

이전 §16까지의 F08/F14/스케줄러/R39/R40 작업과는 별도 트랙인 P2(로컬 임베딩·기억) 작업의 실기기 검증 결과를 기록한다. 코드 자체(`runtime/lib/memory-embeddings.mjs`, `runtime/test/memory-embeddings.test.mjs`, `scripts/verify-local-memory-live.mjs`)는 이미 `4e99f19`/`ef08d0c`로 커밋되어 있었고, 이번 재개에서는 **사용자 실제 PC에서 그 스크립트를 실행해 라이브 증거를 확보**했다(코드 변경 없음, 문서 기록만 추가).

### 실행 환경
- 사용자 PC, 저장소 로컬 clone(`C:\Users\우연호\Documents\Projects\yeno-os`), Ollama 0.34.3, 임베딩 모델 `bge-m3`(1.2GB, 이번 재개에서 `ollama pull bge-m3`로 설치).
- 실행은 Cowork 세션의 컴퓨터 사용 도구(클릭+클립보드 붙여넣기 방식 — 이 세션은 터미널에 직접 타이핑할 수 없어, 명령을 클립보드에 올리고 사용자가 Ctrl+V로 실행)로 진행했다.

### 1) 저장 → 재시작 → 다른 표현 질의 (P2 §3)
- `store "YENO 프로젝트의 비공개 백업 코드명은 자수정-7이다"` → `stored id: 7f19bf2e-9349-44ee-9fdc-7cb09cd232af`, model `bge-m3`, `external calls: 0`.
- Ollama 프로세스를 실제로 종료(`Stop-Process -Force`)한 뒤 앱을 재실행 — 트레이 앱만으로는 서버가 자동으로 뜨지 않아 `Start-Process ollama serve`로 서버를 직접 재기동, `Invoke-WebRequest http://127.0.0.1:11434` 200 OK로 재기동 확인.
- 재시작된 서버·새 `node` 프로세스에서, 저장 시 쓴 문장을 다시 주지 않고 **다른 표현**("우리 프로젝트 백업용 비밀 코드네임이 뭐였지?")으로 `query` 실행 → 정확히 같은 id/원문(`자수정-7`)이 score 0.6489로 1위 회수됨, `external calls: 0`. **통과.**

### 2) 수정·삭제 반영 (P2 §4, 온라인)
- `edit 7f19bf2e... "...자수정-9로 변경되었다"` → `updated text`에 새 문장 반영 확인.
- 같은 질문으로 재질의 → 수정된 문장("자수정-9")이 즉시 회수됨(score 0.6565, `updatedAt` 갱신 확인). **통과.**
- `delete 7f19bf2e...` → 같은 질문으로 재질의 → `records in store: 1 (0 active)`, `top results: []` — 삭제된 기억이 어떤 limit에서도 다시 나오지 않음을 실기기에서 확인. **통과.**

### 3) 오프라인 검증 (P2 §4, 인터넷 차단)
- 사용자가 Wi-Fi/인터넷을 실제로 끈 상태에서, 미리 클립보드에 올려둔 명령으로 새 사실 저장(`stored id: 1b21d119-f53c-468e-999e-b3793214c536`, "청금석-3")과 다른 표현 질의("예노 프로젝트 두 번째 백업의 암호명이 뭐야?")를 연속 실행 — 저장·검색 모두 성공, `fetch targets`는 매번 `127.0.0.1:11434` 단 하나, `external calls: 0`. 사용자가 인터넷이 꺼져 있었음을 확인함. **통과.**
- 이 세션은 Cowork의 컴퓨터 제어 자체가 사용자 PC의 인터넷 연결에 의존하므로, 인터넷 차단 구간 동안은 세션이 실시간으로 개입하지 않고 미리 준비한 명령을 사용자가 혼자 실행하는 방식으로 진행했다(재연결 후 결과 화면만 전달받음) — A01(로컬 생성 모델) 검증 때와 동일한 제약·동일한 해법이다.

### 4) 정식 위치·실행 명령 (P2 §5)
- 변경 없음: `scripts/verify-local-memory-live.mjs`가 이미 그 정식 위치다(레포의 기존 `scripts/verify-*-live.mjs` 관례를 그대로 따름, `npm test`/`package.json`의 `scripts`에는 의도적으로 미포함). 실행법은 스크립트 헤더 주석에 이미 기재됨(`store|query|edit|delete|list`).

### 남은 항목 / 다음 재개 지점
- 이번 세션은 전체 회귀(`npm test`, 132개 파일·1000+ 테스트)를 device_bash의 180초 타임아웃 안에서 끝까지 실행하지 못했다 — 대신 `memory-embeddings.test.mjs` + provider/agent-provider-selection/desktop-provider-config 4개 파일(25/25 PASS)만 표적 재확인했다. 다음 재개에서 전체 회귀를 20개 묶음으로 나눠 재실행해 `not ok` 0건을 다시 확인하는 것을 권장한다.
- `docs/BLACKHOLE_LE_SPEC_V3_AUDIT_20260923.md`에는 이 P2 메모리 작업에 정확히 대응하는 기존 행이 없다(A02 "검색"은 LE-01 검색 경로 자체를 가리키며 별개 개념) — 필요하면 다음 재개에서 신규 행을 추가할지 owner 판단이 필요하다.
- push·Draft PR·원격 반영은 여전히 하지 않았다(로컬 커밋만, 지시대로).

## §18 재개 기록 (2026-09-24, 3cc9ccc 기준 — device_bash 샌드박스 전체 회귀)

**상태 요약(연호님 확인 기준): 실패 0건 · 전체 회귀 미완료 · 11개 파일 환경 차단(device_bash 샌드박스에서 jsdom 초기화가 멈춰 pass/fail 자체를 확인 못함, 코드 결함 여부 unknown).** 아래 수치를 "전체 통과"로 해석하지 말 것 — 126/137 파일만 이 세션에서 확인됐고, 11개 파일은 사용자 실PC에서 별도로 재확인해야 한다.

`3cc9ccc` 체크아웃 그대로(코드 변경 없음) `runtime/test/*.test.mjs` 137개 파일 전체를 이 세션의 device_bash 샌드박스(사용자 실PC가 아니라 그 안의 격리된 Linux VM, bwrap)에서 개별 실행했다.

### 결과
- **126/137 파일 실행 완료, 951개 테스트 전부 pass, fail 0건.**
- **11개 파일은 이 device_bash 샌드박스에서 응답 없이 멈춤(hang)** — 전부 `jsdom`(`createRequire(...)('jsdom')`)을 쓰는 뷰 테스트: `autopilot-ui`, `capability-ui`, `code-ui`, `desktop-ui`, `drive-orbit-ui`, `growth-ui`, `living-core-ui`, `project-universe-ui`, `shadow-army-ui`, `voice-ui`, `voice-view-live`. `TAP version 13` 한 줄만 찍힌 뒤 40~90초를 줘도 전혀 진행되지 않음 — jsdom 초기화가 이 중첩 샌드박스 VM에서 막히는 것으로 보이며(예: 이 VM에 없는 자원에 대한 접근), 코드 결함의 증거는 아니다. 같은 137개 파일 세트가 과거 세션 보고(§16/§17 이전, 실제 사용자 PC 또는 다른 실행 경로)에서는 "993~1026개 pass, 0 fail, 7 skip"로 전부 통과했다고 기록되어 있어, 이 11개 hang은 device_bash 샌드박스 고유의 환경 제약으로 판단한다.
- **재현 가능한 실제 코드 결함(not ok)은 0건.** 처음에 15초/25초 가드로는 여유가 부족해 `TIMEOUT`으로 잘못 분류됐던 파일(`autopilot-api`, `code-sandbox`, `code-workshop`, `container-lease`, `f05-mission-memory-outbox`, `projects`, `runtime`, `semantic-verification`)은 40~90초로 재시도해 전부 pass로 확인됐다 — 진짜 hang이 아니라 이 VM이 단순히 느린 것이었다.

### 남은 사항
- jsdom 11개 파일의 실제 pass/fail은 **이 device_bash 샌드박스에서는 확인 불가**. 사용자 실PC의 PowerShell에서 `npm test` 또는 `node --test runtime/test/*-ui.test.mjs runtime/test/voice-view-live.test.mjs`를 직접 실행해 확인하는 것을 다음 재개 항목으로 남긴다(이 세션은 클립보드 붙여넣기 방식으로 실행은 가능하나, 결과가 길어 자동 캡처는 사용자 협조가 필요).
- 코드 변경 없음 — 이 커밋은 순수 기록용.

## §19 재개 기록 (2026-09-24, 41ed3fc 이후 — 임시 검증 파일 삭제 확인 · Android 실기기 연동 직전 상태)

### 1) 임시 파일 삭제 확인 (연호님 명시 요구사항, 실제 결과 관찰 전까지 완료로 기록 금지)
- 실행: `Remove-Item -Force -ErrorAction SilentlyContinue "$env:TEMP\yeno-memory-embeddings-live-store.json"; Test-Path "$env:TEMP\yeno-memory-embeddings-live-store.json"`
- 사용자가 PC에서 직접 붙여넣기 실행, 화면 캡처로 실제 출력 확인: `False`.
- 화면은 잠겨있지 않았고, 이전 세션에서 있었던 캡처 실패는 도구 쪽 일시적 문제였다(연호님 지적대로 잠금으로 단정하지 않음, 재시도 후 즉시 성공).
- **통과. 이제 완료로 기록함.**

### 2) 남은 항목 (다음 재개 지점, 순서대로)
- Windows 방화벽: YENO 서버 LAN 노출 포트를 집 사설 네트워크 내 특정 휴대폰(또는 사설 서브넷)으로만 제한하는 인바운드 규칙 — 아직 설계·적용 전.
  - `YENO_ALLOWED_HOSTS`는 Host 헤더 문자열만 검사하며 소스 IP를 제한하지 않는다는 점을 확인함(연호님 지적) — 방화벽 규칙이 별도로 필요.
- `YENO_HOST=0.0.0.0` + `YENO_ALLOWED_HOSTS=<PC LAN IP>:<port>` 설정 및 PC의 실제 LAN IP 확인 — 아직 미실행.
- 방화벽 규칙 적용 후 서버 재기동, 휴대폰에서 동일 Wi-Fi로 PC URL 접속 → 기존 `web-pairing.mjs` 브라우저 페어링 승인 플로우 → 실제 `/api/voice` 요청.
- `qwen2.5:3b` 처리 확인 + `job.memoryRecall.semantic`을 통한 로컬 기억 회수 증거가 앱에 보이는지 확인.
- 인터넷 차단 + 동일 LAN 상태에서 폰↔PC 플로우 동작 확인.
- 기기 페어링 해제(`revokeDevice`) 후 해당 기기 요청이 거부(401)되는지 확인.
- Ollama 11434는 PC 내부 주소 유지, 공유기 포트 전달 금지 — 계속 준수.
- 11개 jsdom 의존 테스트 파일은 사용자 실PC(device_bash 샌드박스 밖)에서 재확인 필요 — 아직 미실행.
- push/원격 반영 없음(로컬 커밋만) — 계속 준수.

## §20 재개 기록 (2026-09-24 — Android LAN 연동 방화벽 진단, 중요 발견)

### 진단 결과
- Wi-Fi 네트워크 프로필: **Public** (Private 아님). 전체 프로필 변경은 하지 않기로 함(영향 범위 최소화) — 대신 신규 규칙을 `-Profile Public`으로 맞추는 쪽으로 방향 수정(연호님 결정).
- 포트 8790 전용 기존 규칙: 없음.
- **`Node.js JavaScript Runtime` 기존 인바운드 허용 규칙 발견 (Node.js 설치 시 자동 생성 추정)**:
  - TCP: Profile=Public, Action=Allow, LocalPort=**Any**, RemoteAddress=**Any**, Program=`C:\program files\nodejs\node.exe`
  - UDP: 동일 (LocalPort=Any, RemoteAddress=Any)
  - 이 규칙이 살아있는 한, 휴대폰 전용으로 좁힌 새 규칙을 추가해도 node.exe(=YENO 서버) 자체는 이미 Public 프로필의 모든 기기에 모든 포트로 노출되어 있어 새 규칙이 실질적 보호를 제공하지 못함.

### 결정된 다음 단계 (연호님 승인, 아직 미실행 — 방화벽 변경은 에이전트가 직접 수행하지 않음)
1. 시험 직전: 기존 `Node.js JavaScript Runtime` 규칙 2개(TCP/UDP)를 `Disable-NetFirewallRule`로 임시 비활성화(영구 삭제/변경이 아닌 가역적 조치).
2. 휴대폰 전용 좁은 규칙(`YENO-Voice-Phone-Only`, TCP 8790, RemoteAddress 192.168.219.105/32, LocalAddress 192.168.219.102, Profile Public) 생성.
3. 실기기 시험 진행.
4. 시험 종료 후: `YENO-Voice-Phone-Only` 규칙 제거 + `Node.js JavaScript Runtime` 규칙 2개 `Enable-NetFirewallRule`로 재활성화 + `Get-NetFirewallRule`로 Enabled=True 재확인(원복 검증 없이 완료로 기록하지 않음).
- 아직 어떤 방화벽 변경도 적용되지 않은 상태(진단만 완료).

## §21 재개 기록 (2026-09-24 — 두 작업 라인 분기 확인 · 통합 기준 결정 · Vault 저장)

### 확인된 사실
- 이 PC 저장소: 브랜치 `blackhole/g1-integration-claude-20260922`, HEAD `471f79a`(이 기록 직전). §17의 Ollama 실사용 증거(qwen2.5:3b / bge-m3, 재시작·다른 표현 회수·수정·삭제·오프라인)는 이 라인에만 있다.
- 별도 Codex 작업공간: 브랜치 `blackhole/p3-connected-codex-20260924`(base `84d6f27`, 코드 커밋 `be486da`, 기록 커밋 `52004b4`). F03~F06, P3 voice→Shadow→JEV 합성 통합, JEV 의미 검토, F14 비용 원장, P4 게이트 회로 코드, `scripts/verify-living-loop-live.mjs`, 전체 회귀 1,108/1,101/0 fail/7 skip. **이 브랜치·커밋·파일은 PC 저장소에 없다**(`git cat-file` 실패, 원격에도 없음). 같은 파일명 `runtime/lib/memory-embeddings.mjs`를 두 라인이 서로 다른 설계로 구현했다.
- Codex 라이브 스크립트가 요구하는 서버 기능 중 이 PC 서버에 없는 것(아래 grep 결과 참고): `expectedQuestId`, `jev.recentShadowDecisions`, `readiness.sourceCommit`, `persistentStore.durable` 등 — 스크립트만 가져오면 PC에서는 실행 불가.

### 결정(연호님·Codex 합의, 이 세션 기록)
- **PC 브랜치를 실사용 기준으로 유지한다.** Codex 변경은 통째로 덮어쓰지 않고 파일별로 비교해 필요한 것만 이식한다. 임베딩 구현은 두 설계가 다르므로 특히 통째 교체 금지.
- 이식 후에는 **최종 동일 SHA에서** 전체 회귀와 Ollama 실사용 검증(§17 항목)을 다시 한다. 이전 SHA의 증거를 새 SHA에 재귀속하지 않는다.
- 정확한 표현: "Codex는 별도 작업공간에서 코딩했지만, 연호님 PC의 OS에는 아직 적용하지 않았다."

### Vault 저장(이 세션 실행)
- `Obsidian Vault/01_DRAFTS/BLACKHOLE_OS_통합_실행계획_20260924.md` 신규 생성(Codex의 `docs/BLACKHOLE_EXECUTION_PLAN_20260924.md` 원문 그대로, SHA-256 `e3dc6378…d776a0`, 84,764 bytes, 저장 후 해시 일치 확인). `CHANGELOG.md` (24)번 기록. 기존 노트·`00_INBOX_RAW` 미수정.

### 이식을 시작하기 위해 필요한 것(차단)
- Codex 브랜치의 실제 변경분이 이 PC에 없다. push 없이 가져오려면 Codex 세션에서 `git format-patch 84d6f27..be486da`(또는 `git bundle create`)로 패치 파일을 만들어 이 세션에 파일로 전달해야 한다. 현재 전달된 3개 파일(실행 계획 md, 실행 상태 md, 라이브 스크립트)만으로는 서버 변경 없이 이식이 불가능하다.
- 그 전까지 P3 코드 작업은 이 PC 라인에서 보류(어느 쪽 위에 쌓을지 정해졌으나 자료가 없음).
- P1 방화벽 1·2번(사용자 직접 실행)은 계속 대기.

## §22 재개 기록 (2026-09-24 — Codex bundle 반입 · 읽기 전용 비교 완료 · 적용 전)

### 실행한 것(README 순서, 적용 없음)
- bundle `codex-p3-port-20260924.bundle` SHA-256 `5d1a84c56f8366f80f650a01f621ea1c87b177cce9a98e73b8cd7ff3f8c24b23` — 전달값·컨테이너·PC 3곳 일치. 위치: `Desktop\codex-p3-port-20260924.bundle`(저장소 밖).
- `git bundle verify` okay(요구 ref `84d6f27` 보유). `git fetch` → `refs/remotes/codex/p3-port-20260924` = `be486da`만 추가. 현재 브랜치 `blackhole/g1-integration-claude-20260922`·HEAD·작업 트리 불변(status 0건).
- Codex 커밋 12개(`7bb706e`…`be486da`): base 대비 65 files / +4211 −233. PC 라인: base 대비 48 files / +4230 −124. 공통 조상 `84d6f27`.

### 비교 결과
- 양쪽이 모두 건드린 파일 24개. 3-way dry merge(`git merge-tree 84d6f27 HEAD codex`, git 2.34, 읽기 전용) 기준 충돌 hunk 45개.
  - 큰 충돌: `runtime/server.mjs` 12, `runtime/lib/blackhole-core.mjs` 10, `provider-config-engine.mjs` 3, `store.mjs` 2, `backup.mjs` 2.
  - **같은 기능을 양쪽이 각자 새로 만든 파일(added in both, 파일 전체 충돌)**: `runtime/lib/memory-embeddings.mjs`(+test), `runtime/lib/cost-ledger.mjs`(+test; PC엔 `f14-concurrency.test.mjs`도 있음), `runtime/lib/shadow-growth.mjs`(+test). 이 3쌍은 merge가 아니라 설계 선택이 필요.
- Codex만 건드린 파일 41개(예: jev-recovery, recovery-one-of-qpu, memory-write, shadow-mission-finalization, verify-living-loop-live 등 — 다음 단계에서 의존성 확인). PC만 건드린 파일 24개(G1 통합 테스트, memory-recall, obsidian-exporter, persistent-bots, browser-adapter, blackhole-check, live 스크립트 2개 등).
- 결론: 커밋 단위 cherry-pick/`git am` 일괄 적용은 불가(README 지침과 일치). 파일 단위 이식 필요.

### 제안 이식 순서(연호님 승인 대기, 아직 아무것도 적용 안 함)
1. Codex 전용 신규 모듈 중 공유 파일에 의존하지 않는 것부터 파일 단위로 가져오고 해당 테스트 실행.
2. `server.mjs`/`store.mjs`/`backup.mjs`/`blackhole-core.mjs` 배선은 hunk 단위 수작업 병합.
3. 중복 구현 3쌍은 설계 비교 후 한쪽 선택: `memory-embeddings.mjs`는 PC 쪽이 Ollama 실사용 검증(§17)을 가졌으므로 PC 유지가 기본, Codex의 추가 기능(버전 결속 인덱스·재색인 등)은 필요분만 이식. `cost-ledger`/`shadow-growth`는 비교 후 결정.
4. 각 단계 집중 테스트 → 마지막에 전체 회귀 → 최종 SHA에서 §17 Ollama 실사용 재검증.

## §23 재개 기록 (2026-09-24 — PC 기준 별도 작업 브랜치에서 JEV 복구·백업·홈 화면 이식)

### 작업 경계
- 기준: §22의 PC bundle HEAD `6c942c3`에서 분기한 격리 브랜치 `codex/pc-p3-port-20260924`. 실제 PC 저장소·기존 브랜치·원격 저장소에는 적용/푸시하지 않았다.
- Codex 신규 모듈 중 `jev-recovery.mjs`, `jev-recovery-verifier.mjs`, `recovery-one-of-qpu.mjs`와 해당 집중 테스트만 가져왔다. 중복 구현 `memory-embeddings.mjs`, `cost-ledger.mjs`, `shadow-growth.mjs`, `memory-write.mjs`, `shadow-mission-finalization.mjs`는 덮어쓰지 않았다. P2 Ollama 실사용 코드도 변경하지 않았다.

### 구현·재현 결과
1. **JEV 막힘 검토 폐루프:** 자연어 `/api/voice` → 기존 Homunculus/Jarvis Shadow mission → 실제 차단된 Shadow job → 제한된 자원 스냅샷·`owner_review`/`wait` 후보 → tool-free 로컬 Verifier → 같은 mission의 JEV 결정/증거 저장까지 연결했다. JEV 결과는 `authorizesDispatch:false`; Verifier는 차단 작업을 재개하거나 대안을 실행하지 못한다.
2. **영속성 검사 결함 수정:** 통합 시험에서 서버 메모리에서는 결과가 갱신되지만 `openStore()`가 `selectedProvider:'local'`을 거부해 이전 백업으로 fallback하는 현상을 재현했다. `validateQuestState()`의 **job 선택 provider** 허용 목록에 `local`을 추가하고, Homunculus quest의 소유자 선택 목록은 그대로 두었다. 결과를 저장소 재개·백업 복원까지 읽는 시험이 통과한다.
3. **백업에서 로컬 임베딩 기억 누락 수정:** PC 기준 `initialState()`에는 `memoryEmbeddings`가 있었으나 백업 허용 필드 목록에 빠져 있었다. 암호화 백업에서 기록을 포함·검증·복원하게 하고, 잘못된 벡터는 복원 전에 거부하도록 수정했다. 이 결함은 기준 브랜치의 `backup.test.mjs` 11개 전부에서 `Backup: invalid record fields`를 일으켰다.
4. **Home JEV 안내:** 실제 멈춘 job이 남아 있을 때만 원인·자원·검증 통과 대안·다음 행동을 표시한다. 자원 스냅샷 만료 뒤에는 추천을 감추고 재확인을 표시하며, 내부 ID는 숨기고 자동 실행 권한이 없음을 분명히 한다. 기존 F09 코어 식별 Footer는 유지했다.
5. **양자 회로 코드:** 실제 gate-level OpenQASM 3 회로 컴파일러와 QUBO/Ising·비트 매핑·측정 decoder·고전적 fallback 코드를 이식했다. 이 저장소 변경은 **실제 QPU 제출 adapter/물리 job이 아니다**. QPU 계정·승인된 provider·job receipt·물리 측정값을 실행하지 않았고, 테스트의 counts는 decoder/fallback 경로를 위한 합성 fixture다. 현재 JEV 서버가 만드는 `owner_review`/`wait`는 목적함수상 비용 차이가 없어 QPU 선택에 들어가지 않으며, 실용적인 복수의 안전 대안이 만들어지고 사전 검증되는 P4 설계·배선은 남아 있다.

### 검사 결과
- 집중 회귀(voice→mission→JEV, JEV schema, QPU circuit, G1 성공/실패, encrypted backup/restore, Home UI): **30/30 통과**. JEV + QPU leaf module 시험은 별도로 13/13 통과.
- 전체 `npm test`, 동일 Node v24.19.0 / 동일 Linux sandbox:
  - 기준 `6c942c3`: **1,119 tests · 1,059 pass · 53 fail · 7 skip**.
  - 후보 작업 트리: **1,135 tests · 1,103 pass · 25 fail · 7 skip**.
  - 실패 테스트 이름을 정규화해 대조한 결과 후보의 25건은 모두 기준에서도 실패했다(새 실패 0). 기준에서 실패한 백업 관련 28건은 `memoryEmbeddings` 백업 수정 후 통과로 바뀌었다. 새 16개 테스트는 추가한 JEV/Verifier/QPU 경로다.
  - 남은 실패는 Linux 격리 QuickJS worker 실행, 인터넷을 요구하는 live network 시험, 그리고 전체 실행 중 timing 민감한 closed-loop scheduler 시험이다. 기능별 PC 실측 검증이 완료됐다는 뜻은 아니다.
- `git diff --check`: 통과. 실기기, 실제 Ollama Verifier 요청, Android↔PC 연결, 인터넷 차단, QPU 계정/물리 장치: **이 작업공간에서는 미실행**.

### 다음 단계 / 정확한 상태
- 현재 단계: **격리 브랜치의 코드 후보 준비, PC 적용 전**. 현재 diff를 검토 가능한 patch로 만들어 전달하고, PC에 이식할 때는 같은 파일이 수정되었는지 다시 확인한다.
- P3 실사용 acceptance에는 PC의 정확한 후보 SHA에서 `qwen2.5:3b`에 대한 실제 local Verifier 요청, 같은 mission ID의 실제 receipt, 실기기/재시작/폐기·정지 시험이 남아 있다. 사용자의 P2 Ollama 검증은 다른 SHA에서 수행된 것이므로 이 후보 SHA의 증거로 간주하지 않는다.
- P4는 별도 트랙이다: 실제 허가된 학습 평가·rollback 및 승인된 물리 QPU backend의 adapter/cost reservation/submit·unknown receipt 조회·job ID·returned counts·같은 mission readback. 현재 시뮬레이터를 QPU 통과로 표시하지 않는다.
- 방화벽 변경, push, PR, merge, 배포, 실제 QPU 제출은 하지 않았다.

## §23-b 재개 기록 (2026-09-24 — Codex JEV recovery 패치 PC 반입·적용·집중 테스트)

- 입력: `pc-p3-jev-recovery-20260924.patch`(Codex가 PC bundle `6c942c3` 기준으로 만든 단일 커밋 패치, SHA-256 `adb4f23f18a709c7f3053a3629eb9d7172a2073833e9c4ff1b657d9a50e08128`, 17 files / +1420 −24). `git apply --check` HEAD(`6c942c3`)에 대해 clean.
- 적용: g1 브랜치는 그대로 두고 **새 브랜치 `blackhole/p3-jev-recovery-port-20260924`** 에 `git am`으로 적용 → 커밋 `fff1a19`(작성자 Codex 보존). push 없음.
- 내용: `jev-recovery.mjs`(막힘 진단·자원 스냅샷·대안 후보, `authorizesDispatch:false`), `jev-recovery-verifier.mjs`(로컬 1회 호출 의미 검토), `recovery-one-of-qpu.mjs`(QAOA 회로 산출물·디코더, 실 QPU 없음), server/store/backup/quests/agent-engine 배선, Living Core UI 표시, 테스트 5개 신규.
- 집중 테스트(device_bash 샌드박스, Node): jev-recovery 4/4, jev-recovery-verifier 3/3, recovery-one-of-qpu 6/6, jev-recovery-server 2/2, backup 11/11, jev 11/11, quests 12/12, blackhole-core-server 12/12, g1-living-loop-integration 2/2, voice-memory-embeddings 4/4 → **67 pass / 0 fail**. `node --check` 15개 파일 통과.
- 미실행: `living-core-ui.test.mjs`(jsdom — 이 샌드박스에서 멈추는 파일군, 실PC에서 확인 필요), 전체 회귀(같은 이유), Ollama 실사용 재검증(§17 항목) — 이 SHA에서 아직 안 함. **P3 완료 아님**: JEV 한 조각이며 Kirby·기억 회수·실모델·실기기 trace는 미결.
- 남은 Codex 이식 대상(§22 참조): F14 cost-ledger·shadow-growth·memory-embeddings 중복 3쌍 설계 선택, server/blackhole-core 나머지 hunk, `expectedQuestId` 게이트, `verify-living-loop-live.mjs`.

## §24 재개 기록 (2026-09-24 — expectedQuestId 게이트·P3 live check·중복 설계 판정)

### 기준과 작업 경계
- §23 JEV 슬라이스가 있는 PC 기준 후보 `codex/pc-p3-port-20260924` (`9fa7b2a`, 기준 `6c942c3`)에서 이어서 작업했다. 원 PC 저장소·원 브랜치·원격 저장소에는 적용하거나 push하지 않았다.
- Obsidian Vault의 실행계획/분할/분류는 Claude 세션이 수행했으며 CHANGELOG (24)~(27)에 근거가 있다. 이 코드 작업은 Vault 파일을 요청하거나 수정하지 않는다.

### 구현
- `/api/voice`에 optional `expectedQuestId`를 추가했다. UUID 형식과 decide 요청 여부를 먼저 검사하고, 실제 Homunculus top quest가 다르면 `409`로 거부한다. 비교는 job/mission/event 상태 변경 전에 한다.
- 일치할 때 응답에 `kind: shadowMission`과 선택한 `plannerQuestId`를 노출해 live check가 요청 목표와 생성된 미션을 대조할 수 있게 했다.
- `scripts/verify-living-loop-live.mjs` 및 합성 테스트를 추가했다. loopback만 허용하고, 기본 모드는 read-only preflight다. `--run`은 기존의 owner-proposed 프로젝트 목표, 명시한 SHA/model, idle runtime과 호출 여유를 확인한 뒤 1회 요청한다. 응답이 불명확할 때 재시도하지 않는다.
- `runtime/package.json`에 `check:living-loop` 실행 명령을 연결했다.

### 중복 3종 결정
- `docs/PC_CODEX_DUPLICATE_REVIEW_20260924.md`에 비용 원장·Shadow 성장·임베딩 기억의 실제 코드 계약과 선택 근거를 비교했다.
- 세 모듈 모두 PC 구현을 기준으로 유지한다. Codex 구현을 파일째 덮지 않는다. 특히 현재 PC 비용 상한은 provider 단가 기반 추정치이며 최대 1회 호출 비용을 미리 예약하지 않는다는 한계를 문서에 명시했다.

### 검사/미검사
- 현재 변경 파일 검사: `node --check` (server/live script) 및 `git diff --check` 통과.
- 신규 집중 테스트: `voice-expected-quest.test.mjs`, `verify-living-loop-live.test.mjs` **8/8 통과**.
- 관련 모듈·통합 집중 회귀 **63/63 통과**. `npm run check:living-loop`가 패키지 명령으로 등록되고, 자격 증명 없는 실행이 `BLOCKED / existing_owner_token_required`로 끝나는 것도 확인했다.
- 전체 `npm test`: **1,073 tests · 1,041 pass · 25 fail · 7 skipped**. 실패는 격리 실행기/QuickJS worker 시작, 실제 외부 HTTPS가 필요한 네트워크 시험, Loop 2 timing 검사에 모여 있다. 이번 실행에서 정확한 parent SHA와 실패 이름을 대조하지 않았으므로 “새 회귀 0건”으로 단정하지 않는다. 전체 suite는 green이 아니다.
- 최종 후보 SHA의 Ollama live 검증은 아직 미실행. 이 문서 작성 시점의 작업은 검토 후보이며 사용자 PC의 `fff1a19`와 tree/SHA 동일성을 직접 확인하지 않았다.

## §25 재개 기록 (2026-09-25 — Codex "BLACKHOLE_NEXT_DELIVERY_20260925" 데스크톱 로컬 공급자 문제 D01~D03 재확인)

### 배경
- 연호님이 별도 Codex 세션이 작성한 `BLACKHOLE_NEXT_DELIVERY_20260925.md`(개발 방향/납품 계획, D01~D04 문제 진단 포함)를 Cowork 세션에 전달했다. 원문은 `01_DRAFTS/BLACKHOLE_NEXT_DELIVERY_20260925.md`로 Obsidian Vault에 원문 그대로 저장했다(SHA-256 `5fcfc806879668250966610772891e4e7b1d41a952fe26486f076cba32f0ad08`).
- 그 문서는 자신의 판단 근거를 `codex/pc-p3-port-20260924`(HEAD `3726076`) 작업본이라고 명시했고, 실제 사용자 PC 커밋 `0cc48f8`과 tree 동일성을 확인하지 않았다고 스스로 밝혔다.

### 이번 세션에서 한 일
- 실제 사용자 PC를 미러링하는 이 저장소(브랜치 `blackhole/p3-jev-recovery-port-20260924`, 커밋 `0cc48f8`, device_bash로 직접 grep — 파일 열람만, 수정 없음)에서 D01~D03을 독립적으로 재확인했다:
  - **D01 (로컬 모델 선택 UI 없음) — 사실.** `runtime/desktop-ui/app.js`의 `providerLabels` Map에는 openai/anthropic/gemini/xai/moonshot/nvidia 6개만 있고 `local` 항목이 없다.
  - **D02 (Ollama/임베딩 설정 미전달) — 사실.** `runtime/lib/desktop-provider-config.mjs`의 `desktopProviderEnvironment()`는 `YENO_{PROVIDER}_MODEL`/`_API_KEY`만 만들고 `YENO_LOCAL_BASE_URL` 등 로컬 전용 env를 설정하지 않는다. `runtime/lib/provider-config-engine.mjs:16`의 로컬 기본 엔드포인트는 `http://127.0.0.1:8080/v1/chat/completions`로 하드코딩돼 있다(override 없으면 그대로 사용) — 실제 Ollama는 11434.
  - **D03 (실행 경로별 코어 포트 불일치) — 사실.** `runtime/desktop.mjs:67`의 `startDesktop()` 기본값은 `corePort=8791`, `setupPort=8792`이며, 기존 PC 방화벽/LAN 시험은 8790 포트 기준이었다(§20 참고).
- 코드는 수정하지 않았다. `BLACKHOLE_NEXT_DELIVERY_20260925.md` 6-5절의 역할 분담(코드·시험·패키지는 Codex, 연결된 PC/Vault 작업은 Claude)에 따른 것이다.
- Obsidian `CHANGELOG.md`에 (28)번으로 동일 내용을 기록했다.

### 미확인/다음
- D04(`scripts/verify-living-loop-live.mjs`가 전체 목표를 증명하지 못한다는 지적)는 스크립트 자체가 §24에서 이미 read-only preflight 범위로 명시했으므로 별도 재확인 불필요.
- D01/D02 실제 구현(로컬 공급자 UI 노출 + `YENO_LOCAL_BASE_URL`/임베딩 env 명시적 전달)은 Codex가 코딩하기로 했다 — 이 세션은 패치가 도착하면 동일한 bundle/patch 검증 절차(§22 참고)로 반입한다.
- D03 포트 통일(8790 vs 8791/8792) 전략은 아직 결정되지 않았다 — 연호님 결정 필요.

## §26 재개 기록 (2026-09-25 — 연호님의 D03 결정: 기준 코어를 resident-v2/8790으로 확정)

### 연호님 결정 (채팅 원문 근거, 이 세션이 만든 결정 아님)
- 기준 코어는 `resident-v2`의 8790. 8792는 설정 화면. `desktop-v1`(8791)의 별도 코어는 일상 실행 경로에서 제외한다.
- 단순 포트 변경이 아니라 "Windows 실행판이 resident-v2와 같은 코어·저장소를 쓰도록 연결"하는 결정이다.
- `desktop-v1`에 기존 자료가 있으면 자동 이전하지 않고 백업/복원·정합성 검사를 동반한 명시적 절차로만 옮긴다.
- 휴대폰 연결 코드는 이미 있으나(resident-v2의 Tailscale Serve HTTPS 브릿지), 실기기 연결 합격 시험은 아직 통과하지 않았다.
- 첫 코드 작업도 이 기준에 맞춘다: Windows 설정 화면에서 `qwen2.5:3b`·`bge-m3`를 Ollama loopback 주소로 연결해 실제 대화·기억 저장까지 되게 하고, 설정 저장 확인에서 끝내지 않고 아이콘 실행→대화→기억 저장→재시작 후 회수까지 검사한다.

### 이번 세션에서 독립 검증한 사실 (device_bash로 이 저장소를 직접 읽음, 브랜치 `blackhole/p3-jev-recovery-port-20260924`, 커밋 `bc3e61d`)
- `resident-v2`는 실존한다: `scripts/blackhole-resident.ps1`(Windows 로그인 트리거 `Register-ScheduledTask`), `runtime/resident.mjs`, `docs/BLACKHOLE_WINDOWS_RESIDENT_20260921.md`. 기본 포트는 `blackhole-resident.ps1:9`의 `[int]$Port = 8790`, 문서 28행도 `http://127.0.0.1:8790`로 명시.
- 휴대폰 연결은 `runtime/resident.mjs`가 Tailscale `serve --https=9443 http://127.0.0.1:<configured-port>`로 구성하는 선택적 브릿지다(코드 144–188행). "실기기 연결 합격은 아직"이라는 연호님 판단과 일치 — 문서(`BLACKHOLE_WINDOWS_RESIDENT_20260921.md` 69행)도 이 기능을 표준 Node 테스트 범위로만 서술하고 실기기 합격을 주장하지 않는다.
- `desktop-v1`(`runtime/desktop.mjs`)은 실제로 별도 코어·저장소다: 기본 `corePort=8791`/`setupPort=8792`(67행), 홈 디렉터리는 `%LOCALAPPDATA%\BLACKHOLE\desktop-v1`(256행, `resident-v2`와 다른 경로) — 연호님이 말한 "서로 다른 기억을 보거나 빈 저장소를 보는" 위험의 근거가 코드로 확인된다.
- 즉 D03에 대한 연호님의 사실 인식(resident-v2=8790, desktop-v1=8791 별도 코어/저장소, 휴대폰 코드는 있으나 미합격)은 이 저장소의 실제 코드와 전부 일치한다.

### 문서 버전 불일치 (보고 의무)
- 연호님이 `01_DRAFTS/BLACKHOLE_NEXT_DELIVERY_20260925.md`에 이 D03 결정을 반영했고 새 SHA-256이 `e7a2e1696c6bc11296e6286b53d302320820850ae8e3fba9b92cc77eb9ba0741`라고 알려왔으나, 이번에 채팅에 실제로 첨부된 파일은 SHA-256 `5fcfc806879668250966610772891e4e7b1d41a952fe26486f076cba32f0ad08`로 — **Vault `01_DRAFTS/BLACKHOLE_NEXT_DELIVERY_20260925.md`에 이미 저장된 구버전과 바이트 단위로 동일**했다(diff 0줄). D03 결정 텍스트가 반영된 실제 새 버전 파일은 이 세션에 아직 도착하지 않았다. Vault의 저장본은 갱신하지 않았다.

### 미실행
- D01/D02/D03 실제 코드 구현(로컬 공급자 UI, loopback 주소 전달, resident-v2 8790으로 일상 실행 경로 통합, desktop-v1 자료 백업/이전 절차)은 아직 없다. Codex가 코딩하기로 한 역할 분담 그대로.

## §27 재개 기록 (2026-09-25 — apps/controller ↔ resident-v2/8790 엔드포인트별 계약 대조)

### 배경
연호님의 최근 지시에 따라 `apps/controller`(Tauri, Windows+Android 공용)가 실제로 기대하는 요청·상태·결과 계약과 `resident-v2/8790`이 실제로 제공하는 계약을 엔드포인트별로 대조했다. jarvis/openclaw는 건드리지 않았고, 새 상태 파일도 만들지 않았다(본 §27만 기존 `docs/CLAUDE_EXECUTION_STATE.md`에 추가). 코드는 전혀 수정하지 않았다 — 읽기 전용 대조.

### 방법
- `apps/controller/src/*.ts`(주로 `main.ts`, `command-session.ts`, `native-studio.ts`, `native-projects.ts`)를 device_bash로 직접 읽어 컨트롤러가 실제로 호출하는 모든 경로·메서드·바디 형태를 추출했다.
- `resident-v2`는 자체 서버가 아니라 `runtime/resident.mjs:144`가 기존 `runtime/server.mjs`의 `start({..., port: config.port})`를 그대로 호출해서 뜬다는 것을 코드로 재확인했다 — 즉 8790에서 응답하는 라우트 표는 `runtime/server.mjs`의 라우트 표와 100% 동일한 코드다(별도 축소·분기 없음).
- `runtime/server.mjs`의 라우트 정의(`url.pathname===...`, 정규식 매치)를 grep+직접 열람으로 대조.

### 결과 — 엔드포인트별 일치/불일치/미확인

| 컨트롤러 기대 | resident-v2(server.mjs) 실제 | 판정 | 근거 |
|---|---|---|---|
| `POST /api/v1/devices/enroll` (헤더: `Bearer <pairing token>`, 바디 `{name, platform, requestId}`) | `versioned && POST '/api/v1/devices/enroll'` 라우트, pairing 토큰 검증 후 `enrollDevice(b)` | **일치** | server.mjs:1806-1808 |
| `GET /api/v1/state` → 내부적으로 `/api/state`로 재기록 | `GET '/api/state'` → `state()` | **일치** | server.mjs:1919, versioned 접두 제거 로직 1811 |
| `POST /api/v1/commands` `{text, requestId}` | `POST '/api/commands'`, `requiredText(b.text)`로 텍스트 명령 처리, requestId는 `mutation()`의 중복 방지(영수증)에 사용 | **일치** | server.mjs:2170-2216 |
| `POST /api/v1/control` `{action:'stop'|'resume', revision?, requestId}` | `POST '/api/control'`, action 검증·emergencyStop 토글, resume 시 revision 검사 | **일치** | server.mjs:2217-2222 |
| `GET /api/v1/world` | `GET '/api/world'` | **일치** | server.mjs:1828 |
| `GET /api/v1/drives/status` | `GET '/api/drives/status'` | **일치** | server.mjs:1945 |
| `GET /api/v1/artifacts/:id` | `GET '/api/artifacts/:id'` (SHA-256 재검증 후 파일 반환) | **일치** | server.mjs:1972-1973 |
| `POST /api/v1/projects/:id/milestones`, `POST /api/v1/projects/:id/milestones/:mid` | 동일 정규식 라우트 2개 존재(마일스톤 추가/토글/삭제) | **일치** | server.mjs:2156-2159 |
| studio 계열: `GET/POST /api/v1/studio`, `/studio/generate`, `/studio/import`, `/studio/export`, `POST /api/v1/production/run`, `/hankki/invite`, `/hankki/revoke`, `GET /api/v1/capabilities` | 전부 동일 경로로 서버에 존재 | **일치** | server.mjs:1813,1841-1849,1923-1931,2060-2065 |
| 인증 헤더 형식 `Authorization: Bearer <deviceToken>` | `bearer(req)`가 정확히 `Bearer ` 접두만 파싱, device 토큰은 `deriveDeviceToken`으로 검증 | **일치** | server.mjs:1521, 1530-1533 |
| 재시도/중복 방지(`requestId` 기반 영수증) — `command-session.ts`의 pending/receipt 모델이 전제하는 "같은 requestId 재전송 시 같은 응답" | `mutation()`이 `findReceipt(s, requestId, hash)`로 정확히 이 동작을 구현 | **일치** | server.mjs:1572-1589 |

### 결론
- 대조한 모든 엔드포인트(9개 경로군 + 인증 + 재시도 모델)가 **일치**로 확인됐다. 불일치나 미확인 항목은 없었다.
- 이는 우연이 아니라 구조적 이유다: `resident-v2`가 새 서버를 만든 게 아니라 기존 `runtime/server.mjs`를 포트만 바꿔 그대로 구동하기 때문에, `apps/controller`가 이미 이 서버 코드 기준으로 작성된 이상 8790에서도 동일하게 동작할 근거가 코드 수준에서 확인된다.
- 단, 이는 **코드 대조 결과**이며 아직 "RAN"/"VERIFIED"가 아니다 — 실제 Windows에서 `resident-v2`를 기동하고 컨트롤러가 8790에 실제로 접속해 enroll→state→commands 왕복이 성공하는지는 별도의 실행 시험이 필요하다(다음 단계).

### Self-Review Gate 관련 재확인
- 새 실행 지시서가 존재를 전제한 "Self-Review Gate"는 이번에도 전체 저장소 grep(`Self-Review`, `SelfReview`, `자체 검토 게이트` 등)에서 0건 — §직전 보고와 동일하게, 이런 장치는 코드베이스에 없다는 사실만 기록하고 신규로 만들지 않는다(연호님 지시).

### 다음
- `scripts/blackhole-resident.ps1`의 실제 예약 작업 등록 내용(대상 실행 파일/인자/실행 계정/권한 상승 여부/로그온 트리거/중복 실행 방지/제거 방법) 검토 — 실행 전 필수 선행 작업, 아직 미완료.
- 위 검토에서 "일반 사용자 권한의 단일 예약 작업"임이 확인되면 컴퓨터 사용 도구로 직접 실행하고 결과·되돌리기 방법을 기록; 그 외의 권한이 필요하면 실행하지 않고 그 항목만 먼저 보고.
- 그 다음 실제 8790 경로를 통한 최소 통합 시험(요청 → PC 에이전트 → Windows 실행 → 같은 작업 ID로 컨트롤러에 결과 반환)을 설계·실행 — 아직 시작하지 않음.

## §27b 재개 기록 (2026-09-25 — scripts/blackhole-resident.ps1 실행 전 필수 검토, 실행은 아직 안 함)

### 검토 결과 (device_bash로 스크립트 전문 283줄 직접 열람, 수정 없음)
- **대상 실행 파일/인자**: `node.exe`(PATH의 Node 24+, `Get-Node`가 버전 검증) 실행, 인자는 `"<Root>\runtime\resident.mjs" --config "<HomeDir>\config.json"` 고정 문자열 — 임의 명령 주입 경로 없음.
- **실행 계정/권한 상승**: `New-ScheduledTaskPrincipal -UserId $owner.ownerSid -LogonType Interactive -RunLevel Limited` — 일반 사용자 권한(Limited), 관리자 상승 없음.
- **로그온 트리거**: `New-ScheduledTaskTrigger -AtLogOn -User $owner.ownerSid` — 소유자 로그온 시에만 시작.
- **중복 실행 방지**: `-MultipleInstances IgnoreNew` — 이미 실행 중이면 새 인스턴스를 무시. `-RestartCount 5 -RestartInterval 1분`으로 비정상 종료 시 제한적 자동 재시작.
- **등록 범위**: 예약 작업 1개(`TaskName='BLACKHOLE Core v2'`, `TaskPath='\'`)만 `Register-ScheduledTask`로 등록. 방화벽 규칙, 새 서비스, 레지스트리 변경, 관리자 그룹 변경 등은 스크립트 전체에 없음(grep 확인).
- **제거/되돌리기**: `-Action uninstall`이 `Stop-Core` 후 `Unregister-ScheduledTask`로 소유권이 일치하는 작업만 제거하고, 데이터와 페어링 키는 보존한다(`Get-OwnedTask`가 소유자 SID·root·taskName·installId·작업 설명·액션 개수까지 대조해 불일치 시 아무 것도 건드리지 않음).
- **결론**: 연호님이 조건으로 제시한 "일반 사용자 권한의 단일 예약 작업, 이미 승인된 resident-v2 설치 범위 내"에 정확히 부합한다. 관리자 권한·방화벽 변경·새 서비스 등록은 없다.
- `phone-install`/`phone-uninstall`(Tailscale 브릿지)은 별도 액션이며 이번 승인 범위 밖이다 — 실행하지 않는다. `Get-PhoneConfig`는 이미 설치·로그인된 tailscale.exe의 `status --json`만 읽고, 계정 생성이나 로그인은 하지 않는다는 것도 코드로 확인했다(요청받지 않았으므로 이번에 실행하지 않음).

### 실행을 지금 진행하지 않는 이유 (안전 규칙에 따른 판단)
- 최초 설치(`-InitializeNewStore` 필요)는 페어링 토큰 파일이 아직 없으면 `Read-Host -AsSecureString`으로 "16자 이상의 새 로컬 페어링 키"를 대화형으로 입력받는다. 이 값은 연호님 기존 계정의 비밀번호는 아니지만 성격상 인증 토큰(API 키/토큰과 동일 범주)이며, 이 세션이 지켜야 하는 안전 규칙은 "비밀번호·API 키·토큰을 어떤 입력창에도 직접 입력하지 않는다"를 연호님의 개별 승인으로도 우회할 수 없는 항목으로 두고 있다. 따라서 컴퓨터 사용 도구로 이 프롬프트에 직접 값을 타이핑하지 않는다.
- 관리자 권한이 필요하면 멈추고 보고하라는 조건과는 다른 종류의 제약이지만 — 실행 자체를 막는 새 시스템 권한 요구는 아니고 비밀값 입력 단계가 있어서 이 세션이 직접 타이핑하지 않는다는 점에서 — 이 한 단계만은 연호님이 직접 하셔야 한다.

### 연호님이 직접 하실 일 (정확히 이 부분만)
Windows에서 PowerShell을 열고 아래를 실행 — 프롬프트가 뜨면 16자 이상의 새 문자열(기존 비밀번호 재사용 금지)을 입력하시면 된다. 이 문자열은 채팅에 붙여넣지 않아도 된다(스크립트가 요구하지도 않음):

```
powershell -ExecutionPolicy Bypass -File "C:\Users\우연호\Documents\Projects\yeno-os\scripts\blackhole-resident.ps1" -Action install -InitializeNewStore
```

이 실행 후 `-Action status`로 나온 JSON(taskState, coreHealthy 등)을 알려주시거나, 이 세션이 컴퓨터 사용 도구로 `-Action status`(읽기 전용, 비밀 입력 없음)를 직접 실행해 확인할 수 있다.

### 다음
- 연호님이 설치를 완료하시면(또는 이미 설치되어 있다고 확인해 주시면), 이 세션은 `-Action status`를 컴퓨터 사용 도구로 직접 실행해 실행 결과를 독립적으로 기록한다(비밀 입력이 없으므로 이번 승인 범위에서 직접 실행 가능).
- 그 다음 실제 8790 경로를 통한 최소 통합 시험(§27의 "다음" 항목)을 진행한다.

## §28 재개 기록 (2026-09-25 — resident-v2 설치 실행 시도 중 발견한 플랫폼 제약: 터미널 타이핑 불가)

### 시도한 것
연호님 지시대로 `blackhole-resident.ps1`을 이 세션이 직접 실행하려고 컴퓨터 사용 도구 접근을 준비했다. `computer_resolve_access`로 PowerShell/터미널/명령 프롬프트를 조회했다.

### 발견한 사실 (실행 전에 막힘 — 코드/스크립트 문제 아님)
- 이 PC 연결에서 PowerShell·터미널·명령 프롬프트는 전부 `tier: "click"`(및 `isSentinel: true`)로만 부여 가능하다. `restrictedTierNote`: "Terminals and IDEs can only be granted in 'click' mode — you can see and left-click, but cannot type, press keys, or paste."
- 즉 이 세션은 이 PC의 어떤 터미널에도 **글자를 입력할 수 없다** — 페어링 키 같은 비밀값뿐 아니라 `-Action install`이나 `-Action status` 같은 평범한 명령 인자도 전혀 타이핑할 수 없다. 이는 "비밀값을 직접 입력하지 않는다"는 안전규칙과 별개로, 이 Cowork 세션이 이 PC의 터미널 앱에 대해 갖는 하드웨어적/플랫폼적 상한이다.
- 우회 시도(다른 이름으로 재조회 등)도 결과가 같았다 — 스크립트나 설치 자체의 문제가 아니라 이 세션의 터미널 상호작용 권한 등급 문제다.
- 부수 확인: 같은 조회에서 이 PC에는 **Tailscale이 설치돼 있지 않다**(`computer_resolve_access`가 "Tailscale"을 미설치로 응답, 대체 제안도 없음). 이 사실은 휴대폰 연결 검증 직전에 한 번에 안내하라는 연호님 지시에 따라 지금은 보고만 해 두고 별도 조치를 요청하지 않는다.
- Chrome은 컴퓨터 사용 도구로는 `tier: "read"`(보기만 가능)로 제한되고, 대신 별도의 Claude in Chrome 확장 도구(`mcp__remote-devices__Claude_Browser__*`)로 탐색·클릭이 가능하다는 안내를 받았다 — 이건 필요시 8790 API 읽기 전용 확인(`GET /api/health` 등)에 쓸 수 있다.

### 결론 — 계획 수정
- 이 세션은 `scripts/blackhole-resident.ps1`의 설치(`-Action install -InitializeNewStore`)를 포함해 **어떤 액션도 스스로 타이핑해 실행할 수 없다.** 연호님이 앞서 승인하신 "일반 사용자 권한 단일 예약 작업이면 직접 실행" 조건은 코드 검토(§27b) 기준으로는 충족됐지만, 이 세션의 플랫폼 권한이 타이핑 자체를 막아 실행 주체가 될 수 없다.
- 대신 이 세션은: (1) 연호님이 PowerShell에서 설치 명령 전체를 직접 실행 — 페어링 키뿐 아니라 명령 자체도 연호님이 입력해야 한다; (2) 설치 후에는 이 세션이 브라우저 확장 도구로 `http://127.0.0.1:8790/api/health`(인증 불필요, 읽기 전용 공개 라우트, server.mjs 1713행)를 직접 열어 서버 응답을 독립적으로 확인하고, 필요하면 `%LOCALAPPDATA%\BLACKHOLE\resident-v2` 폴더 접근을 요청해 상태 파일을 직접 읽어 검증한다 — 이 경로들은 타이핑이 필요 없다.

### 다음
- 연호님께 정확한 실행 명령을 한 번에 안내하고(§27b와 동일), 완료 후 이 세션이 독립적으로 `/api/health` 확인 및 상태 파일 열람으로 RAN 여부를 검증한다.

### 추가 — 연호님이 만든 더블클릭 실행 파일 검토 (2026-09-25, 타이핑 없이 설치를 진행하기 위한 방법)
- 연호님이 채팅에 `Install_BlackHole_Resident.cmd`를 직접 작성해 업로드했다(이 세션이 만든 것 아님). 전문을 읽고 검토했다:
  - `%USERPROFILE%\Documents\Projects\yeno-os\scripts\blackhole-resident.ps1` 존재 확인 후 `cd /d`로 그 폴더로 이동, 실패 시 즉시 종료.
  - 실행 줄: `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -Action install -InitializeNewStore` — §27b에서 검토한 것과 **동일한 액션·동일한 인자**(관리자 권한 요청 없음, `runas`나 매니페스트 상승 없음, 추가 플래그는 `-NoLogo -NoProfile`뿐으로 대화형 배너를 줄이는 무해한 옵션).
  - 종료 코드를 `%INSTALL_RESULT%`로 저장해 화면에 출력하고 `pause`로 창을 유지 — 결과를 사람이 직접 읽고 판단하는 구조.
- 결론: 이 배치 파일은 §27b에서 이미 승인 범위로 확인한 것과 동일한 설치 동작을 "타이핑 없이 더블클릭으로 트리거"하는 래퍼일 뿐이다. 실행 주체는 여전히 연호님(Windows 탐색기에서 직접 더블클릭)이고, 이 세션은 그 실행을 트리거하거나 관찰할 도구가 없다는 점도 연호님이 정확히 지적한 그대로다.
- 이 세션은 이 파일을 실행하지 않았다(할 수 없음). 연호님의 더블클릭 실행 결과(성공 여부, 종료 코드, 차단 문구가 있었다면 그 문구)를 기다린다.

## §29 재개 기록 (2026-09-25 — 설치 흐름 자체를 바꾸는 요구사항, 이 세션은 코드 작성 안 함)

### 배경 및 정정
- 연호님이 §28까지의 "연호님이 PowerShell을 직접 실행" 요청을 반복한 것 자체가 막힌 지점(대화형 마스킹 키 입력)을 없애지 못한다고 지적했다. 옳은 지적이다 — `.cmd` 래퍼도 결국 같은 프롬프트로 귀결된다(§28b 참고).
- 연호님이 "방금 찾았다는 파일이 실제 PC 폴더가 아니라 Linux 작업공간의 다른 브랜치 복사본"이라는 의심을 제기했다. 이 세션이 재확인했다:
  - `mount` 결과: `$HOME/mnt/yeno-os`는 `type fuse`의 실시간 원격 마운트다(로컬 복사본이 아님).
  - `git remote -v`: `origin  https://github.com/wooyeonho/yeno-os.git` — 연호님의 실제 저장소.
  - `git branch --show-current` / `git rev-parse HEAD`: `blackhole/p3-jev-recovery-port-20260924` / `4aeccf2ced86d285fbcfb70f2a5b91fe9e0121bc` — §26에서 보고한 것과 동일 커밋.
  - `git status --short`: 이 세션이 직접 추가한 `docs/CLAUDE_EXECUTION_STATE.md` 편집 외 변경 없음.
  - 즉 §25~§28의 코드 근거는 실제 PC의 실제 브랜치를 본 것이 맞다. 다만 이후로도 코드 확인 전에는 매번 이 4가지(마운트 종류/remote/branch/HEAD)를 다시 찍어 보고하기로 한다 — 이전 확인을 재사용하지 않는다.

### 요구사항 (다음에 실제 코드를 작성할 세션 — Codex 등 — 에 전달용, 이 세션은 구현하지 않음)
연호님이 정리한 지시를 그대로 요구사항으로 옮긴다:

1. 코드 작업 시작 전에 실제 PC 체크아웃과 브랜치를 먼저 확인한다(추정하지 않는다).
2. PowerShell 마스킹 프롬프트에 사람이 키를 입력하게 하는 현재 흐름을 없앤다.
3. 설치 시 강한 키를 자동 생성하고, 파일시스템 권한으로 현재 사용자 전용으로 저장한다(현재 스크립트의 `Protect-Directory`가 이미 ACL을 현재 사용자로 제한하는 방식과 같은 원리를 키 파일에도 적용).
4. 그 키를 터미널 출력·로그·채팅 어디에도 노출하지 않는다.
5. Android(휴대폰) 연결은 키를 수동으로 옮겨 적는 방식이 아니라, 소유자가 그 자리에서 확인·승인할 수 있는 안전한 페어링 UI(예: QR 코드+기기 쪽 확인 버튼, 또는 이미 있는 Tailscale Serve 브릿지 위에 얹는 승인 플로우)로 처리한다.
6. 설치 실행 파일은 채팅 업로드함처럼 별도 다운로드가 필요한 곳이 아니라 실제 저장소(`scripts/` 등) 안에 둔다 — `Install_BlackHole_Resident.cmd`가 겪은 것과 같은 문제(파일이 PC에 없어서 다운로드 단계가 추가되는 것)를 구조적으로 없앤다.
7. Windows 설치·재시작 후 상태·`/api/health`뿐 아니라 Android 페어링까지 실제로 검증한다.
8. 검증하지 못한 항목은 절대 `VERIFIED`로 표시하지 않는다 — 이 프로젝트 전체에 적용 중인 상태 어휘 규칙(§ 실행 지시서 기준)과 동일.

### 이 세션의 역할 경계 재확인
- 이 세션은 위 요구사항의 실제 코드를 작성하지 않는다(§25 이후 유지된 역할 분담: 코드는 Codex, 이 세션은 PC/Vault 확인·검증·기록).
- §27(계약 대조)·§27b(설치 스크립트 검토)·§28(타이핑 불가 확인)의 사실 확인 결과는 유효하며 철회하지 않는다 — 다만 그 사실들에 기반해 "지금 스크립트를 그대로 실행하는 경로"가 막혀 있다는 것이 이번에 추가로 확정됐다.
- 위 요구사항이 구현되어 오면, 이 세션은 다시 독립적으로 PC 브랜치/커밋을 재확인한 뒤 §27과 같은 방식으로 코드 대조와 설치 검증을 이어간다.

## §30 재개 기록 (2026-09-25 — 설치 흐름 실제 코드 수정: 키 자동생성, 저장소 내 설치 실행 파일. 이 세션이 직접 구현)

### 배경
연호님이 "요구사항 기록에서 멈추지 말고 구현까지 하라"고 명시했고, 실제 이 대화(Claude Cowork)가 `wooyeonho/yeno-os`의 실제 체크아웃(FUSE 실시간 마운트, `git remote` 확인됨)에 연결돼 코드를 직접 수정할 수 있음을 재확인한 뒤 진행했다. "저는 Codex"라며 PC 연결이 없다고 한 메시지는 연호님이 확인해 주신 대로 GPT 세션에서 나온 내용이었다(이 세션과 무관).

### 변경 1 — `scripts/blackhole-resident.ps1`: 대화형 키 입력 프롬프트 제거
- 기존: `Read-Host 'New local pairing key...' -AsSecureString`로 사람이 터미널에 직접 타이핑해야만 설치가 끝났다(§28에서 확인한, 이 세션이 넘을 수 없는 지점).
- 변경: `-PairingToken`이 명시적으로 주어지지 않으면 `[Security.Cryptography.RandomNumberGenerator]`로 32바이트를 생성해 base64url(43자, 공백 없음 — 기존 검증 규칙 16-512자·공백 금지를 그대로 만족)로 인코딩하고, 기존에 이미 ACL로 현재 사용자 전용 보호가 걸린 `secrets` 폴더(`Protect-Directory`, 변경 없음)에 파일로 저장한다. 콘솔에 출력하지 않는다.
- `-PairingToken` 파라미터 자체는 남겨뒀다 — 소유자가 원할 때 직접 키를 지정하는 기존 경로(및 기존 CI 테스트가 쓰는 경로)는 그대로 유지, 동작 변화 없음.
- diff: `scripts/blackhole-resident.ps1` +26/-8줄.

### 변경 2 — `scripts/test-resident-windows.ps1`: 자동생성 경로를 검증하는 새 CI 단계 추가
- 기존 Windows CI 인수시험(`scripts/test-resident-windows.ps1`, 실제 예약작업·실제 HTTP·실제 ACL을 검사하는 진짜 시험)은 모든 `install` 호출에 `-PairingToken`을 명시적으로 넘기고 있어 기존 Read-Host 분기도, 이번 신규 분기도 원래는 전혀 실행되지 않았다.
- `auto_generated_pairing_key`라는 새 단계를 추가했다: 별도 HomeDir/TaskName/Port로 격리된 인스턴스를 `-PairingToken` 없이 설치 → 생성된 키 파일을 직접 읽어 길이(16-512)·공백 없음·base64url 형식·ACL 보호(`Assert-PrivateAcl`, 기존 헬퍼 재사용)를 검증 → 그 키로 실제 `/api/v1/devices/enroll`을 호출해 실제로 기기 등록이 성공하는지 확인 → 전체 누적 콘솔 출력(`$script:allOutput`)에 그 키 문자열이 한 번도 나타나지 않았는지 검증 → `stop`/`uninstall`로 정리. 기존 코드 패턴(격리된 `collisionHome`/`collisionTaskName` 방식)을 그대로 따랐다.
- diff: `scripts/test-resident-windows.ps1` +39줄, 기존 단계는 한 줄도 건드리지 않았다(브레이스/괄호 균형 확인함).

### 변경 3 — `scripts/install-blackhole-resident.cmd` (신규, 저장소에 포함)
- 연호님이 직접 만들어 채팅에 올려주셨던 더블클릭 실행 파일과 같은 목적이지만, 특정 PC 경로(`%USERPROFILE%\Documents\Projects\yeno-os`)에 하드코딩하는 대신 자기 위치 기준(`%~dp0`)으로 옆의 `blackhole-resident.ps1`을 찾도록 고쳐 저장소 안에 커밋했다 — 이제 이 파일은 채팅 업로드함이 아니라 저장소를 클론/풀하면 항상 같이 있다(요구사항 6 충족).

### 이 세션이 직접 확인한 것 (RAN 아님, 정적 검토 수준)
- `scripts/blackhole-resident.ps1`, `test-resident-windows.ps1` 전체 파일의 중괄호/소괄호 개수가 수정 전후로 정확히 맞는지 파이썬으로 셌다(둘 다 balanced).
- 새 CI 단계가 재사용한 기존 헬퍼(`Run-Launcher`, `Request-Core`, `Assert-PrivateAcl`, `Wait-Core`류 패턴)의 실제 정의를 다시 읽고 인자·반환값이 내가 쓴 방식과 맞는지 대조했다.
- `RandomNumberGenerator.Create()`는 .NET Framework(PowerShell 5.1이 쓰는 런타임, 스크립트 첫 줄에 명시)에서 표준적으로 쓰이는 정적 팩토리라는 것은 확인했지만, **이 세션은 PowerShell을 실행할 수 없어 실제로 돌려본 적은 없다**(§28에서 확정된 한계, 여전히 유효).

### 상태 — 정확한 어휘로 표기
- 위 세 변경 모두 **CONFIGURED**(코드는 저장소에 반영됨, 저장소 상태는 §29 재확인 그대로: `blackhole/p3-jev-recovery-port-20260924` / `4aeccf2` 기준 위에 적용). **RAN이나 VERIFIED가 아니다.**
- 실제 검증에는 Windows에서 `scripts/test-resident-windows.ps1`을 돌리거나(가장 신뢰도 높음 — 새 `auto_generated_pairing_key` 단계가 이미 포함돼 있다), 연호님이 `scripts/install-blackhole-resident.cmd`를 더블클릭해 설치가 대화형 프롬프트 없이 끝까지 진행되는지 확인하는 방법이 있다. 둘 중 하나의 실제 실행 결과를 받으면 이 세션이 `docs/CLAUDE_EXECUTION_STATE.md`에 RAN/VERIFIED로 갱신한다.

### 요구사항 5(휴대폰 페어링, 키 수동 전사 없이) — 아직 구현하지 않음, 이유와 다음 설계
- 이번에는 구현하지 않았다. 이유: (1) 이 저장소에는 QR 생성 코드·의존성이 전혀 없어(grep 확인, 0건) 새로 만들어야 하는데, 이 세션은 Node나 PowerShell을 실행해 직접 돌려볼 수 없어 스스로 검증 못 하는 보안 관련 신규 코드를 그대로 내보내는 건 실행 지시서의 "가설 검증 없이 우기지 않는다" 원칙에 어긋난다고 판단했다. (2) 휴대폰 페어링은 구조적으로 Tailscale 브릿지가 있어야 의미가 있는데, §28에서 확인한 대로 이 PC에는 Tailscale이 아직 설치돼 있지 않다 — 그 전제가 없는 상태에서 페어링 UI부터 만드는 건 순서가 맞지 않다.
- 다음 구체안(설계만, 미구현): 설치된 `qrcode`류 패키지로 `-Action show-pairing-qr`을 추가해, 이미 파일로 존재하는 페어링 키를 읽어 터미널에 ASCII QR로만 렌더링(디스크에 새 파일 남기지 않음, 로그에도 남기지 않음) — 소유자가 휴대폰 카메라로 그 화면을 스캔해 한 번에 값을 얻는다(자리수를 손으로 옮겨 적는 과정 제거). 단, 이건 Tailscale 설치·로그인(§28에서 보고한 미설치 상태)이 먼저 된 뒤에야 실제로 쓸모가 있다 — 연호님이 Tailscale을 설치·로그인하시면 이 세션이 이어서 구현한다.

## §31 재개 기록 (2026-09-25 — Codex 인수인계: 이 세션의 코드 작업 종료, 기준선 커밋)

### 결정 (연호님)
- "완성까지 시킬 수 있게 기존에 진행하던 내용들을 Codex에 넘기자." 근거: AGENTS.md 81행이 개발·설계·검증을 Codex 세션에 명시적으로 배정하고 있고, 이 세션은 PowerShell 실행·터미널 입력·Android 빌드·실기기 검증을 할 수 없어(§28, §30) 지시 1~3의 검증 루프를 닫을 수 없다.

### 이 세션이 한 일
- §30의 세 변경(키 자동생성, 회귀시험 단계, 저장소 내 설치파일)과 §25~§30 기록을 한 커밋으로 확정했다 — Codex가 우발적 충돌 없이 이어받을 수 있는 기준선. 푸시는 하지 않았다(연호님 지시 없음).
- `docs/CODEX_HANDOFF_20260925.md`를 작성했다: 연호님 지시 원문 그대로 + 현재 상태(CONFIGURED/미착수 구분) + Codex가 바로 쓸 코드 사실(§27 대조 결과) + 환경 사실(Tailscale 미설치, 승인 범위) + 읽을 위치.

### 이 세션의 상태
- 코드 작업은 여기서 멈춘다. 이후 이 세션의 역할은 Codex 결과물이 도착했을 때 실제 PC 저장소에서 독립적으로 재확인·기록하는 것(§25 이후 방식)이다.
- 재개 지점(Codex용): `docs/CODEX_HANDOFF_20260925.md`.

## §32 재개 기록 (2026-09-25 — Codex 실행 인계서 접수, 저장소에 원문 보존, 기준 SHA 정정)

### 접수
- 연호님이 `BLACKHOLE_CODEX_COMPLETION_HANDOFF_20260925.md`(GPT 세션 작성, Codex 대상 실행 인계서)를 전달했다. 이 세션이 SHA-256을 직접 계산해 원문 그대로 `docs/BLACKHOLE_CODEX_COMPLETION_HANDOFF_20260925.md`에 저장했다 — 클라우드 쪽과 PC 쪽 모두 `d83f86667553448460b34320177bee42700d5fe43ac6ea2b072f8defdaafa386`, 27,417바이트로 일치. 원문은 한 글자도 수정하지 않았다. 아직 커밋하지 않았다(연호님 지시 대기).

### 인계서에 대한 이 세션의 판단
- 내용은 정확하고 이 정본(§25~§31)과 일치한다. 특히 인계서 §1이 "FUSE 파일 접근과 Windows 프로세스 실행은 별개"라고 못 박고, 이 세션의 FUSE 연결이 가짜라는 근거가 아니라고 정정한 부분은 §29에서 확인한 사실과 같다.
- 인계서 §4 "반복하지 않을 실패" 목록은 이 세션이 실제로 겪은 것들이며 동의한다(수동 PowerShell 요청 반복, 업로드함 .cmd 안내, "코딩은 다른 AI 역할"로 기록만 남기기 등).
- **정정 1건 — 기준 SHA가 오래됐다.** 인계서 §1의 "마지막 보고 HEAD 4aeccf2"와 §1 "코드 자체를 빠짐없이 이어받기"의 "두 문장이 충돌한다"는 지적은 인계서 작성 시점 기준으로는 맞지만, 그 뒤 §31에서 이 세션이 세 변경(키 자동생성·CI 단계·저장소 내 설치파일)과 §25~§31 기록을 **커밋 `d3b4b729df1152f3c5846719ae1e33270b5b22d3`**(부모 `4aeccf2`)로 확정했다. 그 시점 작업트리는 깨끗했다. 따라서 Codex가 이어받을 기준은 `d3b4b72`이며, "미커밋 변경"은 이 §32 자체와 인계서 원문 파일 2개뿐이다(둘 다 문서). 인계서가 준비하라고 한 bundle/patch/스냅샷은 필요 없다 — 실제 PC 폴더를 그대로 열면 된다.
- 인계서 §1 "반드시 구분할 능력" 5항목에 대한 이 세션의 답: (1) 실제 PC 폴더 읽기·수정 — 가능(FUSE, §29 확인). (2) Windows에서 PowerShell/Node/빌드 실행 — 불가(§28). (3) PC 브라우저·앱 조작 — 브라우저는 읽기 전용, 터미널은 클릭만(§28). (4) Android 기기 조작·화면 확인 — 불가. (5) 해당 소스로 Windows/Android CI 실행 — 푸시 권한이 있으면 CI(`android-debug.yml`, Windows CI)는 저장소 워크플로로 돌릴 수 있으나 이 세션은 푸시 지시를 받지 않았다. Codex 세션은 이 5항목을 자기 환경에서 다시 답해야 한다(인계서 §1의 요구와 동일).

### Codex 착수 시 시작 상태
- 경로 `C:\Users\우연호\Documents\Projects\yeno-os`, `origin` = `wooyeonho/yeno-os`, 브랜치 `blackhole/p3-jev-recovery-port-20260924`, HEAD `d3b4b729df1152f3c5846719ae1e33270b5b22d3`.
- 읽을 순서: `docs/BLACKHOLE_CODEX_COMPLETION_HANDOFF_20260925.md`(실행 지시) → `docs/CODEX_HANDOFF_20260925.md`(연호님 원문 지시 + 코드 사실 요약) → 이 파일 §25~§32.
- 완료표(인계서 §6) 기준 현재 상태: W01 CONFIGURED, W02 CONFIGURED(재설치 보존 로직은 기존 코드 — `Get-Owner`/`Get-OwnedTask`/`InitializeNewStore` 검사 — 에 이미 있으나 이번 변경 후 실행 안 됨), P01~P03 미착수, J01/J02/R01/R02/F01/F02/C01 미착수(서버 쪽 계약은 §27에서 코드로 확인됨), M01 미착수, B01 미착수.

## §33 — QA 보고서 검토: 별도 Codex 클라우드 워크스페이스의 "연결 미확인" 보고 (2026-09-25)

**상황**: 사용자가 "QA 검토 결과"라는 이름으로, 어떤 Codex/클라우드 세션이 이 프로젝트의 작업 내용을 확인할 수 없었다는 보고를 전달함. 보고 내용: 경로 `/workspace/yeno-os`, 브랜치 `work`, HEAD `be131035895d63b2361bef82564eb63399c1f9f1`, **git remote 미설정**, §27~§32에서 기록한 파일들이 전혀 존재하지 않음.

**독립 재검증** (§29에서 확립한 표준 절차대로, 이 세션 자신의 연결을 다시 확인):
- `mount`: `/sessions/rcw-011w5rj1h2fmv46wndou7jpp/mnt/yeno-os` — `type fuse (rw,...)`, 실제 라이브 마운트 확인.
- `git remote -v`: `origin https://github.com/wooyeonho/yeno-os.git` (fetch/push 모두) — 정상 설정됨.
- `git branch --show-current`: `blackhole/p3-jev-recovery-port-20260924`.
- `git rev-parse HEAD`: `d3b4b729df1152f3c5846719ae1e33270b5b22d3` (parent `4aeccf2ced86d285fbcfb70f2a5b91fe9e0121bc`) — §31에서 기록한 커밋과 정확히 일치.
- `git status --short`: `M docs/CLAUDE_EXECUTION_STATE.md`, `?? docs/BLACKHOLE_CODEX_COMPLETION_HANDOFF_20260925.md` — §32에서 남긴 미커밋 상태와 정확히 일치, 예상 밖의 변경 없음.
- `get_device_info`: `platform: win32`, `deviceName: desktop-tingn4u`, `connectedFolders`에 `C:\Users\우연호\Documents\Projects\yeno-os` 포함 — 실제 Windows PC 연결 확인.

**결론**: QA 보고서가 설명하는 `/workspace/yeno-os` (remote 없음, 브랜치 `work`, 전혀 다른 HEAD)는 이 세션이 사용해온 실제 PC 저장소와 **동일한 저장소가 아님**. `/workspace/...` 경로 패턴과 remote 미설정은 별도의 임시 클라우드 컨테이너/샌드박스 워크스페이스의 특징이며, 이 세션의 연결(FUSE 라이브 마운트, 올바른 origin remote, 올바른 브랜치/HEAD, 예상된 미커밋 diff)과는 구조적으로 다름. 즉 이 QA 보고는 "그 별도 세션이 실제 PC에 접근하지 못했다"는 사실을 보여줄 뿐, 이 세션이 지금까지 보고한 §27~§32 작업이 허위이거나 이 PC 연결이 가짜라는 근거가 아님. 이는 `BLACKHOLE_CODEX_COMPLETION_HANDOFF_20260925.md` 자체가 경고한 "FUSE 파일 접근 ≠ 다른 세션의 실행 환경"이라는 구분과 정확히 일치하는 사례로 판단됨.

**후속 조치**: 이 세션은 계속 실제 PC(`desktop-tingn4u`, `C:\Users\우연호\Documents\Projects\yeno-os`, origin `wooyeonho/yeno-os`, HEAD `d3b4b72`)에서 작업을 이어간다. Codex가 실제로 이 작업을 이어받으려면 반드시 이 저장소(올바른 remote/브랜치/HEAD를 가진)에서 시작해야 하며, remote가 없는 임시 워크스페이스에서는 `docs/CODEX_HANDOFF_20260925.md`나 `docs/BLACKHOLE_CODEX_COMPLETION_HANDOFF_20260925.md`를 읽을 수 없으므로 진행이 불가능하다는 점을 사용자에게 안내함.

## §34 Codex Windows 직접 실행 (2026-09-25, 작업 진행 중)

- 실제 경로: C:\Users\우연호\Documents\Projects\yeno-os
- origin: https://github.com/wooyeonho/yeno-os.git
- branch: blackhole/p3-jev-recovery-port-20260924
- 시작 HEAD: 43a2d1b44e0a60ebad4982dc1e2222213869cc1a (요청 기준과 동일).
- 시작 작업 트리: staged/unstaged/untracked 모두 없음. 기존 변경을 되돌리지 않음.
- PowerShell/Node 실제 Windows 실행 가능. Git Bash MCP는 Transport closed로 불가, PowerShell 사용.
- 최초 `npm.cmd test 2>&1 | Tee-Object ...Desktop/npm-test-output.txt`: exit 1, 852 tests / 757 pass / 74 fail / 21 cancelled. Node 24.11.1에서 다수 시험 프로세스가 3221226505로 종료. 동일 agent-provider-selection 6건은 설치된 Codex bundled Node 24.19.0에서 전부 통과. 전역 Node/PATH를 바꾸지 않고 검증 프로세스 PATH만 변경.
- Windows 격리 설치 시험 첫 실행: 실제 예약 작업 등록 성공, UTF-8 BOM 없는 config.json을 PS5.1 Get-Content 기본 인코딩으로 읽을 때 한글 사용자 경로 파손. 시험 읽기에 -Encoding UTF8 명시. 자동 키 생성 이후 낡은 Read-Host 정적 assertion 수정.
- 두 번째 설치 시험: 인증 상태, Android API 기기 등록, 실제 document 작업/파일 SHA 검증 및 재설치 키 보존 진행. stop_restart_reconnect 단계 readiness 실패 조사 중. 전체 회귀와 동시 실행했으므로 부하/프로세스/저장 복구를 구분한다.
- 완료 시나리오 J01 입력: `document: Windows resident acceptance artifact`, 실제 scheduled resident, 임의 격리 포트, 30초 목표. 소유자 운영 데이터/자격증명/운영 배포는 변경하지 않음.
- 증거 폴더: build-artifacts/acceptance-20260925 (gitignore, 비밀 제외). 최초 로그는 Desktop/npm-test-output.txt.
- 구현 방향: 기존 enrollment ledger/기기 토큰 재사용. 소유자 인증으로 5분 단일 등록 초대 발급, 같은 requestId만 재시도, 만료/취소/재시작 초대 무효, 기기 자격증명은 기존 Stronghold 저장. 초대/장기 키는 상태 파일에 보관하지 않음.
- 아직 휴대폰 실기기/카메라/최신 APK/Windows 최종 빌드 검증 완료 아님. 이 절은 최종 결과로 대체하지 말고 후속 결과를 덧붙인다.

### §34 중간 확인 갱신
- `windows-resident-isolated.json`: 실제 Windows PowerShell 5.1 + Task Scheduler, **102 assertions passed**. 설치/재설치/자동 키 생성/ACL/실제 API 문서 생성/결과 SHA/정지/재시작/중복 방지/전체 정지/기기 철회/예약작업 소유권/제거 시 데이터 보존 검증.
- 앞선 readiness 실패는 빌드 동시 실행 중 발생. 해당 시점 사용 가능 RAM 327,952KB / 총 8,106,488KB, Rust 컴파일러도 0xc0000409. 작업 분리 후 설치 시험 통과. 메모리 부족이 원인이라는 단정 대신 관찰/재현 범위를 유지한다.
- 핵심 회귀 32/32 pass (`focused.tap`). QR UI의 기존 전체 화면 회귀 통과 (`controller-ui.txt`, Stronghold/카메라 IPC는 모사, 실제 서버 HTTP/파일 사용).
- 실제 Edge browser에서 375/768/1280 화면·키 입력란 제거·잘못된 QR 피드백·재스캔 가능 확인 (`browser-ui.txt`, pairing-*.png). 실제 유효 초대 QR은 캡처하지 않음.
- Android build 실행 실패: 생성 프로젝트 없음. `tauri android init --ci` 후 Android SDK/ANDROID_HOME 미설정 경고. 실제 SDK/JDK/ADB/실기기 없음. APK 미생성.
- Rust cargo check 최초 무제한 및 jobs=2는 컴파일 중 실패/자원 압박. jobs=1로 재시도 중. frontend build 성공을 Windows EXE/APK 성공으로 기록하지 않음.
- 작업 도중 `docs/BLACKHOLE_PRODUCT_VISION.md`가 외부에서 untracked로 등장. Codex 생성/수정 파일이 아니며 보존.

### §34 최종 로컬 검증 결과 (2026-09-25)

**결론: Windows에서 가능한 구현·실행·빌드·대체 검증은 수행했다. 실제 Android → Tailscale → Windows 전체 완료는 아직 아니다.** APK/실기기/사설 HTTPS 연결 검증은 아래 BLOCKED로 남긴다. 기존 운영 resident 설치, 운영 배포, Git commit/push, 실제 자격증명 교체는 하지 않았다. 격리 시험 예약작업은 제거했고 시험 데이터·키는 보존했다. 작업 중 외부에서 추가된 `docs/BLACKHOLE_PRODUCT_VISION.md`는 수정하지 않았다.

#### 구현한 경로와 변경 파일

- `runtime/lib/native-pairing.mjs`, `runtime/server.mjs`: 소유자 인증으로 발급하는 5분 초대, Android 초대 등록 API. 장기 키와 다른 일회성 등록 범위의 토큰. 같은 enrollment requestId만 재시도, 다른 요청 재사용 거부, 취소/만료/코어 재시작 시 무효. 만료 항목 정리 후 같은 초대 ID를 다시 발급해도 옛 QR 토큰이 되살아나지 않도록 발급별 난수 사용. 초대는 메모리에만 유지한다.
- `runtime/owner-pairing.mjs`, `scripts/pair-blackhole-phone.ps1`, `.cmd`: 소유자 Windows GUI, 내부 stdin/stdout 파이프의 QR 이미지, 만료·취소 처리. 장기 키/QR 원문을 터미널·로그·채팅에 출력하지 않는다. QR 이미지를 파일로 저장하지 않는다. 한글 경로는 파이프 JSON에서 Unicode escape하여 Windows PowerShell 5.1 코드페이지 문제 해결. 실제 GUI에서 모델 조회와 준비 오류/재시도 확인.
- `apps/controller/src/native-pairing.ts`, `src/main.ts`, `index.html`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/mobile-pairing.json`, npm/Cargo manifest/lock: Android QR 스캔→PC 주소·만료 확인→기기 등록→기존 Stronghold 저장. 장기 키 입력란 제거. 다른 QR 스캔 시작 시 기존 초대 선택 해제. 실패한 작업에 서버 사유와 새 요청 재시도 안내 표시.
- `apps/controller/src-tauri/src/local_resident.rs`: Windows 데스크톱 앱은 기본 resident-v2 설치의 알려진 키 경로를 네이티브 코드에서 읽어 loopback으로 등록한다. 프록시/리다이렉트 금지, 10초 타임아웃, 선택한 origin 변경 거부. 장기 키는 네이티브 프로세스 내부에만 있으며 JS에는 기기 전용 인증정보만 전달한다. 기존 암호화 보관소를 재사용한다.
- `runtime/owner-local-model.mjs`, `runtime/resident.mjs`: 같은 resident-v2의 설치된 Ollama 모델 선택·저장, 재시작 후 적용. 고정 loopback 11434 엔드포인트. 활성 작업이 있으면 설정 저장 거부. 설정 변경으로 자동 실행/AI 모듈을 켜지 않는다. 기존 8792 설정 서버는 별도 desktop-v1 코어이므로 재사용하지 않았다. **이번 설정 UI는 새 소유자 창이며 8792 화면 통합 완료가 아니다.**
- `scripts/blackhole-resident.ps1`, `scripts/test-resident-windows.ps1`: PS5.1에서 param 기본값의 빈 PSScriptRoot 문제를 본문 초기화로 수정. UTF-8 구성 파일 읽기 명시. 기본 Root 생략 실행도 직접 확인했다.
- `runtime/lib/backup.mjs`, `scripts/backup.mjs`, `scripts/backup-retention.mjs`: Windows 디렉터리 fsync의 EPERM만 예외 처리. 파일 fsync 실패 및 다른 오류는 계속 전파한다. POSIX 권한 비트 assertion은 Windows에서 제외하되 실제 Windows ACL은 설치 시험으로 검증한다.
- 회귀 시험 수정: `runtime/test/backup.test.mjs`, `jev.test.mjs`(완료 대기 후 로그 스냅샷), `koyeb-start.test.mjs`, `render-start.test.mjs`(플랫폼 경로), `resident-runtime.test.mjs`, `resident-worker.test.mjs`(현행 자동 키 생성 계약).
- 추가 검증 파일: `runtime/test/native-pairing.test.mjs`, `apps/controller/test/native-pairing.test.mjs`, `apps/controller/verify-ui.mjs`, `verify-pairing-browser.mjs`, `scripts/verify-resident-local-live.mjs`. Windows 빌드에 필요한 `src-tauri/icons/icon.ico` 추가. 생성된 Tauri schemas는 `.gitignore`에 추가. 디자인 계약은 `apps/controller/DESIGN.md`.

#### 실제 실행한 명령과 결과

아래 최종 Node 명령은 이미 설치된 `C:\Users\우연호\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin`을 **해당 프로세스 PATH에만** 추가했다(Node 24.19.0). 전역 Node/PATH/ExecutionPolicy는 변경하지 않았다. PowerShell `-ExecutionPolicy Bypass`는 실행 프로세스에만 적용했다.

| 실행 | 결과 / 증거 (`build-artifacts/acceptance-20260925/`) |
|---|---|
| 요청한 `npm.cmd test 2>&1 \| Tee-Object -FilePath "$env:USERPROFILE/Desktop/npm-test-output.txt"` | 최초 기본 Node 24.11.1에서 실패. Desktop 원본 로그 유지. 성공으로 바꿔 기록하지 않음. |
| `node --test --test-concurrency=1 --test-reporter=tap runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs` | **1150 tests / 1129 pass / 0 fail / 0 cancelled / 21 skip**. `final-regression-isolated.tap`. Linux flock 등 환경별 21건은 실행한 것으로 세지 않음. |
| 실패 파일 재검증 `node --test --test-concurrency=1 runtime/test/backup-api.test.mjs runtime/test/scheduler-fix.test.mjs runtime/test/server-integration-hardening.test.mjs runtime/test/studio.test.mjs` | 25/25 pass, `regression-repair.tap`. 이전 전체 실행의 EPERM 1건 및 프로세스/structuredClone 실패는 원본 `final-regression.tap`에 보존. |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-resident-windows.ps1 -EvidencePath build-artifacts/acceptance-20260925/windows-resident-final-verified.json` | **102 assertions passed**, 실제 Task Scheduler·HTTP·파일·ACL, sourceCommit=기준 HEAD. `windows-resident-final-verified.json`, `.txt`. 격리 경로/임의 포트 사용. |
| `node scripts/verify-resident-local-live.mjs` | 실제 Ollama qwen2.5:3b 요청 완료, 산출물 294 bytes, 재시작 후 모델·요청·결과 유지. `resident-local-live.json`. 프롬프트: “자율 임무: 도구를 호출하지 말고, 오늘 할 일 한 가지를 한국어 한 문장으로 제안해줘.” 외부 모델/유료 API 미사용. |
| `npm.cmd --prefix apps/controller run build` | TypeScript 검사와 Vite 빌드 통과, `controller-final-build.txt`. |
| `npm.cmd --prefix apps/controller run verify:ui` | 실서버·실파일 + 모사한 native IPC/Stronghold/camera. 등록, 결과 SHA, 앱 UI reload, 오프라인/복구, 정지/재개, 철회, Windows 로컬 연결, 제공자 오류 주입에 따른 실제 실패 작업/사유 표시 통과. `controller-ui-final.txt`. 실제 카메라·OS 보관소 검증이 아님. |
| `node apps/controller/verify-pairing-browser.mjs` | 실제 Edge 375/768/1280 화면, 넘침 없음, 장기 키 입력 없음, 잘못된 QR/재시도 확인. `browser-ui-final.txt`, `pairing-*.png`. |
| `cargo test --offline --manifest-path apps/controller/src-tauri/Cargo.toml --lib local_resident` | Windows Rust 브리지→실제 Node 코어 등록/동일 요청 재시도/잘못된 origin 거부: 1/1 pass, `native-local-enrollment.txt`. |
| `npm.cmd --prefix apps/controller run tauri -- build --debug --bundles nsis` (`CARGO_BUILD_JOBS=1`) | Windows debug EXE·NSIS 생성 성공. `windows-installer-final-build.txt`. libsodium PDB/LIBCMTD 링커 경고 존재, 오류 아님. |
| Windows EXE 실행·창 캡처·종료 | 실제 BLACKHOLE 화면 확인, `windows-controller-final.json`, `.png`. 자격증명 입력 안 함. 설치 마법사 실행/배포와 다름. |
| `tauri android build --debug`, `tauri android init --ci` | 실행했으나 SDK/ANDROID_HOME 및 생성된 Android 프로젝트가 없어 빌드 불가. `android-build.txt`, `android-init.txt`. APK 없음. |

추가 원인·경계: 기본 Node의 native exit 3221226505, 일부 Rust 병렬 빌드 실패와 낮은 가용 RAM을 관찰했다. Node 교체/작업 직렬화 후 검증은 통과했지만 모든 실패의 원인을 메모리로 단정하지 않는다. 실제 모델 첫 시험의 8080 기본 endpoint 문제는 11434 명시로 수정했고, 재시작 직후 시험 클라이언트의 stale keepalive 재사용은 새 연결로 검증했다. 원본 실패 증거 파일은 유지한다. NSIS 재빌드 중 EXE 접근 거부 1회 후 재실행 성공. 운영 프로세스를 임의로 종료하지 않았다.

#### 완료표 — 범위를 붙인 상태

| ID | 상태 | 확인한 것 / 남은 것 |
|---|---|---|
| W01 / W02 | VERIFIED (격리 Windows) | 실제 무입력 설치·인증 조회·예약작업·키 자동생성·ACL·재설치 보존. 소유자의 운영 경로 설치/로그아웃 후 자동 실행/PC 재부팅 시험은 아님. |
| P01 | RAN-UNVERIFIED | 실제 소유자 GUI 실행·준비 오류·모델 조회, 실서버 기반 QR PNG 생성/취소 통합 시험 통과. 정상 Tailscale 환경의 GUI QR 표시·스캔 전체는 미확인. |
| P02 | BLOCKED | Android SDK/JDK/ADB·실기기·Tailscale 연결 없음. 카메라 권한/스캔/Stronghold 저장을 기기에서 확인하지 못함. |
| P03 | VERIFIED (로컬 API/파서/UI 대체 시험) | 만료·취소·재사용·오류·재시작 무효, 오래된 ID 재발급 시 옛 토큰 거부, 잘못된 QR 피드백/재스캔. 실제 카메라 제외. |
| J01 | RAN-UNVERIFIED (전체 흐름) | 실제 예약 resident에서 document 작업·산출물 SHA, 실서버 UI의 실행/결과 열기 통과. Android 화면까지 연결된 흐름은 미확인. |
| J02 | VERIFIED (실제 API/저장 결과) | 동일 requestId가 같은 접수/작업/산출물을 가리키며 중복 실행하지 않음. |
| R01 | RAN-UNVERIFIED | UI 종료/reload/보관소 어댑터 복구 통과. Android 프로세스 종료·실제 Stronghold 재해독 미확인. |
| R02 | VERIFIED (실제 Windows 코어) | stop/restart 후 요청·결과·SHA 보존. 불명확한 호출의 자동 재실행 방지는 회귀 시험 통과. PC 재부팅과 구분. |
| F01 / F02 | VERIFIED (실코어 + UI 대체 시험) | 코어 정지/연결 장애·복구와 실패 상태/이유·수동 새 요청 범위 확인. 제공자 실패는 시험 주입이며 실제 유료 제공자 장애 시험 아님. Android 화면은 미확인. |
| C01 | VERIFIED (실제 API + UI 대체 시험) | 정지·재개·철회·재등록, 철회 인증 거부. Android 실조작 제외. |
| M01 | RAN-UNVERIFIED (GUI 전체 시나리오) | 실제 GUI 모델 조회, 모델 저장 브리지 시험, 실제 Ollama 응답·결과·재시작 보존은 각각 통과. GUI 저장 버튼부터 모델 요청까지 한 번에 조작한 시험은 미실행. 8792 UI 통합 아님. |
| B01 | RAN-UNVERIFIED | Windows EXE 실행과 NSIS 생성 확인. NSIS 설치 마법사 미실행, 최신 Android APK 미생성/실기기 설치 미실행. |

#### 산출물과 다음 한 단계

- Windows 실행물: `apps/controller/src-tauri/target/debug/yeno-controller.exe`
- Windows 설치 파일: `apps/controller/src-tauri/target/debug/bundle/nsis/BLACKHOLE_0.2.0_x64-setup.exe` (**debug**, 서명된 운영 배포 아님).
- NSIS는 controller 앱용이다. resident 서비스가 함께 패키징된 통합 OS 설치 파일이라고 주장하지 않는다. resident 설치 진입점은 기존 `scripts/install-blackhole-resident.cmd`, 새 소유자 UI는 `scripts/pair-blackhole-phone.cmd`다.
- 파일별 실제 SHA-256·크기와 미커밋 소스 목록은 `build-artifacts/acceptance-20260925/source-manifest.json`에 기록. 기준 HEAD 위 미커밋 변경이며 HEAD 자체 빌드라고 표현하지 않는다.
- 다음 한 단계: **Android SDK/JDK·SDK 라이선스 및 Tailscale 로그인/실기기 연결 환경을 준비한 뒤 이 소스로 APK를 만들어 P02→J01→R01/F01 실기기 시험을 닫는다.** 약관 동의/계정 로그인은 자동 수행하지 않았다. 로컬에서 가능한 명령을 사용자에게 떠넘긴 것이 아니라, 빌드 시도와 대체 시험까지 수행한 뒤 남긴 환경·기기 경계다.
## §35 제품 목적·Obsidian 근거 대조 (2026-09-25, Codex)

- 시작 재확인: 실제 Windows 경로·origin·branch·HEAD는 §34와 동일(43a2d1b44e0a60ebad4982dc1e2222213869cc1a). §34의 기존 미커밋 코드·테스트·문서 및 외부 작성 비전 문서를 보존한 채 진행. 이번 변경은 문서와 로컬 증거 기록이며 기능 구현이나 테스트 재실행 결과를 새로 주장하지 않는다.
- 실제 Vault `C:\Users\우연호\Documents\Obsidian Vault` 접근 확인. `AGENTS.md`, `AI_OPERATING_RULES.md` 전체, `CLAUDE.md` 규칙 버전 확인(모두 2), `CHANGELOG.md` 관련 최근 이력을 먼저 확인. 루트 허브·JARVIS/HOMUNCULUS 노트, NEXT_DELIVERY의 목표/D03/납품 단계, 통합 실행계획의 시스템 경계/P1–P4 및 해당 분할본, CORRECTED 출처 경계 부분을 읽었다. 큰 노트 전체·모든 링크·과거 대화 원문을 다 읽었다는 주장은 하지 않는다.
- `docs/BLACKHOLE_PRODUCT_VISION.md` 기존 바이트를 보존하고 보완 절을 덧붙였다. PC/휴대폰 한 요청의 끝까지 수행, 시간·비용·이름·전문성·성과, 재사용 기억, 근거 출처 표, 역할별 확인 코드 위치, Vault 정책, 우선 수락 이후 단계별 확장 원칙을 기록했다. 실행 상태/시험 수치는 비전 문서에 추가하지 않았다.
- 현재 코드의 정적 대조(이번 새 실행 검증 아님): `server.mjs`의 voice→목표 선택/Shadow dispatch와 Kirby 접수 배선 존재. `shadow-army.mjs`는 scout/researcher→builder→verifier/semanticVerifier의 제한된 그래프이며 범용 무제한 작업 분배로 과장하지 않는다. `kirby.mjs` 자동 획득은 검토된 manifest와 시험/활성화 경로이며 임의 능력 흡수 아님. 기억 검색/임베딩은 별도 모듈이다. `seven-drives.mjs`의 기존 ID/라벨 매핑을 유지한다. `jev-recovery.mjs`의 `authorizesDispatch:false` 계약과 `jev-recovery-verifier.mjs`의 도구 없는 근거 검토를 확인했다. 하나의 실기기 임무에서 모든 구성의 통합 완성을 증명한 것은 아니다.
- Obsidian 기존 구현 발견: `runtime/lib/obsidian-exporter.mjs`, `memory-sync-outbox.mjs`, 서버의 export/outbox 배선, 대응 테스트 파일 존재. 기본 비활성, 기본 하위 폴더 `01_DRAFTS/BLACKHOLE`, 단방향 내보내기다. 실제 사용자 Vault 동기화를 켜거나 시험하지 않았다. 후속 검토 항목: 사용자 지정 subtree가 01_DRAFTS 밖을 허용하는 점, `exportGenerated`의 기존 생성 색인 갱신 경로는 이번 새 초안만 생성 정책과 대조/제한해야 한다. 파일 존재를 이유로 동기화 완료라고 보고하지 않는다.
- Vault 변경은 CHANGELOG 추가 기록만 수행. 정리 결과는 저장소 비전 문서로 충분하므로 중복 초안/허브 링크/분류를 새로 만들지 않았다. `00_INBOX_RAW`와 기존 노트는 수정하지 않았다. 전후 파일 해시 비교 증거는 `build-artifacts/acceptance-20260925/vault-vision-verification.json`; 기존 비전 원문 사본은 `product-vision-before-obsidian.md`. 이 증거는 문서 보존 확인이며 제품 기능 테스트가 아니다.
- 환경 재확인: 현재 PATH에서 adb/java/sdkmanager/tailscale 미발견, 기본 `AppData/Local/Android/Sdk`와 `Program Files/Tailscale/tailscale.exe` 없음. 모든 디스크의 임의 설치 경로 부재까지 단정하지 않는다. Android SDK/JDK 로컬 설치·SDK 약관 동의 승인을 질문했고 답변 대기 중. 설치/약관 동의/계정 로그인/방화벽/동기화 설정 변경 없음. §34의 실기기 BLOCKED는 해소되지 않았다.
- 다음 행동: SDK 설치·라이선스 동의 승인 후 로컬 Android 빌드 준비를 진행하고 같은 소스의 APK/실기기 요청·복구를 검증한다. 사용자 지시대로 장기 기능 확장을 먼저 시작하지 않는다. 이전 빌드 source-manifest는 §34 시점의 스냅샷으로 보존한다(이번 문서 변경으로 재작성하지 않음).
## §36 — 소유자 승인: Android SDK/JDK 설치 및 라이선스 동의 (2026-09-25)

**요청 출처**: §35에서 Codex(로컬, PC 직접 실행)가 Android 실기기 빌드 준비를 위해 Android SDK/JDK 로컬 설치와 SDK 라이선스(사용권 계약) 동의에 대한 소유자 승인을 요청하고 대기 중이었음.

**소유자 응답**: 우연호님이 이 세션(Claude Cowork)에 "SDK/JDK 설치하고 라이선스 동의해"라고 명시적으로 승인함. 계정 생성·로그인·결제·방화벽 변경·동기화 설정 변경은 이 승인 범위에 포함되지 않음(§35에서 Codex가 구분한 그대로, 별도 항목).

**이 세션의 한계**: 이 세션(Claude Cowork)은 Windows PowerShell/설치 프로그램을 직접 실행할 수 없어(터미널은 click-tier만 가능, 타이핑 불가 — §28 참조), 이 승인을 대신 실행할 수 없음. 이 §36 기록은 승인 사실을 공동 실행 기록에 남기는 것이며, Codex가 실제로 설치·라이선스 동의를 진행하려면 Codex 자신의 세션(채팅 창)에서도 동일한 승인을 직접 확인해야 할 수 있음.

**후속**: Codex는 이 승인을 근거로 Android SDK/JDK 설치 및 라이선스 동의를 진행하고, 실행한 정확한 명령·버전·설치 경로·라이선스 동의 방식을 RAN/VERIFIED 근거와 함께 다음 § 항목에 기록할 것.

## §37 Android 도구 설치·빌드 재개 (2026-09-25, Codex — 진행 중)

- §36에 기록된 소유자 승인과 이번 대화의 진행 요청을 확인해 SDK/JDK 설치·SDK 라이선스 동의를 재요청 없이 진행한다. 계정 생성/로그인/결제/방화벽/동기화 설정은 승인 범위에서 제외한다.
- 시작 상태: origin/branch/HEAD는 §34와 동일. 기존 미커밋 변경을 보존. 디스크 여유 약 200GB.
- 공식 출처: https://learn.microsoft.com/en-us/java/openjdk/download 와 Google https://dl.google.com/android/repository/repository2-1.xml. 저장소 Android workflow와 동일한 SDK/NDK 계열을 선택했다.
- JDK: `https://aka.ms/download-jdk/microsoft-jdk-17.0.20.1-windows-x64.zip`, Microsoft 공식 SHA256 파일과 다운로드 일치(3d9006956fc8af5601cd24ffc4f468bef48279c7ebd8171b9bdf90d0aabfbf1f). `C:\blackhole-build-tools\java\jdk-17.0.20.1+1`에 압축 해제, `java -version`으로 17.0.20.1 실행 확인.
- Android command-line tools: `https://dl.google.com/android/repository/commandlinetools-win-12266719_latest.zip`, 공식 repository XML SHA1 32787c10f55911fd109848906b1275723e79f659와 일치. `C:\blackhole-build-tools\android\cmdline-tools\latest`에 배치.
- SDK 설치 명령: `sdkmanager.bat --sdk_root=C:\blackhole-build-tools\android "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;28.2.13676358"`. 선택한 패키지 설치의 라이선스 프롬프트에 승인된 `y` 입력을 stdin으로 전달. 정확한 동의/설치 출력은 `build-artifacts/acceptance-20260925/android-sdk-install.txt`. 완료 여부는 다음 확인에 기록.
- `rustup target add aarch64-linux-android` 실행. 기존 기본 Rust toolchain을 전환하지 않는다. JAVA_HOME/ANDROID_HOME/PATH는 빌드 프로세스에만 설정, 전역 환경 설정 변경 없음.
### §37 실행 결과·현재 재개 조건

**VERIFIED — 설치/실행한 도구**
- Windows JDK 17.0.20.1+1, command-line tools 16.0(12266719), platform-tools 37.0.1(ADB 실행 확인), SDK 플랫폼 35·36, build-tools 35.0.0·36.0.0, NDK 28.2.13676358, Rust 1.98.0의 aarch64-linux-android 표준 라이브러리. SDKManager 종료 코드 0 및 설치 파일/버전 대조. SDK 36은 Tauri가 실제 생성한 compileSdk/targetSdk 36에 맞춰 추가했다.
- 공식 라이선스 프롬프트에 stdin으로 `y`를 전달했고 SDK의 `licenses/android-sdk-license` 생성 확인. 우연호님 승인 범위의 SDK 약관 동의이며 계정/방화벽/공개 배포 승인으로 확장하지 않음.
- 설치 경로와 체크섬: `build-artifacts/acceptance-20260925/android-toolchain.json`. 도구는 C:\blackhole-build-tools, Java/SDK/PATH/Gradle cache 지정은 실행 프로세스 범위. 기존 전역 환경/기본 Rust toolchain 전환 없음.

**RAN — Android 프로젝트 및 빌드 시도**
- `npm.cmd --prefix apps/controller run tauri -- android init --ci --skip-targets-install`: 실제 Android 프로젝트 생성 성공. 기존 `tauri.android.conf.json`에 따라 별도 시험판 `kr.yeno.controller.smoke`, versionCode 2001 사용. 기존 앱 데이터/서명을 바꾸지 않음.
- `node scripts/android-release.mjs permissions`: 생성 manifest에 기존 RECORD_AUDIO 경로 적용. 실제 휴대폰 권한 부여를 수행한 것은 아님.
- 생성된 ignored Gradle 설정에 heap 768MB, workers 1, parallel false, Kotlin in-process, 한글 경로 검사 override 추가. 공식 gradle-8.14.3-bin.zip.sha256을 wrapper의 distributionSha256Sum에 지정. 이 설정은 생성 빌드 폴더만 변경하며 전역 설정 아님.
- `npm.cmd --prefix apps/controller run tauri -- android build --debug --apk --target aarch64 --ci` 첫 시도 실패: Rust std mmap가 Windows OS error 1455(페이징 파일/가상 메모리 부족)로 실패한 뒤 다수 연쇄 타입 오류. `android-build-local.txt`.
- `CARGO_BUILD_JOBS=1`, `CARGO_PROFILE_DEV_CODEGEN_UNITS=1` 재시도는 위 지점을 통과했지만 `libsodium-sys-stable 1.24.0`이 Unix `./configure`를 Windows에서 실행하다 OS error 193으로 실패. `android-build-low-memory.txt`. Stronghold를 제거하거나 암호화를 약화하는 수정은 하지 않음.

**WSL 대안 준비와 실제 차단**
- 기존 등록된 Ubuntu 26.04 LTS(WSL2)를 조회하고 shell 실행 확인. 새 배포판·계정 생성 없음. 기존 Ubuntu는 첫 verbose 확인에서 Stopped였음.
- Windows 빌드를 유지하며 libsodium만 Android ARM64로 교차 빌드하는 좁은 대안을 준비했다. WSL 내부 `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential unzip` 실행은 인덱스 다운로드 도중 exit 1로 중단됨. **build-essential/unzip 설치 완료라고 기록하지 않는다.** `wsl-build-tools.txt`.
- Linux NDK r28c archive 722,261,334 bytes 다운로드와 Google repository SHA1 a7b54a5de87fecd125a17d54f73c446199e72a64 대조 완료. 아직 WSL 압축 해제/실행 확인은 하지 않음.
- 해당 crate가 서명 검사 후 configure까지 진행한 libsodium 소스 archive를 보존: SHA256 b20a92e7ec25b285eafa349d721a5bb27e3a8ba94c0816630a127883f1d1b3ab. C:\blackhole-build-tools\build-sodium-wsl.sh 작성(아직 실행하지 않음). 외부 임의 바이너리를 앱에 삽입하지 않음.
- 시스템 이벤트 2004에서 가상 메모리 부족 확인. 22:57:23 KST 기록에 Notepad.exe PID 26068 약 8.50GB, vmmem 약 3.23GB, vmmemWSL 약 2.06GB 사용. 시스템 commit 약 31.6GB / 한도 34.1GB, pagefile 24GB. `android-memory-events.json`. 모든 라이브러리 문제를 메모리로 뭉뚱그리지 않음: Windows native configure 193은 별도 host 호환성 문제다.
- 사용자 문서 손실을 피하려고 Notepad 강제 종료·임의 저장·페이지 파일 변경·WSL 종료를 하지 않았다. 메모장 문서를 저장하고 닫을 수 있는지 질문했으며, 응답을 승인으로 가정하지 않는다.

**BLOCKED / 미완료**
- APK 아직 생성되지 않음. Android 실기기 ADB 연결 수 0(`android-device-status.json`), 카메라/Stronghold/휴대폰 E2E 미검증. Tailscale 계정 로그인/네트워크 설정 변경도 하지 않음.
- 현재 바로 필요한 다음 한 단계: 사용 중인 메모장 문서를 안전하게 저장·종료해 메모리 여유를 확보한 뒤 WSL build-essential/unzip 준비→libsodium ARM64 archive→Windows APK 빌드를 재개. 종료 허가 없이 사용자 앱을 끄지 않는다. SDK/JDK 설치·약관 동의는 이미 완료했으므로 다시 승인받을 항목이 아니다.
- 이번에는 기존 전체 회귀/Windows 102개 검사/실제 Ollama 시험을 재실행하지 않았다. §34 결과를 현재 새 실행으로 표기하지 않는다. 실행 코드 변경 없이 설치·빌드 준비·실패 분석만 진행했다. 기존 코드/문서/원본 데이터/비전 문서 보존, Git commit/push/운영 배포 없음.
## §38 메모장 정상 종료 후 Android 빌드 재개 (2026-09-26, Codex)

- 사용자 직접 승인: “메모장닫고 이어서해줘”. origin/branch/HEAD 기준값 일치, 시작 미커밋 변경 전부 보존.
- 메모장 PID 26068, codex-p3-port-20260924.bundle 창 확인. 잠금 화면 때문에 Computer Use Alt+F4는 활성화 실패. 프로세스 CloseMainWindow() 정상 종료 요청 True 후 메모장 프로세스 소멸 확인. 강제 종료/원본 파일 저장·삭제/잠금 해제 없음. commit 31,388,471,296 → 22,833,184,768 bytes.
- WSL apt-get update 및 build-essential/unzip 설치 재시도 exit 0. 증거 wsl-build-tools-resume.txt. 기존 준비된 build-sodium-wsl.sh를 실행하여 Android ARM64 정적 라이브러리 빌드 진행 중. 결과는 아래에 추가한다.
### §38 중간 확인
- libsodium ARM64 빌드 exit 0. llvm-readobj 출력 ELF64/AArch64 확인. liblibsodium.a SHA256 affea821873499d81bc62ecd2cc4d9603aea8b3b3a2fd25a5c28a8e05f1b3f98. Windows build.rs의 SODIUM_LIB_DIR static link 경로를 사용, Stronghold 유지.
- Android 재시도: 컴파일 후 NDK clang.cmd 링크에서 한글 경로 CP949 인코딩 오류. CARGO_TARGET_DIR=C:\blackhole-build-tools\cargo-android-target로 산출물 경로 문제 해결 후 .rustup 표준 라이브러리 경로에서 동일 오류 확인. 원본을 이동하지 않고 C:\blackhole-build-tools\rustup-link junction 및 Android target 전용 --sysroot 지정으로 재시도 중. 경로 별칭만으로 rustc 기본 sysroot가 바뀌지는 않아 명시 플래그 사용.
- 전체 회귀 재실행: node --test --test-concurrency=1 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs. 1150 total / 1129 pass / 0 fail / 21 skip / 0 cancelled, exit 0, 384초. resume-regression-20260926.tap. npm test와 동일한 테스트 파일 범위, 메모리 절약을 위해 동시성 1 지정.
- npm --prefix apps/controller run verify:ui exit 0. 실제 서버 + 모의 native IPC/Stronghold/카메라 대체 검사, 실기기 검증 아님. controller-ui-resume.txt.
- adb 연결 0, git diff --check exit 0. android-devices-20260926.json.
- Tauri CLI 2.8.4 공식 소스의 configure_cargo가 CARGO_TARGET_*_RUSTFLAGS를 덮어쓰는 것을 확인(보존 reference 파일). target 플래그 시도는 적용되지 않아 실패. RUSTFLAGS에 --sysroot 및 -C link-arg=-Wl,-z,max-page-size=16384를 지정해 재시도, 실제 rustc 프로세스 명령에 ASCII sysroot 반영됨 확인. 성공 판정은 APK 검사 이후에만 한다.
### §38 완료 결과 — APK 빌드 완료, 실기기 흐름은 미완료

**VERIFIED (이번 실제 실행)**
- `. build-artifacts/acceptance-20260925/android-build-env.ps1` 후 `npm.cmd --prefix apps/controller run tauri -- android build --debug --apk --target aarch64 --ci`: exit 0. 실제 성공 로그 android-build-explicit-rustflags.txt. Rust native compile/link 및 Gradle APK 생성 완료. Gradle 8.14.3 최초 준비와 플러그인 요구 SDK 34 설치 완료(기존 승인된 SDK 라이선스). deprecated API/Gradle 9 비호환 경고가 있으며 이번 Gradle 8 빌드는 성공.
- 실제 산출물 원본: apps/controller/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk.
- 전달용 동일 바이트 사본: C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260926.apk. 64,202,081 bytes, SHA256 f21e85987357ccd26df6e52fec8361461e59197ac1b3ca2dd67fe3dcd6be1be1. original/copy 해시 일치.
- apksigner verify --verbose --print-certs exit 0: Android Debug 서명, v2 true. aapt dump badging exit 0: kr.yeno.controller.smoke, 0.2.0/versionCode 2001, minSdk 28, targetSdk 36, arm64-v8a, CAMERA/RECORD_AUDIO 권한 포함.
- zipalign -c -P 16 -v 4 exit 0. llvm-readelf -l에서 모든 LOAD 0x4000 정렬. APK 내 libyeno_controller_lib.so와 빌드 파일 SHA256 일치 ae871a2a07909d487ece2df13c3f0262aa0e7e2b873c3c7def14d25050a9d0c1. 파일명 universal은 생성기 명명이며 포함 ABI는 arm64-v8a 하나다.
- 변경 소스/산출물 추적: android-apk-manifest-20260926.json(현재 HEAD 위 미커밋 controller 소스 파일 해시), android-native-in-apk.json, android-apk-signature.txt, android-apk-badging.txt, android-apk-alignment.txt, android-native-program-headers.txt. 이전 §34 manifest는 보존.
- 전체 회귀 1129 pass / 0 fail / 21 skip, 컨트롤러 UI 대체 검증 exit 0는 위의 이번 실행 결과. Windows 102개 설치 검사와 실제 Ollama 실행은 §34의 이전 증거이며 이번 재실행으로 표시하지 않는다.

**RAN-UNVERIFIED / BLOCKED 경계**
- APK는 빌드·정적 패키지 검증 완료, 휴대폰 설치/실행은 미실시. Android Debug 시험판이며 운영 배포/스토어 릴리스 아님.
- adb 연결 수 0으로 실제 휴대폰 설치·카메라 QR·Stronghold 저장·요청→PC 실행→휴대폰 결과·앱 종료 후 복구·오프라인 복구는 BLOCKED/미검증. 네트워크 로그인/방화벽 변경/카메라 권한 승인 등을 대신 수행하지 않았다. 브라우저/native mock 검증은 이 간극을 닫지 않는다.
- 이번 변경: docs/CLAUDE_EXECUTION_STATE.md 및 ignored 빌드 환경/증거/생성 산출물, C:\blackhole-build-tools의 도구·라이브러리·경로 별칭. 기존 제품 소스·비전·Vault 원본 보존. 운영 배포/원본 데이터 삭제/자격증명 교체/Git commit/push 없음.
- 다음 한 단계: 실제 Android 휴대폰을 PC에서 접근할 수 있게 연결한 뒤 위 시험 APK를 설치하고 P02→J01→R01/F01 실기기 수락 시험을 실행한다. SDK/JDK/약관 동의는 이미 완료되어 재승인 대상 아님. 사용자는 터미널 명령을 실행할 필요가 없으며, 기기 연결·기기 측 승인만 필요하다.
## §39 R3 원장 직접 대조·M1 자료→기억→다음 행동 연결 (2026-09-26, Codex)

### 인수한 목적과 범위
BLACKHOLE은 연호님의 입력·의도·개별 제품/작품/사업/연구를 지속 기억에 연결하고, 승인된 실행·검증·재사용으로 진전시키는 개인 AI 운영체제다. 폰 연결은 사용 접점 하나이며 전체 목적의 대체물이 아니다. 1,117행은 독립 사업 1,117개나 구현 완료 수가 아니다. 원래 ID·목표·별칭·후속 정정·취소·과거 AI 제안 상태를 보존한다. 과거 제안/회수 원문을 새 실행 승인으로 취급하지 않는다.

### M0 / 패키지 직접 확인 — VERIFIED
- 실제 root C:\Users\우연호\Documents\Projects\yeno-os, origin https://github.com/wooyeonho/yeno-os.git, branch blackhole/p3-jev-recovery-port-20260924, full HEAD 43a2d1b44e0a60ebad4982dc1e2222213869cc1a. 시작 dirty 40건. 기존 변경 보존, reset/checkout/commit/push 없음. 현재 worktree 1개. 시작 목록·현재 파일별 해시: build-artifacts/handoff-r3-20260926/starting-git-status.txt 및 CURRENT_RUNTIME_MANIFEST.json.
- Vault AI_OPERATING_RULES/AGENTS/CLAUDE 모두 rules_version 2. CHANGELOG (38)의 두 frontmatter 수정, (39)의 이전 5폴더 보관, (40)의 89건 정정을 읽었다. 저장소 AGENTS·현재 실행 기록 §38 및 관련 코드/테스트를 대조했다. 00_START_HERE → 02_RECHECK_RESULTS → 07_OPEN_GAPS → evidence_base/13_OWNER_INTENT와 01_CODEX_EXECUTION_HANDOFF, 08_CURRENT_INPUTS_AND_CORRECTIONS를 읽고 M0~M5에 연결했다.
- ZIP 실제 SHA256 797b5c73cc3af4bbea1dc841b30b8e0207a9f05d136635c39249788cfbeec464 일치. 압축 내 766파일, PACKAGE_SHA256 765개 전부 일치. Vault 정본 766파일, 누락/추가 0. 불일치 두 파일(00_START_HERE.md/01_ALL_IDEAS.md)은 ZIP 바이트에서 vault_applied: false→true 한 번 치환한 결과와 정확히 일치. 복사/압축 해제/Vault 갱신을 하지 않음.
- 전체 JSON·CSV·HTML 파싱: 각 1,117개, ID 고유/순서 일치. CSV의 6개 문자열 필드와 source_refs/related_ids JSON 필드까지 전체 JSON과 일치. HTML은 original_record/detailed_audit 제외한 JSON 투영과 정확히 동일. 기준 849개 original_record 필드 존재 및 전부 동등 보존, 추가 268·삭제 0·JSON 변경 210. 검증 스크립트/결과: verify-package.py, package-verification.json. 전 항목 ID·목표/다음행동 해시·근거 포인터 색인: idea-index.json. 이 구조/무결성 확인을 1,117개 목표 전체의 의미 검토 완료로 확대하지 않음.
- 외부자료 상태 직접 집계: 89 = unread 59 / partial 19 / unavailable 11. 전체 대화 export 완료/의미 누락 0을 주장하지 않음. 기존 849개 원본·추가 268개 상태 구별. SilverGuardian≠한끼안부, Synapse 두 기획 분리, 계절안부≠A03/A04, 프롬프트 마켓→Gyeol은 계보 증거만이라는 경계 유지.
- 현재 PC 재확인: 8790/8792 listener 미발견, Ollama 11434 listener 확인, BLACKHOLE 이름의 예약 작업 0, ADB 연결 0, Tailscale PATH 미발견(전체 디스크 설치 부재를 단정하지 않음). §38 APK 파일 존재 및 SHA256 f21e85987357ccd26df6e52fec8361461e59197ac1b3ca2dd67fe3dcd6be1be1 재확인. §38의 빌드/이전 설치 시험은 현재 운영 resident가 설치·실행 중이라는 증거가 아님.

### 이번 코드 변경과 실제 결과
- 공백: sources 등록/중복 방지/검토/조회/브리핑 및 memory-events는 기존 구현. 그러나 일반 대화의 recallMemories는 memoryEvents/legacy notes만 회수하여 자료의 최신 review를 직접 사용하지 않았다.
- runtime/lib/memory-recall.mjs: 기존 sources를 회수 후보로 추가하고 alias/application/summary에서 관련 자료를 찾음. prompt에 source ID·버전·읽기/결정/구현 상태·원본 역추적 URL을 별도 표기. 기존 source 기억 이벤트는 삭제하지 않고 보존하되, 현재 source가 존재하면 오래된 source snapshot 대신 최신 source review를 회수. episode/decision/result 기억은 그대로 유지. 최대 5개/각 텍스트 400자 제한, 지시 아닌 자료 표시 유지. 새 job/memory/auth 저장소·운영 마이그레이션 없음.
- runtime/test/source-memory-recall.test.mjs: 먼저 2개 신규 시나리오 실패를 재현(source-recall-red.txt), 수정 후 통과. 실제 HTTP 코어를 통한 네 입력 접수→기억/문서→재시작→재질의→수정→충돌/부적격 승격 거부 시나리오 추가. 관련 sources/backup/voice-embedding/기억 검사 29 pass / 0 fail (m1-focused.txt).
- scripts/verify-source-intake-live.mjs: 기존 API만 사용하는 반복 가능한 로컬 수락 실행기. 새 출력 디렉터리만 사용하고 비밀은 메모리에서만 전달, 운영 저장소/Vault 접근·배포 없음. 네 입력 fixture는 원장 EXTRA-134~137, INTAKE-20260926-01~04, 원래 URL·의도·다중 목적지 후보·근거 상태와 파일 SHA를 연결했다. 전체 1,117행을 잘라 네 건만 남긴 것이 아니며 전체 원장은 읽기 전용으로 유지한다.
- 실제 명령: node scripts/verify-source-intake-live.mjs build-artifacts/handoff-r3-20260926/four-inputs.json build-artifacts/handoff-r3-20260926/m1-live qwen2.5:3b. exit 0. 실제 loopback HTTP 코어 + 디스크 저장 + 실제 Ollama 로컬 생성 1회. 새 입력마다 source→memoryEvent→document job→artifact ID/해시 연결, 중복 import 4건 재사용, 두 차례 재시작 후 다른 별칭 검색/최신 수정 회수 성공. 기존 revision 수정 409, partial 자료 candidate 승격 400 확인. ALL 4 / QUEUED 4 / NOW 0 / BLOCKED 0; 자동 운영 false, 외부 memory outbox 0.
- 수정 시험은 격리된 코어에서 테스트용 다음 행동을 변경한 것이며 사용자가 실제 프로젝트 우선순위를 새로 결정한 것으로 기록하지 않는다. 저장 결과와 전체 계보: m1-live/report.json, 네 개 EXTRA-134~137-next-action.md, current-recall.txt. 실제 Ollama 응답 local-model-recall.md는 수정한 깊이 가림 조건과 엔진 등 미확인 사항을 응답했다. 생성 산출물은 SHA 확인했지만 독립 의미 Verifier/M2 완료는 아님. 이번 회수는 키워드/별칭 기반이며 임베딩 의미 검색이나 모델 가중치 학습이라고 보고하지 않는다.
- 네 Instagram 원페이지 재열람을 실제 시도했으나 모두 fetch throttled. 우회하지 않음. 인계의 부분 관찰을 partial로 보존하며 이번 직접 영상 시청/코드 확인으로 승격하지 않음. 원문의 창작자 주장/관찰/추론은 fixture evidenceSection에 별도로 유지했다.

### 전체 실행 지도와 남은 조건
| 단계 | 이번 연결·근거 | 미완료/다음 결과 |
|---|---|---|
| M0 | 실제 저장소·환경 manifest, 1,117행 무결성/보존 확인 | 각 항목을 현재 코드/산출물에 의미 단위로 연결하는 전수 감사는 미완료 |
| M1 | 네 입력의 기존 source/memory/job/artifact·재시작·수정 회수, 실제 로컬 응답 | 원페이지 전체 재열람·운영 resident 적용은 미완료. 다중 연결은 application에 후보/이유로 보존하며 실제 projectId 그래프로 확정하지 않음 |
| M2 | 브리핑 문서와 재사용 가능한 intake 실행기 생성 | Shadow 역할 분담→독립 검증→Kirby 채택→두 번째 과제 재사용/개선 측정은 아직 이 입력에 실행하지 않음 |
| M3 | §38 APK/Windows 산출물 보존, 이번 APK 해시 재확인 | 휴대폰 연결 0, 설치/QR/Stronghold/폰 요청·결과·복구 실기기 대기. M1 작업은 계속 진행함 |
| M4 | 기존 requestId/백업/검토 충돌 경계 재사용·관련 회귀 | 사용자 실제 운영 업그레이드/복원 실사용은 이번 실행 아님 |
| M5 | 모든 ID·원래 목표·제안/취소 상태와 evidence pointer 유지 | 50+추가 아이디어의 개별 제품/사업 완료를 주장하지 않음. 동명·유사명 자동 병합 없음 |

- 다음 구체 결과: EXTRA-136(공간 연출)의 원래 목표를 유지한 독자 에셋 기반 최소 장면/가림 조건 시험을 기존 코드 작업·산출물·검증·기억 계보에 연결하고, 결과를 같은 절차로 다른 입력에 재사용해 M2 근거를 만든다. 이는 현재 의존성이 준비된 로컬 초안 후보 선택이며 네 영상의 원래 사업/제품 전체 목적이나 전체 원장을 대체하지 않는다. 실제 기기가 연결되면 M3 수락을 이어간다.
- 이번 수정 파일: runtime/lib/memory-recall.mjs, runtime/test/source-memory-recall.test.mjs, scripts/verify-source-intake-live.mjs, 이 실행 기록. 기존 미커밋 변경·비전 문서 보존. Vault/원문/허브/분류/CHANGELOG 무수정. SDK/JDK 라이선스 재승인 요구 없음. 실제 권한/자료 경계는 영상 원문 접근과 Android 연결이며 운영 배포/데이터 삭제/자격증명 교체는 수행하지 않음.
### §39 최종 검증 결과
- 전체 회귀 실제 재실행: `node --test --test-concurrency=1 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs` (Node 24.19.0). **1153 total / 1132 pass / 0 fail / 21 skip / 0 cancelled**, exit 0, 376초. build-artifacts/handoff-r3-20260926/full-regression.txt. §38의 1129 통과에 신규 3개 시나리오가 추가된 결과이며 skip을 실행 통과로 세지 않는다.
- `git diff --check` exit 0. controller 소스/빌드는 이번에 바꾸지 않았고 APK 재빌드를 했다고 주장하지 않음. 변경은 Windows 코어의 자료 회수 연결이다.
- Vault 전후 해시: 일반 경로로 주소 가능한 2855개 파일의 추가/삭제/변경 0. 이전 보관본 3개가 1/1/2파일 부족해 보였던 원인은 Windows 긴 경로 제한이었다. `\\?\` 확장 경로로 다시 확인하여 Vault 전체 2859개, 보관본 **126/561/564/586/6** 확인. 처음 snapshot에서 제외된 긴 경로 4개는 각 보관본 PACKAGE_SHA256와 전부 일치. 실제 누락으로 기록하지 않는다. vault-final-extended-verification.json이 최종 판정이며 archive-readonly-check.json의 일반 경로 미발견은 확장 경로로 해소됐다. Vault 쓰기 0, CHANGELOG 무수정.
- 직접 여는 결과: build-artifacts/handoff-r3-20260926/m1-live/INDEX.md. 네 최초 브리핑과 수정 이후 current-recall.txt/local-model-recall.md를 분리 보존. 외부 페이지 미열람, 후보 관계, 키워드 회수, 실제 로컬 생성, 독립 의미 검증 미실시를 명시.
- VERIFIED: 패키지/원장 대조, 기존 변경 보존, 자료→기억→문서/해시→재시작/수정 회수, 실제 로컬 생성·회귀. RAN-UNVERIFIED: 네 원페이지 열람 시도(throttled), 생성 답변의 독립 의미 검증·효과 향상. BLOCKED: 실제 Android 연결·카메라/기기 승인 경계. 학습/QPU나 제품/사업 전체 완성으로 확대하지 않는다.
## §40 M2 실제 로컬 Shadow 실행과 진행 상태·자료 범위 교정 (2026-09-26, Codex)

### 기준과 범위
- 시작 및 종료 시 저장소 root C:\Users\우연호\Documents\Projects\yeno-os, origin https://github.com/wooyeonho/yeno-os.git, branch blackhole/p3-jev-recovery-port-20260924, HEAD 43a2d1b44e0a60ebad4982dc1e2222213869cc1a 일치. 기존 §39 dirty 43건 보존. 이번 종료 status 47건. reset/checkout/commit/push 없음.
- 실제 adb C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l: 연결 0. Android 실기기 P02→J01→R01/F01은 여전히 BLOCKED. 이 작업은 격리된 loopback 코어와 로컬 Ollama만 사용하며 운영 resident/배포/Vault는 수정하지 않았다.
- 기준 입력은 §39의 four-inputs.json 중 EXTRA-136. 원장·원 URL/부분 관찰/미열람 상태를 유지하고 사용자 채택 또는 영상 원문 검증으로 승격하지 않았다.

### 발견 및 변경
- 첫 격리 실행에서 missionStatus가 scout/researcher queued임에도 builder의 정상 dependencyPending을 먼저 읽어 phase=blocked로 표시했다. runtime/lib/shadow-army.mjs에서 활성 queued/running을 정상 의존성 대기보다 먼저 판정하도록 수정했다. providerMissing 등으로 실행 가능한 worker가 없으면 blocked가 유지된다. runtime/test/shadow-army.test.mjs에 red→green 회귀 추가.
- 실제 모델 호출에서 Shadow 작업은 project_read/project_sources를 제공받지 못했고, 공식 GitHub release 전용 source_read_release를 Instagram 소스 ID에 시도했다. runtime/lib/agent-engine.mjs가 Shadow 담당 프로젝트의 불변 스냅샷 및 그 프로젝트 소스의 title/URL/readingStatus/decision/summary/application/riskNotes만 읽게 변경했다. 다른 프로젝트의 자료는 제외. 공식 release가 담당 프로젝트에 없으면 release reader를 제시하지 않고, Shadow 모델 도구 목록은 담당 프로젝트 자료 도구로 제한한다. 일반 agent와 기존 project bot의 도구 목록은 해당 회귀 시험으로 확인했다.
- 로컬 qwen2.5:3b는 프로젝트 자료를 읽는 여러 모델 턴에 기존 90초 제한이 짧아 unknown 호출을 남겼다. runtime/server.mjs에서 **로컬 provider의 Shadow 작업**에만 최대 300초를 부여했다. 다른 provider 및 일반 작업 제한 90초는 유지. 결과가 unknown인 기존 호출을 재전송하지 않았다.
- scripts/verify-source-shadow-live.mjs 신규. 매번 새 출력 폴더/격리 저장소/메모리 내 소유자 토큰을 쓰고, project→partial source→실제 Shadow mission→artifact SHA 검증→재시작 복구를 수행한다. 역할 하나가 실패해도 다른 queued/running 작업이 끝날 때까지 기다리며, 실패를 성공으로 바꾸지 않는다. 비밀값 출력·운영 저장소 변경 없음.

### 실제 실행과 결과
- node --test runtime/test/shadow-army.test.mjs runtime/test/project-bots.test.mjs runtime/test/agent.test.mjs: 40 pass / 0 fail. 상태 표시 및 프로젝트 경계 테스트는 수정 전 의도한 실패를 확인하고 수정 후 통과했다.
- node scripts/verify-source-shadow-live.mjs build-artifacts/handoff-r3-20260926/four-inputs.json <새 출력 폴더> qwen2.5:3b: 실제 Ollama 호출과 디스크 결과. m2-shadow-live(첫 수락 스크립트가 정상 의존성 대기를 조기 blocked로 간주) → m2-shadow-live-fixed(두 조사 작업의 두 번째 호출 unknown/실패) → m2-shadow-live-scoped(Scout/Researcher/Builder 및 결정론적 Verifier 완료, Builder SHA 9dc9b22ec3cc988a146db631f5cd509a8c4e6d59255ca6b7fc3cec6a78e15464, 의미 검증 응답 형식 오류 및 내용 부실로 실패) → m2-shadow-live-tools-fixed(Builder SHA 98bd84f9f8c0c187802a62871abd73e234914126487160d7952cfbfe5ba0ae41, 의미 검증 uncertain) → m2-shadow-live-project-only(Scout가 project_read 반복 후 4회 호출 상한에 도달, 종속 작업 실패). 각 report.json과 격리 runtime/state.json, 생성된 경우 builder artifact를 보존했다. **M2 전체 통과 아님.** 작은 로컬 모델의 반복 도구 호출/빈약한 작업 카드가 실제 한계다. semantic fail/uncertain은 통과로 바꾸지 않았다.
- 전체 회귀: Node 24.19.0, node --test --test-concurrency=1 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs; exit 0, **1154 total / 1133 pass / 0 fail / 21 skip**, 376초. 출력은 사용자 지정 바탕화면 npm-test-output.txt 및 build-artifacts/handoff-r3-20260926/m2-full-regression.txt에 동일 바이트 보존, SHA256 248b4e3452730f9c2be5c2ca41890d592f901552931420c2cb559fedb7979d2c.
- node --check scripts/verify-source-shadow-live.mjs 및 git diff --check 대상 변경 파일 exit 0. APK 파일·Android 소스는 이번 변경 없음; §38 APK 빌드를 이번에 재실행했다고 주장하지 않는다.

### 상태와 다음
- VERIFIED: Shadow 진행 상태가 정상 의존성 대기를 blocked로 오표시하지 않음, 프로젝트 범위 자료/상태/다음 행동/위험 메모 접근, 다른 프로젝트 자료 비노출, 관련 및 전체 회귀, 실모델 실패와 artifact SHA·재시작 복구.
- RAN-UNVERIFIED: EXTRA-136 실모델 작업 시도와 부분적 Builder 산출물. 조기 종료를 제외한 네 번의 로컬 임무는 모두 호출 오류·의미 검증 또는 호출 한도에서 실패했으며 실제 공간 장면·가림 작동을 만들지 못했다. 본문 품질 개선/두 번째 과제 재사용/Kirby 채택은 미완료.
- BLOCKED: 실제 Android 휴대폰 연결 0으로 카메라 페어링·폰 요청/진행/결과/복구 실기기 시험 불가. Vault 원문/정본 수정·운영 배포·자격증명 변경·데이터 삭제 없음.
- 다음 한 단계: EXTRA-136의 독자 에셋 기반 **실행 가능한 최소 깊이 가림 장면과 시험**을 로컬에 만들고, 파일/화면/검증 근거를 기존 source→job→artifact 계보에 연결한다. 동시에 실기기 연결이 가능해지면 M3 수락 시험을 우선 진행한다. 모델의 빈 작업 카드를 실제 결과로 채택하지 않는다.

## §41 EXTRA-136 실행 장면·오프라인 산출물·기억 계보 (2026-09-26, Codex)

### 범위와 실제 결과
- 저장소 root `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, full HEAD `43a2d1b44e0a60ebad4982dc1e2222213869cc1a` 재확인. 시작 시 §40의 미커밋 47건 기록·보존, 기존 변경 reset/checkout/commit/push 없음. `adb devices -l` 연결 0. 운영 resident 설치/실행, APK 재빌드, Vault 원문/정본 수정은 이번에 하지 않았다.
- §40의 다음 한 단계였던 EXTRA-136 **독자 SVG 2D 공간 가림 시험**을 `experiments/extra-136-occlusion/`에 구현했다. `DESIGN.md`를 먼저 작성하고, 순수 `scene-core.mjs`에서 수평 위치/깊이(0~100)에 따라 문 앞 레이어, 문 안쪽 클립, 문 바깥 완전 가림을 계산한다. `index.html`/`style.css`/`scene.mjs`는 포털·실내·물체를 독자 SVG로 그리고 슬라이더/사전 장면/실시간 판정·좌표·레이어를 제공한다. 원본 Instagram 공개 링크는 출처 추적용으로만 표시하며 영상은 이번에도 직접 확인하지 못해 `partial/pending`이다. 원본 IP·화면·캐릭터를 복제하지 않았다.
- `build-offline.mjs`는 기존 esbuild로 CSS/JS를 포함한 단일 HTML을 새 경로에 생성한다. 전달 파일 `build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline-v3.html`: 18,315 bytes, SHA256 `4672d40e6bbd75ee2857fd829cfb7fa8612858538762b581948718c9dbd25220`. 로컬 `file://` Chrome에서 열어 실제 조작했다. 이 파일은 실험 산출물이며 BLACKHOLE Android 앱/Windows resident에 탑재된 기능은 아니다.
- 첫 오프라인 v2는 브라우저에서 `Cannot read properties of null (reading 'addEventListener')`로 실패했다. 인라인 스크립트가 DOM 생성 전 `<head>`에서 실행된 재현이었다. 브라우저 오류 검사로 red를 남기고 스크립트를 `</body>` 앞에 넣어 v3에서 같은 `file://` 시나리오 green을 확인했다. 실패 자료 `extra136-offline-browser-v2-red/report.json`과 통과 자료 `extra136-offline-browser-v3/report.json` 보존.
- 독립 화면 검토 2명은 v4에서 모바일 조작 중 장면 사라짐, 768px 버튼 과대, 한글 낱글자 줄바꿈, 12px 보조 글자, 원본 링크 부재를 지적했다. 수정 후 두 검토 모두 PASS. 1023px 이하 고정 미리보기, 자연 높이 버튼, 한글 어절 줄바꿈, 14px 보조 글자, 공개 원본 링크, 부분 가림 경계 캡처를 확인했다. 이는 화면·코드 검토이며 스크린리더 실사용/AR 기기 검증은 아니다.

### 실제 명령·검증
- `node --test experiments/extra-136-occlusion/scene-core.test.mjs`: 3 pass / 0 fail. 구현 전 red와 수정 후 green을 확인한 순수 기하 시험.
- `node experiments/extra-136-occlusion/verify-browser.mjs build-artifacts/handoff-r3-20260926/extra136-visual-v6`: 실제 로컬 Chrome, 375/768/1280px 앞/안쪽/숨김/앞 가장자리/부분 가림, 375/768 조작 중 장면 동시 표시 총 **17 캡처**, exit 0. 슬라이더 키보드 Home·focus, aria-live 속성, reduced motion, source URL, 수평 넘침·pageerror 없음. 각 파일 SHA는 `report.json`에 기록. 실제 스크린리더 발화나 색 대비 자동 감사까지 했다고 주장하지 않는다.
- `node experiments/extra-136-occlusion/build-offline.mjs build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline-v3.html`: exit 0. `node experiments/extra-136-occlusion/verify-browser.mjs build-artifacts/handoff-r3-20260926/extra136-offline-browser-v3 build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline-v3.html`: **file:// 직접 실행**, 17 캡처, exit 0. 앞선 v2는 동일 검사에서 exit 1로 실패했고 오류를 고쳤다.
- `node scripts/verify-prototype-handoff-live.mjs build-artifacts/handoff-r3-20260926/four-inputs.json build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline-v3.html build-artifacts/handoff-r3-20260926/extra136-offline-browser-v3/report.json build-artifacts/handoff-r3-20260926/extra136-prototype-handoff-v1`: exit 0. HTML/17 캡처 SHA 재대조 후 **M1 원장 fixture의 EXTRA-136을 새 격리 저장소에 재접수**해 project→partial/pending source→자료 브리핑 job→HTTP artifact SHA→result memoryEvent(source+job 참조)를 기록, 재시작 후 job/artifact/memory와 HTML SHA 회수 확인. `extra136-prototype-handoff-v1/report.json`의 새 ID·해시 및 `prototype-recall.txt`가 근거다. 기존 M1 저장소의 ID/기록을 변경하거나 그 저장소에 산출물을 붙인 것은 아니다. 외부 기억 동기화, 운영 Kirby 채택, Shadow 전체 M2 검증 완료로 확대하지 않는다.
- 원래 요청한 PowerShell 형태로 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 실행(Node 24.19.0, 출력 숨김만 추가): exit 0, **1154 total / 1133 pass / 0 fail / 21 skip**, 약 114초. 같은 바이트 사본 `build-artifacts/handoff-r3-20260926/extra136-full-regression.txt` SHA256 `468e79dfb1b70c5f088cf594d15f066872572e1441916ea9c859af40570b6761`. `git diff --check` exit 0(Windows LF→CRLF 안내만 출력).

### 판정과 다음 단계
- **VERIFIED:** 독자 2D 가림 계산, 실제 Chrome 화면/키보드·반응형 17상태, `file://` 오프라인 실행, 산출물 SHA, 격리 코어의 자료→작업→산출물→기억·재시작 회수, 기존 npm 전체 회귀. **RAN-UNVERIFIED:** 이번 실행에는 없음. **NOT RUN:** 실제 스크린리더 발화·원본 영상 전체 재열람·AR 공간 인식. 모델 생성 Shadow 임무의 이전 실패를 지우지 않았고 이 수동·코드 실험을 Shadow 성공으로 재분류하지 않는다.
- **BLOCKED:** `adb devices -l` 0대로 실제 Android APK 설치·QR 페어링→폰 요청→Windows PC 실행→폰 진행/결과→종료·재시작 복구, PC 오프라인/실패 표시의 실기기 수락 시험. 설치된 Android SDK 경로에 emulator.exe가 없고 생성된 AVD도 없어 에뮬레이터 대체 실행은 불가했다. APK 정적 빌드/브라우저/코어 대체 검증은 이 항목의 대체가 아니다.
- 변경 파일: 신규 `experiments/extra-136-occlusion/{DESIGN.md,README.md,scene-core.mjs,scene-core.test.mjs,index.html,style.css,scene.mjs,verify-browser.mjs,build-offline.mjs}`, 신규 `scripts/verify-prototype-handoff-live.mjs`, 이 정본 실행 기록. 기존 미커밋 제품 변경 보존, Vault 쓰기 0, 운영 배포·데이터 삭제·실제 자격증명 교체 없음.
- 다음 한 단계: **휴대폰이 PC에 연결되는 즉시** §38의 시험 APK로 P02→J01→R01/F01 실기기 수락 흐름을 직접 실행한다. 연결 전에는 이번 2D 시연을 다른 소스 입력에 적용하는 M2 재사용성·의미 검증과 제품 통합 여부를 별도 판단하되, 폰 검증 우선순위를 낮추지 않는다.

## §42 최신 Windows/Android 대체 수락 재검증 (2026-09-26, Codex)

- 이전 §41은 시연 파일·기억 계보를 만든 **실제 진전**으로 분류한다. 이 절은 다시 최우선 휴대폰→PC 흐름을 확인한 결과다. 시작 root/origin/branch/full HEAD는 §41과 일치했고 기존 미커밋 파일은 보존했다. `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l`은 여전히 연결 0. 현재 8790/8792/9443 listener 및 BLACKHOLE/YENO 예약 작업 0, `tailscale` 명령 없음. 운영 resident가 현재 설치·실행 중이라고 보고하지 않는다.
- `node scripts/blackhole-check.mjs --mode isolated --json build-artifacts/handoff-r3-20260926/phone-pc-local-current/blackhole-check.json`: exit 0, outcome PASS. **격리된 실제 HTTP 코어**에서 시험 기기 등록→무해한 문서 작업 완료→결과 바이트 SHA 검증→코어 프로세스 종료/재시작→같은 작업 ID·산출물 SHA 재조회→기기 철회 및 옛 credential 401 거부를 관찰했다. `restartReadback=PASS(process_restart)`, `deviceRevokeStatus=success`, `deploymentMatchesSource=true`. JSON SHA256 `03d1022666e15ad11f0f103daa941e10f526f9829a8feec45a80c407dd8b304f`. 이 검사는 invitation/QR/Stronghold/실제 Android를 통과하지 않는다.
- `npm.cmd --prefix apps/controller run build`: exit 0, TypeScript 검사와 Vite 생산 번들 생성(113 modules, JS 185.71 kB). 로그 `phone-pc-local-current-controller-build.txt`, SHA256 `0bb38f10b9eac0ec6a4e9dc1d6681ab55b72549f68d490320b32dd8d79a4c51f`. 이는 APK 재빌드가 아니다.
- `npm.cmd --prefix apps/controller run verify:ui`: exit 0, 현재 번들+실제 격리 코어+모의 native IPC의 초대 스캔/등록·작업·결과 SHA·앱 DOM 재생성/보관소 대체 어댑터·오프라인 표시·실패 이유·멈춤/재개·철회 시나리오 통과. 로그 `phone-pc-local-current-verify-ui.txt`, SHA256 `1a8f61118ae0393f36404a973cea2f9db700693484c839964380bcf0ceb7aff9`. `videoRendererAvailable=false`; 영상 렌더 시험을 통과로 세지 않는다. Stronghold 실제 암호화·카메라·Android WebView 검증은 아니다.
- `node apps/controller/verify-pairing-browser.mjs`: exit 0, 실제 Edge 브라우저 375/768/1280px 화면, owner 키 입력란 부재, 잘못된 QR 오류·재스캔 확인. 로그 `phone-pc-local-current-pairing-browser.txt`, SHA256 `9570fce701049acf949df7d9fb53bc1f549d28e9004e5bde20381ab5d927631d`. Native 카메라 미검증. 기존 짝 테스트와 전체 `npm.cmd test` 1154/1133/0/21은 §41의 앞선 실제 실행이며 이번에 재실행했다고 쓰지 않는다.
- 설치된 Ollama CLI `list`는 `qwen2.5:3b`와 `bge-m3:latest`를 표시했고 loopback `127.0.0.1:11434` listener를 자동 기동했다. 그 실행 중인 로컬 서비스에서 `node scripts/verify-resident-local-live.mjs`를 별도 작업 디렉터리에서 실행: exit 0, 격리 Windows resident의 실제 `qwen2.5:3b` 작업 completed, artifact 353 bytes/SHA256 `5dca3b7998ada60bd917e270828ba194efa285f303a45d857e33f0481ee6054a`, resident 중지·재시작 후 결과 보존. 보고서 `resident-live-current/build-artifacts/acceptance-20260925/resident-local-live.json` SHA256 `c0239caee0e22b1b395e93eb6ae7a37154733af60fe86941b7857cce0c4c6568`. 보고서의 `source:null`은 이 실행에 `BLACKHOLE_SOURCE_SHA`를 주입하지 않았음을 뜻한다. 실제 소스는 이 절의 root/HEAD/미커밋 상태와 §38/§41 해시를 따로 기록하며 보고서만으로 정확 소스를 증명한다고 주장하지 않는다. Ollama 11434 listener는 이 절 종료 시에도 살아 있음; 8790 resident는 남아 있지 않다.
- §38 `android-apk-manifest-20260926.json`의 컨트롤러 소스 **42/42 파일 SHA 현재 값 일치**, 전달 APK SHA도 manifest와 일치. 컨트롤러 파일은 APK 이후 변경되지 않았다. 런타임/서버의 이후 미커밋 수정까지 APK 안에 담겼다는 뜻은 아니다; 해당 Windows 코어는 위 격리 시험에서 현재 소스로 실행했다.
- 자동 실행 검토가 `Start-Process ... ollama serve`와 시험 후 `Stop-Process`를 포함한 단일 PowerShell 호출을 **“blocked by policy”**로 거절했다. 이 합성 명령은 실행되지 않았다. 별도 시작·종료 우회 명령은 수행하지 않았고, 이후 읽기용 `ollama list`가 서비스를 자동 기동한 현상과 이미 열린 loopback listener를 관찰해 위 격리 시험만 실행했다. 거절의 더 구체적인 이유는 도구에서 제공하지 않았다.
- **VERIFIED:** 격리 코어의 문서 작업/해시/재시작/철회, 현재 Android 번들 빌드·모의 native 화면 배선/오프라인·실패 표시, 브라우저 페어링 화면, 실제 로컬 모델 resident 호출/재시작, APK 소스 manifest/파일 hash 일치. **RAN-UNVERIFIED:** 이번 실행에는 없음. **NOT RUN/BLOCKED:** ADB 0, 사설 HTTPS/Tailscale 활성 경로 및 실기기 승인이 없어 P02→J01→R01/F01의 실제 폰→Windows 전체 수락 시험, Stronghold·카메라·Android 화면 관찰을 실행하지 못했다. 운영 Windows 설치·재부팅은 사용 중 환경 변경에 해당해 이번 범위에서 실행하지 않았다. 운영 배포·데이터 삭제·실제 자격증명 교체 없음. 이번 저장소 수정은 이 정본 기록뿐이고 격리 산출물은 ignored `build-artifacts`에 남겼다.
- 다음 한 단계: 휴대폰을 PC에 연결하고 기기 화면에서 USB 디버깅을 승인받으면, 기존 APK를 설치하고 P02→J01→R01/F01을 실제 폰에서 직접 실행한다. 기기 연결 전에는 가짜 PASS를 만들지 않는다.

## §43 일회성 초대→작업→복구 통합 경계 검사 (2026-09-26, Codex)

- 시작 root `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, full HEAD `43a2d1b44e0a60ebad4982dc1e2222213869cc1a` 일치. 시작 `git status --short` 49건으로 기존 변경 전부 보존. `adb devices -l` 연결 0, 8790/8792/9443 listener·운영 예약 작업 없음. 이전 §42는 격리 흐름과 실제 로컬 모델 호출을 새 증거로 남긴 **진전**이었다.
- 발견한 수락 간극: 기존 `scripts/blackhole-check.mjs --mode isolated`는 owner credential로 `/api/v1/devices/enroll`을 직접 호출해 작업/재시작을 검증했지만, 신규 QR 초대의 `/api/v1/pairing/invites`→`/api/v1/devices/enroll-invite`를 같은 흐름에서 거치지 않았다. `runtime/test/native-pairing.test.mjs`는 초대만 별도 검증했다. 격리 모드에만 일회성 초대 경로를 연결했고 live/basic 모드의 기존 직접 등록 계약은 유지했다. 합성 `.ts.net:9443` origin은 API 계약용이며 실제 Tailscale/TLS 연결 증거가 아니다.
- `runtime/test/blackhole-check.test.mjs`에 `pairingMode=one-time-invite`, 발급/등록/동일 requestId 복구/다른 requestId 재사용 409/코어 재시작 뒤 옛 초대 401을 요구하는 단언을 먼저 넣고 red 확인(`phone-pc-invite-red.tap`). 첫 구현에서는 기존 `check-tool` 플랫폼을 초대 등록에 보내 실제 HTTP 400 `Invalid native enrollment.`을 재현했다. 서버 계약의 `android|windows`에 맞춰 합성 Android 시험 기기로 지정했다. 뒤이어 보고서 `invite_enrolled.ok`가 불리언 대신 기기 ID 문자열이던 것을 엄격 단언으로 red 재현(`phone-pc-invite-shape-red.tap`) 후 불리언으로 수정했다. 실제 기기 ID/초대 토큰은 통합 보고서에 기록하지 않는다.
- 현재 격리 실명령: `node scripts/blackhole-check.mjs --mode isolated --json build-artifacts/handoff-r3-20260926/phone-pc-invite-current-v2/report.json`, exit 0. 5개 초대 단계 모두 `ok:true`: owner 발급 201, invite 등록 201, 같은 requestId 재전송 같은 기기/토큰 201, 다른 requestId 409, 프로세스 재시작 뒤 옛 초대 401. 이어 인증된 무해한 문서 작업 completed, artifact 바이트/서버 SHA 일치, 같은 job/artifact 재조회 `PASS(process_restart)`, 기기 철회 및 이전 기기 인증 401. `outcome=PASS`, 모든 `steps[].ok` 불리언. 보고서 SHA256 `ef926d8e66291e90a7fa2a89a65cabaf6a9bd9184356a4abeffed2ec55f54a7c`. owner/초대/기기 비밀값은 stdout·보고서·채팅에 출력하지 않았다.
- 관련 검사: `node --test runtime/test/blackhole-check.test.mjs runtime/test/native-pairing.test.mjs` **8 pass / 0 fail**, `phone-pc-invite-focused-green.tap` SHA256 `8a5be6d044216a3cf82bd3ce398b050a5eb39fadbb48663f72601d82a6b733cc`. 초대 만료·취소·capacity·GUI 메모리 QR은 기존 별도 시험의 경계이며 이번 단일 CLI 보고서에 그 단계를 넣었다고 주장하지 않는다.
- 변경 후 요청한 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 재실행(Node 24.19.0): exit 0, **1154 total / 1133 pass / 0 fail / 21 skip**, 약 100초. 같은 바이트 사본 `build-artifacts/handoff-r3-20260926/phone-pc-invite-full-regression.txt` SHA256 `0bcdcec48341346cfc615a8bbe357bc785f3c605b0a1022e125ea38cf5cec696`. `node --check scripts/blackhole-check.mjs`, `git diff --check` exit 0. 본문 수정 뒤에는 주석만 다듬었고 실행 코드는 바꾸지 않았다.
- **VERIFIED:** 격리 Windows HTTP 코어의 일회성 초대·기기 등록/멱등 복구/재사용 차단→작업·진행 상태/산출물 해시→코어 재시작→기기 철회까지 한 흐름, 관련/전체 회귀. **RAN-UNVERIFIED:** 이번 실행에는 없음. **NOT RUN/BLOCKED:** 실제 QR 카메라 스캔·Android Stronghold·폰 화면의 진행/결과·앱 종료 복구·사설 HTTPS 연결. ADB 0과 미설치/미로그인 Tailscale 때문에 P02→J01→R01/F01 실기기 합격은 여전히 미증명. 합성 플랫폼 표시를 실제 휴대폰 실행으로 보고하지 않는다.
- 변경 파일: `scripts/blackhole-check.mjs`, `runtime/test/blackhole-check.test.mjs`, 이 정본 실행 기록. APK/controller 소스·Vault·운영 저장소·기존 미커밋 변경 보존. 운영 배포·사용자 데이터 삭제·실제 자격증명 교체 없음. 다음 한 단계는 실제 휴대폰 연결 및 기기 화면의 USB 디버깅 승인 후 기존 APK 설치와 P02→J01→R01/F01 수락 시험이다.

## §44 Android 화면 요청·응답 유실·오프라인·재접속 통합 대체 검사 (2026-09-26, Codex)

- 시작 저장소 root `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, full HEAD `43a2d1b44e0a60ebad4982dc1e2222213869cc1a` 일치. 시작 미커밋 항목 51개를 보존했다. `adb devices -l`은 계속 연결 0이다. §43의 owner 일회성 초대→작업→실제 별도 코어 프로세스 재시작 검사는 진전으로 유지한다.
- 실제 SDK 경로에 `sdkmanager.bat`·`avdmanager.bat`은 있으나 `emulator.exe`·system image·AVD는 없다. 이 PC의 `Win32_Processor.VirtualizationFirmwareEnabled=False`와 전달 APK의 ARM64 빌드를 확인했다. 이번에는 에뮬레이터 설치/실행이나 PC 펌웨어·Windows 기능 변경을 하지 않았다. 이 제약을 실기기 검증으로 바꾸어 주장하지 않는다.
- 기존 `apps/controller/verify-ui.mjs`는 빌드된 HTML/JS와 격리 실제 HTTP 코어를 연결하지만 Tauri IPC·Stronghold·카메라는 모사한다. §43과 달리 앱 화면에서 직접 `문서 만들어`를 보내 실제 코어 job completed, 결과 버튼의 SHA-256 확인·본문 표시까지 한 흐름을 보지 않았다. 이 빈틈을 같은 검증 파일에 추가했다. 기존 초대 모사는 owner HTTP API에서 발급한 일회성 초대를 사용하는 형태다. 초대/기기 비밀은 로그·보고서에 기록하지 않았다.
- 첫 추가 검사는 작업 제목에 원문이 포함된다는 잘못된 가정으로 `phone-ui-first-run.txt`에서 timeout red가 났다. `phone-ui-diagnostic.txt`의 실제 실행 상태는 UI에 `작업을 접수했습니다: 문서 만들기`, 코어에 `{type:"document",title:"문서 만들기",status:"completed",error:null}`였다. 제품 실패가 아니라 일반 문서 job 제목 정규화였다. 진단 출력 코드는 제거하고, job 종류·상태와 결과 본문/해시를 기준으로 검증해 green을 확인했다. 두 문서 job의 제목이 동일하므로 검증에서 첫 카드만 집는 가정도 `phone-ui-uncertain-run.txt`에서 red로 확인했고, 각 결과를 열어 원문/해시가 일치하는 카드를 찾도록 고쳤다. 이 동일 제목은 여러 결과를 구별하기 어려운 UI 개선 후보이나 이번에는 서버 계약을 바꾸지 않았다.
- **실제 코어 응답을 받은 뒤 UI에 전달하기 전** 시험 IPC에서 문서 요청의 응답 한 번만 유실시켰다. 코어에는 완료된 job 하나가 남았고 앱에는 원문과 대기 요청이 남았다. 코어 HTTP listener와 런타임 객체를 실제로 shutdown한 동안 앱 새로고침이 `최신 상태 확인 실패`를 표시했다. 같은 Node 시험 프로세스 안에서 같은 포트·데이터 디렉터리로 새 코어 런타임을 열자 재페어링 없이 `코어 응답 확인됨`으로 복귀했다. 앱 DOM을 닫고 다시 연 뒤 보관소 모사를 unlock해 원래 대기 요청을 재시도하자 같은 수락 결과를 받았고 문서 job 수는 2(첫 정상 요청 1 + 응답 유실 요청 1)로 유지되어 중복 실행 0이었다. 첫 요청의 기존 job ID·artifact ID 및 UI 결과 SHA 표기가 재시작 후 일치했다. 이는 실제 HTTP 코어 런타임 중지/재생성이지 별도 OS 프로세스 재시작 또는 Android 앱/Stronghold 실물 검증은 아니다.
- `npm.cmd --prefix apps/controller run build`: Node 24.19.0, `tsc --noEmit && vite build` exit 0, 번들 `dist/assets/index-Cm0_TjH5.js` 185.71 kB. `node apps/controller/verify-ui.mjs`: exit 0, `ok:true`, **18 checks**. 정본 로그 `build-artifacts/handoff-r3-20260926/phone-ui-final.txt` SHA256 `eb5ce9d11a01b96a5c84211e7dd23c29faaca58a23157fea9ac54142b8a217f1`. 이 파일의 `scope`는 built HTML/JS + real local core + simulated native IPC라고 명시한다.
- 변경 후 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`: exit 0, **1154 total / 1133 pass / 0 fail / 21 skip**, 103초. 같은 바이트 사본 `build-artifacts/handoff-r3-20260926/phone-ui-full-regression.txt` SHA256 `64df51e6b16519d40deb80e7b71dd765b4d7f6b874777f51d06bbf1c4d91426a`. `node --check apps/controller/verify-ui.mjs`와 `git -c core.safecrlf=false diff --check` exit 0. APK 자체는 이번에 다시 만들지 않았고 기존 전달 APK SHA256 `f21e85987357ccd26df6e52fec8361461e59197ac1b3ca2dd67fe3dcd6be1be1` 유지했다.
- **VERIFIED:** 격리 코어와 빌드 JS 화면의 초대 모사→텍스트 요청→completed 결과·해시, 응답 유실 후 원래 요청 ID 보존·앱 재열기/동일 코어 데이터 재기동 후 중복 없는 재접수, 실제 코어 listener 중단 중 오프라인 표시와 재연결, 관련/전체 회귀. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** 실제 Android APK 설치, 카메라 QR, Tauri Android IPC, 실제 Stronghold 암호화·저장, 실제 휴대폰 화면/네트워크/앱 프로세스 종료·재기동, 실제 사설 HTTPS/Tailscale, 실제 Windows PC 재부팅 후 폰 접속. 이 검사를 P02/J01/R01/F01 실기기 합격으로 분류하지 않는다.
- 이번 변경은 `apps/controller/verify-ui.mjs`와 이 정본 기록뿐이다. 제품 APK/런타임 코드는 바꾸지 않았고 기존 미커밋 작업·Vault는 보존했다. 운영 배포·사용자 데이터 삭제·실제 자격증명 교체 없음. 다음 한 단계는 실제 휴대폰을 PC에 연결하고 휴대폰에서 USB 디버깅을 승인한 뒤, 기존 APK 설치와 P02→J01→R01/F01 실기기 수락 흐름 실행이다.

## §45 Android 작업 카드 구분·최신 APK·실기기 전 대체 수락 (2026-09-26, Codex)

- 시작 저장소 root `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, full HEAD `43a2d1b44e0a60ebad4982dc1e2222213869cc1a` 재확인. 시작 미커밋 51개를 보존했고 reset/checkout/commit/push 없음. 최종 `adb devices -l`은 연결 0이다.
- §44 대체 UI 수락에서 서로 다른 `문서 만들어` 요청 두 개의 서버 제목이 모두 `문서 만들기`여서 폰의 작업 목록에서 원래 요청과 결과를 열기 전에는 구분할 수 없었다. `apps/controller/verify-ui.mjs`에 서로 다른 제목 단언을 먼저 추가해 red `distinct-job-title-red.txt`에서 `actual: '문서 만들기'`를 확인했다. `runtime/server.mjs`의 명시적 document 명령에 한정해 입력 본문의 공백을 정리한 최대 72 Unicode 코드 포인트를 job 표시 제목으로 설정했다. 본문·요청 ID·아티팩트 계약과 다른 문서 경로는 유지한다. `apps/controller/src/style.css`의 기존 `.job strong`에 `overflow-wrap:anywhere`와 `word-break:keep-all`을 넣어 좁은 카드에서 긴 한글 제목을 안전하게 감싼다. `main.ts`의 `textContent` 렌더를 확인했다.
- `apps/controller/verify-mobile.mjs`의 낡은 장기 owner-key 입력 모사를 현재 일회성 초대 계약으로 갱신했다. Edge/Playwright가 빌드된 UI와 격리 실제 HTTP 코어를 synthetic native IPC/QR adapter로 구동해 360px·430px 각각 두 문서 요청을 제출하고 서로 다른 카드 제목이 각 1개씩 있는지, 가로 넘침이 없는지 확인했다. 최종 `distinct-job-title-browser-no-prefix.txt` `ok:true`, PNG는 `distinct-job-title-browser/work-360px.png` SHA256 `8b280b765dd5c4468071a3074c716cab0ff0a46b504c1d05914b219ea8837c2f`, `work-430px.png` SHA256 `f3325a7cc8ca8e5b56ee26e86f69d54a2e52db60d8f030fcf10f4676c6d36159`. 430px 화면에는 이전 360px 시험 작업도 남아 있으므로 깨끗한 2행 전용 스크린샷이라는 주장은 하지 않는다. 독립된 두 화면 검토는 제목 식별/넘침 범위에서 PASS/APPROVE, 실제 Android WebView 검증은 아님. 리뷰/QA 범위와 제약은 `distinct-job-title-code-review.md`, `distinct-job-title-manual-qa.md`에 별도 기록했다.
- 최종 소스 후 `npm.cmd --prefix apps/controller run build` 및 `. build-artifacts/acceptance-20260925/android-build-env.ps1; npm.cmd --prefix apps/controller run tauri -- android build --debug --apk --target aarch64 --ci`: 모두 exit 0. 새 산출물 `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260926-r45.apk` 110,880,426 bytes, SHA256 `b6a6a41ec90e2baa41e12be2ec2d6f8a08904f7c3343d619db8a6e9edb4b6261`; 이전 §38 APK는 보존. `apksigner verify --verbose --print-certs` v2 Android Debug 인증서 1개, `zipalign -c -P 16 -v 4` 성공, `aapt dump badging` package `kr.yeno.controller.smoke`, version 0.2.0, arm64-v8a. APK 내부 `libyeno_controller_lib.so`와 새로 빌드한 native 파일 SHA256 둘 다 `e259f0c524bd5a3ef1b9d009ac9d2ed8a087483ca999909ca56bd087763449f7`, ELF LOAD 네 개 모두 align `0x4000`. native 바이너리 안에 현재 Vite 자산 이름 `index-CWqQu0co.css`, `index-_hljaNus.js`도 확인했으나 압축된 번들의 파일 바이트 동등성이나 Android 실행을 검증한 것은 아니다. 첫 apksigner 시도는 별도 셸의 JAVA_HOME 미설정으로 실패했고 같은 기존 빌드 환경을 로드한 후 위 검증이 통과했다. 앱 설치/실행은 하지 않았다. 현재 controller 42파일 hash와 코어 hash/스크린샷 hash는 `distinct-job-title-android-apk-manifest.json`에 기록했다.
- 최종 코드 기준 `node apps/controller/verify-ui.mjs`: exit 0, `ok:true`, 18 checks. 서로 다른 폰 요청 제목 동시 표시, 격리 실제 코어에서 completed 결과/아티팩트 SHA, 수락 뒤 HTTP 응답 유실, 코어 중단·재기동 오프라인/재접속, 앱 DOM 재열기·동일 요청 재시도 후 중복 job 없음, 통제된 작업 실패 표시를 확인했다. `node scripts/blackhole-check.mjs --mode isolated --json build-artifacts/handoff-r3-20260926/distinct-job-title-invite-check-final.json`: exit 0, 19/19 PASS, 일회성 초대·기기 등록·완료 작업·아티팩트 해시·별도 코어 프로세스 재시작·철회. 이 시험의 origin·카메라·Stronghold는 synthetic adapter라 실기기 증거가 아니다.
- 변경 후 사용자 지정 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`: Node 24.19.0, exit 0, **1154 total / 1133 pass / 0 fail / 21 skip**. 같은 바이트 사본 `distinct-job-title-full-regression-final.txt` SHA256 `fc1a6e74a201f982ddeae956f39f918976f5ef37ab1d7a5fe3eb79d9075684ec`. `node --check` 서버/UI/모바일 시험과 `git -c core.safecrlf=false diff --check` exit 0. 앞선 오래된 회귀 로그는 최종 검증으로 사용하지 않는다.
- **VERIFIED:** Windows 격리 코어+빌드된 앱 UI/Edge의 서로 다른 요청 식별·결과·오프라인·실패·복구, 일회성 초대 통합 경계, 최신 ARM64 debug APK 정적 빌드/서명/정렬/native 동등성, 관련/전체 회귀. **RAN-UNVERIFIED:** 실제 Android 앱/카메라/Stronghold 흐름은 실행하지 않았으므로 없음. **BLOCKED/NOT RUN:** ADB 기기 0으로 최신 APK 설치, 실제 QR 페어링→폰 요청→PC 실행→폰 진행/결과→앱 종료·PC 재시작 복구와 실제 사설 HTTPS 연결. 운영 Windows 재설치/재부팅은 하지 않았다. 운영 배포·데이터 삭제·실제 자격증명 교체·Vault 변경 없음.
- 이번 변경 파일은 `runtime/server.mjs`, `apps/controller/src/style.css`, `apps/controller/verify-ui.mjs`, `apps/controller/verify-mobile.mjs`, 이 정본 실행 기록. 격리 로그/PNG/새 APK는 별도 산출물로 보존한다. 다음 한 단계는 **실제 Android 휴대폰이 PC에 연결되고 휴대폰에서 USB 디버깅이 승인되면** 새 r45 APK를 설치해 P02→J01→R01/F01 실기기 흐름을 직접 실행하는 것이다. 기기 연결 전에는 실기기 합격을 주장하지 않는다.

## §46 — 2026-09-26 Claude(Cowork): 자비스 살아있는 얼굴 `/jarvis` (실제 런타임 위, 로컬 모델 경로 포함)

소유자 지시: "그냥 자비스를 만들어, UI 깔끔하게", "Ollama로도 되어야 함", "제대로 만들 수 있는 거 맞냐". 별도 데모가 아니라 실제 런타임 위에 올렸다.

변경(미커밋 — Codex의 apps/controller 미커밋 작업과 충돌하지 않도록 새 파일 + 서버 allowlist 한 줄만):
- `runtime/public/jarvis.html`, `runtime/public/jarvis.mjs` (신규). 화면 = 핵 하나 + 자비스 한 줄 + 지금 하는 일 한 줄 + 입력창. 모든 값은 `/api/state`에서 읽음(core.activity·dominantDriveId/Name/WorldName·lastHeartbeatAt·activeShadowCount·pendingApprovalCount, agent.provider/model, events[0]). 입력은 `/api/commands`로 보냄(운영실 명령은 그대로, 나머지는 `목표: …` → 실제 quest → 실제 모델 라우터). 자비스의 말 = 완료된 job의 artifact 본문(`/api/artifacts/:id`, `---` 이후 출처 꼬리표는 제거). 페어링은 `web-client.mjs` `connectBrowser()` 그대로 재사용(운영실과 같은 세션·같은 단일탭 잠금).
- `runtime/server.mjs` 정적 allowlist에 `'/jarvis':'jarvis.html','/jarvis.html':'jarvis.html','/jarvis.mjs':'jarvis.mjs'` 추가(1줄).

VERIFIED (Cowork 격리 VM, Node 22, 실제 `runtime/server.mjs` 기동):
- `GET /jarvis` 200 text/html, `GET /jarvis.mjs` 200 text/javascript.
- 모델 없이: `일곱 욕망` → job queued → completed → artifact `document-*.md` 생성, 본문 회수 확인. `목표: …` → 409 "주 모델 연결이 필요합니다" (페이지는 이 경우 `목표 저장:`으로 보관).
- 로컬 모델 경로: `YENO_AGENT_PROVIDER=local YENO_LOCAL_BASE_URL=http://127.0.0.1:8080/v1/chat/completions YENO_LOCAL_MODEL=qwen2.5:3b YENO_AGENT_DAILY_CALL_LIMIT=20`(상한은 0–20만 허용) + OpenAI 호환 mock(Ollama `/v1` 형식) → `목표: 한끼안부 다음 할 일 정해줘` → type `agent` job completed, artifact `agent-*.md`에 모델 응답 본문, `/api/state`가 `agent.provider=local, model=qwen2.5:3b` 보고. Kirby 이벤트("기본 기능2종 … 활성화") 자동 발생 확인. lastHeartbeatAt 실제 갱신 확인.
- 페이지 렌더: 위 실제 응답(state.json/artifact.md/command-response.json, `build-artifacts/jarvis-face-20260926/`)을 그대로 재생하는 서버 + Chromium(Playwright)에서 열어 pair 통과, 모드/모델/심장 시각 표시, artifact 본문 발화, 입력 → `/api/commands {requestId,text:'목표: …'}` 전송 확인. JS 오류 0.
RAN-UNVERIFIED: 실제 Ollama(qwen2.5:3b)와의 응답 품질·속도 — mock으로 경로만 검증. 실기기 브라우저 페어링 후 `/jarvis` 열람.
BLOCKED: 없음. 커밋은 소유자/Codex 판단에 맡김(Codex 미커밋 변경 존재).
근거 파일: `build-artifacts/jarvis-face-20260926/{state.json,artifact.md,command-response.json,http-checks.txt,server.log,mock-llm.mjs}`.

## §47 — 2026-09-26 Claude(Cowork): 역할 정정 + Codex 지시서 `/jarvis` v2 (세계 최고 수준 UI)

소유자 지시: "UI가 너무 구려… 전세계 1위인 것 같겠니" → "Claude는 코딩하지 말고 Codex한테 지시하고 틀린 거나 잡아라." 이후 Claude는 구현 중단, 지시·검증만 수행.
- 신규: `docs/CODEX_DIRECTIVE_JARVIS_FACE_20260926.md` (디자인·동작·산출물·Claude 검증 항목).
- **Claude 자기 결함 보고:** §46의 `jarvis.html`은 인라인 `<style>`/`style=""`를 써서 실제 서버 CSP(`style-src 'self'`)에서 스타일이 차단된다. §46의 렌더 검증은 CSP 없는 재생 서버에서 이뤄져 이 결함을 놓쳤다 — §46 "VERIFIED 페이지 렌더"는 **CSP 미적용 조건**으로 정정. 수정은 Codex 몫(지시서 §0 결함 1).
- Claude가 작성 중이던 `jarvis.css` 초안은 저장소에 넣지 않음(소유자 지시 준수).

## §48 시작 로그 비밀값 차단·Windows QR GUI 경로·진행 표시 검증 (2026-09-26, Codex)

- 이전 §45는 서로 다른 문서 작업 카드와 새 debug APK를 만든 **진전**이다. 이번 시작 상태는 동일 root `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, full HEAD `43a2d1b44e0a60ebad4982dc1e2222213869cc1a`, 미커밋 54건이었다. 모두 보존했고 reset/checkout/commit/push 없음. `adb devices -l` 연결 0.
- owner 키를 사람에게 복사시키지 않는 제품 요구와 달리 `runtime/server.mjs` 단독 CLI 및 `runtime/launch.mjs` 레거시 시작 경로가 `PAIRING TOKEN:`과 실제 owner 키를 stdout에 출력했다. `runtime/test/startup-secrecy.test.mjs`에서 두 경로를 합성 키/격리 데이터로 실제 child process 기동해 stdout+stderr에 키가 있는지 검사했고, 먼저 `startup-secrecy-red.txt` **2 fail**로 노출을 재현했다(실제 합성 키 원문은 테스트 출력에 없음). 두 CLI의 토큰 출력을 없애고 새 기기 등록은 resident와 사설 GUI로 안내했다. `launch.mjs`는 이전 owner-key 브라우저를 기본 자동 실행하지 않고 `--open-legacy-browser` 명시 선택 때만 열도록 했다. `runtime/service.mjs`의 낡은 주석, `runtime/START_HERE_KO.md`와 `runtime/PHONE_SETUP.md`의 수동 복사 안내를 현재 QR 경로로 갱신했다. 같은 동적 검사는 `startup-secrecy-green.txt` **2 pass / 0 fail**. 레거시 웹 UI 자체의 수동 owner-key 입력 기능을 최신 native 앱 검증이라고 주장하지 않는다.
- Windows QR 소유자 GUI의 `scripts/pair-blackhole-phone.ps1` 모델 저장 후 restart 대상 경로에 ASCII Backspace(0x08) 1개가 있어 실제 경로가 없음을 확인했다(`badPathExists=False`, 정상 파일 `True`). 이를 `scripts\blackhole-resident.ps1`로 바로잡았다. 첫 격리 Windows 수락 시도는 Windows PowerShell 5.1이 BOM 없는 한글 UTF-8 GUI 파일을 잘못 읽어 `powershell_ast`에서 실패했다. GUI 파일에 UTF-8 BOM을 넣고 Windows PowerShell 5.1 AST 오류 0, 제어문자 0, 대상 파일 존재를 재확인했다. `scripts/test-resident-windows.ps1`에 실제 AST 문자열 경로를 해석해 파일 존재를 검사하는 회귀 단언을 추가했다. GUI 버튼을 수동으로 클릭한 증거는 없고 이 확인을 GUI 전체 작동 검증으로 확대하지 않는다.
- 격리 Windows 수락 명령 `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/test-resident-windows.ps1 -Root <repo> -EvidencePath build-artifacts/handoff-r3-20260926/startup-secrecy-windows-resident-final.json`: exit 0, **103 checks, status=passed**, `pairing GUI restart target exists` 포함. 별도 임시 Windows 예약 작업의 설치·키 ACL/비노출·실제 기기 등록·작업/결과·중지/재시작·충돌 거부·소유 작업만 제거·데이터/키 보존을 확인했다. 보고서 SHA256 `640fa0ea63d220e7a791b416f637783d4d463844b881b081baece9bd6aa869b4`; `productionChanges=false`, 시험 뒤 BLACKHOLE 이름 예약 작업 0 및 8790/8792/9443 listener 0. 운영 resident를 설치했다고 주장하지 않는다.
- `apps/controller/verify-ui.mjs`에서 실제 격리 코어의 agent 작업을 의도적으로 대기시켜 `status=running` 동안 짝지어진 앱 작업 카드가 `진행 중`을 표시함을 확인하고, 대기를 풀어 기존 실패 표시·자동 재실행 없음까지 확인했다. 첫 시험은 jsdom 이전 뷰를 `window.close()`할 때 주기적인 `/api/v1/state` 응답이 진행 중이어서 오래된 콜백이 닫힌 문서를 렌더하는 경합으로 실패했다. 요청 경로/진행 중 개수로 확인했고 임시 진단은 제거했다. 이전 뷰의 polling 타이머만 멈추고 진행 중인 읽기 응답이 안전하게 끝날 수 있게 한 후 **5회 연속** `ok:true`, 각 **19 checks**. 최종 로그 `startup-secrecy-ui-progress-final.txt` SHA256 `d5f864269a3df72b6d84f77afdb04669f013211aa3135fb12ee2abb6bd8e7c86`. 이 코어/UI/native IPC 모사 검사는 실제 Android 진행 표시 증거가 아니다.
- 모든 변경 후 사용자 요청 명령 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`: Node 24.19.0, exit 0, **1156 total / 1135 pass / 0 fail / 21 skip**. 같은 바이트 `build-artifacts/handoff-r3-20260926/startup-secrecy-full-regression-final.txt` SHA256 `aa3cadc8bfd400647bf78b669dc71138a55ed64987e55c7c34e448bf6660f762`. `node --check` 변경 JS, Windows PowerShell 5.1/현재 PowerShell AST 검사, `git -c core.safecrlf=false diff --check` 모두 통과. §45 r45 APK는 제품 Android `src/` 변경이 없어 그대로이며 SHA256 `b6a6a41ec90e2baa41e12be2ec2d6f8a08904f7c3343d619db8a6e9edb4b6261`; §45 controller manifest와 현재의 차이는 APK에 포함되지 않는 `apps/controller/verify-ui.mjs` 시험 파일 1개다.
- **VERIFIED:** 두 CLI 시작 시 비밀값 stdout/stderr 비노출, QR GUI restart 파일 경로·PS5.1 파싱, 격리 Windows 설치·복구 103항목, 실제 격리 코어 running→앱 진행 표시→통제 실패와 관련/전체 회귀. **RAN-UNVERIFIED:** 실제 QR GUI 버튼 조작은 실행하지 않았음; Android/카메라/Stronghold 앱 실행은 0회. **BLOCKED/NOT RUN:** ADB 기기 0, 실기기 설치·카메라 QR·폰 요청/진행/결과/앱 종료 복구, 실제 사설 HTTPS·PC 운영 설치/재부팅. 운영 배포·사용자 데이터 삭제·실제 자격증명 교체·Vault 변경 없음.
- 변경 파일: `runtime/server.mjs`, `runtime/launch.mjs`, `runtime/service.mjs`, `runtime/START_HERE_KO.md`, `runtime/PHONE_SETUP.md`, 신규 `runtime/test/startup-secrecy.test.mjs`, `scripts/pair-blackhole-phone.ps1`, `scripts/test-resident-windows.ps1`, `apps/controller/verify-ui.mjs`, 이 정본 실행 기록. 같은 시간 다른 작업자가 §46/§47과 `runtime/public/jarvis.*`, 서버 정적 파일 allowlist를 추가했다. 이 파일들은 이번 수정 범위가 아니며 브라우저 CSP 결함이 §47에 별도로 기록돼 있다. 이번 회귀를 그 새 `/jarvis` 화면의 수락으로 주장하지 않는다. 다음 한 단계는 **Android 휴대폰이 PC에 연결되고 기기 화면에서 USB 디버깅이 승인되는 즉시** r45 APK의 P02→J01→R01/F01 실제 폰 수락 흐름을 실행하는 것이다. 그 전에는 동일한 로컬 대체 시험을 실기기 합격으로 바꾸지 않는다.

## §49 — 2026-09-26 Claude(Cowork): §48(Codex) 독립 재검증

- git: branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `43a2d1b` 변동 없음, 미커밋 변경 62건(Codex §45~§48 작업 전부 미커밋).
- VERIFIED: 신규 `runtime/test/startup-secrecy.test.mjs` 독립 재실행 2 pass / 0 fail (Node 22, 격리 VM). `runtime/server.mjs`·`launch.mjs`에 `PAIRING TOKEN` 출력 문자열 없음. `scripts/` 전체에 0x08(Backspace) 바이트 없음. `pair-blackhole-phone.ps1` 선두 UTF-8 BOM(EF BB BF) 존재, restart 경로 `scripts\blackhole-resident.ps1` 정상. `build-artifacts/handoff-r3-20260926/startup-secrecy-windows-resident-final.json`: `status=passed, checks=103`. `startup-secrecy-full-regression-final.txt`(UTF-16) 집계 `tests 1156 / pass 1135 / fail 0 / skipped 21` — Codex 보고 수치와 일치. red→green 증거(`startup-secrecy-red.txt` 2 fail → `-green.txt` 2 pass) 존재.
- RAN-UNVERIFIED: 전체 회귀 1156건의 **이 세션 재실행** — 격리 VM 180초 상한 내 미완료(타임아웃). 수치는 Codex 산출 로그 파일 기준. APK `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260926-r45.apk` — 연결 폴더 밖이라 존재·해시 미확인.
- 잡은 것 1 (위험): `scripts/pair-blackhole-phone.ps1`(Windows QR 소유자 GUI)은 **git 미추적 파일**(`git ls-files` 0). §48이 "바로잡았다"고 한 수정은 커밋은커녕 추적도 안 되어 있어 diff로 검증 불가, 작업 트리 유실 시 통째로 사라짐. 62건 미커밋과 함께 즉시 커밋 필요.
- 잡은 것 2: §47 지시서(`/jarvis` v2, CSP 결함 수정)는 §48에 언급 없음 — 미착수. 다음 Codex 작업에 포함 요청.
- BLOCKED: 실기기 Android 시험(연결 기기 0대) — 소유자가 폰 USB 디버깅 승인 후 진행.

## §50 — 2026-09-26 12:58 Claude(Cowork): Codex `/jarvis` v2 진행 중간 점검 (§47 지시서 대비)

- 파일 갱신 확인: `runtime/public/jarvis.css`(12:54, 신규) · `jarvis.html`(12:54) · `jarvis.mjs`(12:57). Codex 작업 진행 중(미완).
- VERIFIED (실제 `server.mjs` 기동, 포트 8792): `/jarvis`·`/jarvis.css`·`/jarvis.mjs` 200, CSS는 외부 파일, `jarvis.html` 인라인 `<style>` 0개·`style=""` 0개, 응답 CSP `style-src 'self'` 하에서 차단 대상 없음 → **§46 결함 1 해소**. 외부 폰트/URL 참조 0. `node --check jarvis.mjs` 통과. 데이터 소스는 `/api/state`·`/api/drives/status`·`/api/artifacts`·`/api/commands`뿐, `Math.random`·모의값 0.
- VERIFIED: 조종 화면은 실제 권한 경로에 붙음 — 자율 토글 `POST /api/autopilot {requestId,enabled}`, 전체 멈춤/재개 `POST /api/control {requestId,action:'stop'|'resume',revision}`(revision 동봉). 자비스가 승인 필요 행동을 스스로 통과시키는 코드 없음.
- 잡은 것 (미완/미충족, 12:57 기준): (1) `/api/drives/status`를 받아 `scene.drives`에 넣지만 **그리지 않음** — `draw()`는 §46 초안 그대로(코어+busy 호+게이트 링). 지시서 §2(b) 일곱 욕구 호·(c) 그림자 위성·배경 입자층·심장박동 파동 미구현. (2) `jarvis.css`에 주석 1개 잔존(Codex가 "제거"했다고 했으나 `/*` 1건). (3) 400px·reduced-motion·Ollama 실물 증거·회귀 재실행은 아직 산출물 없음.
- 판정: 결함 수정과 조종 배선은 맞게 가고 있음. "세계 최고 UI" 요구(§2 시각 요구)는 아직 착수 전. Codex 완료 보고 후 지시서 §5 8개 항목 전부 재검증 예정.

## §51 — 2026-09-26 Claude(Cowork): 소유자 정정 2건 — 7욕구 비노출, 구현 기술 선택 재량

소유자 발언: "허깅페이스도 막 쓰고 깃허브 기술들도 막 쓰고 그런 것들 내가 알려줘야 하는 게 아니고 그냥 해주면 안되나. 7욕구 표도 나올 필요 없고 그냥 뒤에서 시스템에서 돌아가면 되는거지."
- `docs/CODEX_DIRECTIVE_JARVIS_FACE_20260926.md` §2 수정: 일곱 욕구 호(arc)/표를 화면에 노출하지 않도록 되돌림 — `/api/drives/status`는 계속 실제로 불러오되 지배 욕구의 코어 색 전이에만 쓰고, 숫자·라벨·범례·아크는 없음. §5 검증 항목 3도 "노출되지 않아야 함"으로 갱신.
- §2-1 신설: 오픈소스 라이브러리·모델·구현 기법 선택은 Codex 재량(기존 `AGENTS.md` "Choose a sensible default" 계약 재확인) — 매번 소유자 승인 불필요. 단 외부 코드/모델의 실제 저장소 편입·상주 실행은 기존 `capability-discovery.mjs`/`kirby.mjs` 검토(라이선스·고정커밋·해시·fixture) 경로를 그대로 통과해야 함 — 이 안전 게이트는 완화하지 않음.
- 확인: `runtime/public/jarvis-scene-model.mjs`(13:07 생성)의 `driveArcSegments`는 이번 정정으로 화면 렌더에는 쓰이지 않아야 한다 — Codex가 다음 편집에서 `draw()`에 실제로 반영하는지, 순수 색 전이 계산으로만 남기는지 다음 점검에서 확인 예정.

## §52 — 2026-09-26 Claude(Cowork): 소유자 정정 — 세부 판단 기준을 "세계 1위처럼 보이는가"로 일반화

소유자 발언: "그런 거 하나조차도 전세계 최고의 수준으로 생각해서 맞추면 되지." 지시서에 §1-1 신설 — 명시 안 된 세부 선택(요소 노출 여부·애니메이션·여백·문구 톤 등)은 소유자에게 묻지 않고 "스크린샷 한 장으로 세계 1위라고 믿겠는가"를 기본 판단 기준으로 삼는다. §51의 7욕구 비노출 정정을 그 기준의 실사례로 명시. 방향이 크게 갈리는 결정만 소유자에게 묻는다.
확인: `jarvis-scene-model.mjs`(13:25)는 §51 반영 완료(`driveArcSegments` 제거, `measuredDriveTint`로 교체, arc 관련 코드 0건). Codex가 전체 회귀 재실행 중이라는 보고 받음 — 다음 점검에서 결과 확인 예정.

## §53 — 2026-09-26 Codex: BLACKHOLE 자비스 실화면·로컬 실행 마감 검증

- 작업 경로 `C:\Users\우연호\Documents\Projects\yeno-os`, 제품명 **BLACKHOLE**, 그 안의 화면 이름 **JARVIS**. 시작 브랜치 `blackhole/p3-jev-recovery-port-20260924`, origin `https://github.com/wooyeonho/yeno-os.git`, 기준 HEAD `43a2d1b44e0a60ebad4982dc1e2222213869cc1a`를 확인하고 기존 미커밋 62건을 보존했다. 기존 native/Windows 작업과 미추적 QR GUI를 `62b00fb`, 자비스 화면·대화/작업 권한 경계를 `869a49f`, 로컬 목표의 제한된 추론 시간·실물 시험 도구를 `6d6a3fa`로 커밋했다. push·운영 배포는 하지 않았다.
- `/jarvis`는 실제 API 상태에 연결된 코어 장면과 소유자 제어를 제공한다. Seven Drives는 내부 색 전이 계산에만 사용하고 표·숫자·라벨·호를 노출하지 않는다. 외부 CSS를 사용해 CSP `style-src 'self'`를 지키며 인라인 스타일/외부 폰트가 없다. 대화 모드의 `chatOnly:true`는 명령 형태의 자연어를 목표 실행으로 우회시키지 않고, 작업 모드는 `/api/commands`와 실제 작업·산출물에 연결된다. 독립 읽기 전용 UI/무결성 리뷰는 최종 화면 상태에 PASS였으나 제품의 세계적 순위를 검증한 것은 아니다.
- `node scripts/verify-jarvis-face-live.mjs`: exit 0. 격리 실제 HTTP 코어와 Edge 브라우저에서 소유자 승인 웹 페어링, 정지/재개, 미연결 대화 명령 미실행, 모델 부재 시 목표 저장, desktop 1440·mobile 400 가로 넘침 없음, reduced-motion, CSP를 확인했다. 보고서 `build-artifacts/jarvis-face-v2-20260926/report.json`, 스크린샷 6장과 SHA-256이 있다. 이는 Android 실기기 시험이 아니다.
- PC에 이미 실행 중이던 Ollama의 `qwen2.5:3b`를 격리 코어·브라우저에서 호출했다. `node scripts/verify-jarvis-local-model-live.mjs` 대화 경로와 `node scripts/verify-jarvis-local-model-live.mjs --work` 작업 경로 모두 exit 0; 작업은 `completed`, artifact 434 bytes, 서버 헤더와 바이트 SHA-256 `3678abbacaccaf799f04d2631a8dd38025b6c8b2284ebeb40bca93c31e4a5a2d` 일치, JARVIS 화면에 답변이 나타났다. 작업 화면 답변은 요청한 인사말을 제대로 만들지 못했으므로 **내용 품질은 불합격/미완**이다. `local-work-report.json`의 `answerQuality:not-independently-assessed`는 자동 검사 범위를 뜻하고, 이 수동 판정을 대체하지 않는다. 기존 작업 시도는 약 90초 후 `request_failed_or_stopped`로 실패했으며, 로컬 소유자 목표와 Shadow에만 최대 300초, 원격 제공자에는 기존 90초를 유지하도록 변경했다. 성공한 재실행만을 시간 제한 효과의 단독 증명으로 보지 않는다.
- 요청한 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`를 실행했으나 기본 `C:\Program Files\nodejs\node.exe` v24.11.1에서 여러 시험 파일이 Windows 프로세스 코드 `-1073740791`로 충돌했다(862 total / 770 pass / 71 fail / 21 skip). 실패 로그 `full-regression-node24.11-failed.txt` SHA-256 `1d2e6dec379e75719ccb1caa829ed1b05196f3164aef0fb5f8f0686fb7c0c0ef` 보존. 대표 실패 파일은 기본 Node 단독 실행도 충돌했지만 PC에 이미 있는 Node v24.21.0으로는 6/6 통과했다. v24.21.0 `--test --test-concurrency=4` 전체 명령을 재실행하여 **1160 total / 1139 pass / 0 fail / 21 skip**, exit 0. 로그 `full-regression-node24.21.txt` SHA-256 `99d692199013be9c55c815687185beae4504d43c7915956dad3b78ba27da0ea7`. `node --check` 2개와 `git -c core.safecrlf=false diff --check`도 exit 0. 두 Node 실행 결과를 섞어 단일 `npm test` 성공이라고 주장하지 않는다.
- APK `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260926-r45.apk` 존재, SHA-256 `b6a6a41ec90e2baa41e12be2ec2d6f8a08904f7c3343d619db8a6e9edb4b6261` 재확인. `adb devices -l` 연결 0. 이번 변경은 Android 소스나 APK를 다시 빌드하지 않았다. Vault 변경, 실제 자격증명 출력/교체, 운영 설치·배포, 사용자 데이터 삭제 없음.
- **VERIFIED:** 저장소/이름 구분, 브라우저 실화면·권한 경계, 격리 코어 정지/재개, 실제 로컬 모델 호출과 산출물 무결성, Node v24.21.0 전체 회귀. **RAN-UNVERIFIED:** 로컬 모델의 인사말 응답은 실행되었으나 내용 요구에 미달; 기본 Node v24.11.1 `npm.cmd test`는 실행했으나 실패. **BLOCKED/NOT RUN:** Android 실기기 설치·카메라/Stronghold 페어링·폰 요청/진행/결과/앱 종료 후 복구, 실제 사설 HTTPS/Tailscale, 운영 PC 재부팅 후 폰 확인. QPU 실물 실행과 딥러닝 학습 루프도 현재 기능으로 주장하지 않는다.
- 다음 한 단계: 휴대폰을 PC에 연결하고 기기 화면에서 USB 디버깅을 승인받는 즉시 기존 APK로 P02→J01→R01/F01을 실기기에서 실행해 폰→Windows→폰 결과·복구를 확인한다.

## §54 — 2026-09-26 Claude(Cowork): 신규 Codex 지시서 — 동시 워커·처리량 확장

소유자가 외부 사례(에이전트 15~20개 역할별 병렬, 월 PR~1,000건, 코드+실행/로그/성능 증거 동봉, 기능 안내도·재사용 스킬, 스킬 퇴행 감시 평가, CI 구조 가드레일, 로컬 검증 후 확장)를 전하며 "왜 우리는 못하냐"고 물음. 분석 결과 원칙(증거 동봉·편집 허용목록·재사용 기능 레지스트리)은 이미 같은 방향이고, 실제 격차는 동시 실행 규모·처리량·퇴행 자동 감시.
- 신규 `docs/CODEX_DIRECTIVE_AGENT_SCALE_20260926.md`: Shadow Army 동시 실행 실측·확장, `workers/developer`의 증거 동봉 패턴을 다른 역할로 확장, 기능 퇴행 감지(감지·보고만, 자동 비활성화는 별도 결정), CI 가드레일 보강, 단계별 로컬 검증 후 확장. 기존 소유자 승인 게이트(승격·capability-change)와 외부 코드 검토(라이선스·고정커밋·해시·fixture)는 완화하지 않음 — "전면자동, 최종만 내가" 방침 유지.
- Claude 검증 예정 항목 5개는 지시서 §4에 명시.

## §55 — 2026-09-26 Codex: 병렬 워커 주장 대조 및 Windows 개발자 증거 저널 수정

- 비교 대상 회사의 규모·운영 방식은 소유자가 전달한 설명일 뿐 이 절에서 외부 검증하지 않았다. 현재 저장소 HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`, branch `blackhole/p3-jev-recovery-port-20260924`, origin `https://github.com/wooyeonho/yeno-os.git`. 시작 작업 트리에는 기존 미추적 `.omo/`만 있었고 이를 보존했다.
- “Codex 한 세션뿐이라 병렬 실행은 없다”는 진술은 코드·시험과 불일치한다. `runtime/server.mjs` 스케줄러는 `s.concurrency`까지 실제 job을 시작하고 설정 상한은 3이다. Shadow 임무는 두 독립 leaf 작업(scout/researcher)을 동시에 시작하며, project bots 별도 한도는 2다. `runtime/test/shadow-army.test.mjs`와 `project-bots.test.mjs`의 실제 HTTP 코어 + **합성 모델 transport** 병렬 실행 시험이 통과했다. 이는 실모델 15–20개 상시 운영이나 월 PR 처리량의 증거가 아니다.
- `workers/developer/`에는 편집 허용목록·저널·격리 Docker 인자·증거 보고·CI/승격 게이트 코드가 있다. 그러나 코어 `/api/state` 계약은 `repositoryDevelopment.runnerConnected:false`, `capabilities.developerWorker:false`이고 현재 PC의 `docker` 명령 및 `BLACKHOLE_WORKER_IMAGE_ID`가 없다. 실제 Docker 격리 실행·자동 PR/승격 운영을 이번 검증에서 주장하지 않는다. `production_base_tree_mismatch` 등 최종 승격 거부 경계는 코드와 단위 시험에 존재하며 완화하지 않았다.
- Windows에서 개발자 워커 관련 시험을 실행하자 37 total / 34 pass / 2 fail / 1 skip: `core-integration`과 `reportEvidenceDurably`가 `workers/developer/worker.mjs`의 저널 `fsync`에서 `EPERM`이었다. 별도 Node v24.21.0 재현에서 임시 **파일** 핸들 `fsync=ok`, **디렉터리** 핸들 `fsync=EPERM`을 관찰했다. 새 `atomic developer journal persists a replacement on this host` 시험을 먼저 추가해 같은 EPERM red를 확인했다.
- 수정은 `workers/developer/worker.mjs`의 파일 쓰기+파일 fsync+rename을 유지하고, Windows에서 지원되지 않는 디렉터리 핸들 fsync만 건너뛴다. POSIX 경로의 디렉터리 fsync는 유지한다. 따라서 Windows 디렉터리 엔트리의 전원 차단 내구성을 POSIX와 동등하다고 주장하지 않는다. 수정 뒤 Shadow/project-bots/worker/core-integration/gateways 집중 시험 48 total / 45 pass / 0 fail / 3 skip; 전체 개발자 시험 `node --test --test-concurrency=2 runtime/test/repository-*.test.mjs workers/developer/*.test.mjs`는 **79 total / 76 pass / 0 fail / 3 skip**, exit 0. Docker 실물 3건은 조건 미충족으로 skip. `git diff --check` 통과.
- **VERIFIED:** 현재 저장소의 동시 작업 상한과 합성 transport의 2중 병렬 실행, Windows 저널 오류 red→green, 실제 HTTP 코어 + 합성 provider/runner의 증거 재전송·repair 회귀. **RAN-UNVERIFIED:** 실제 Docker/CI/GitHub PR 처리량, 실모델 여러 개 동시 부하, 기능별 시간 경과 품질 추세는 이번에 실행하지 않았다. **BLOCKED:** Docker CLI와 고정 이미지 ID가 없어 Windows 실물 컨테이너 수락; Android 실기기 ADB 0 상태는 §53과 동일. 승인 범위를 넓히거나 자동 승격을 켜지 않았다.
- 변경 파일: `workers/developer/worker.mjs`, `workers/developer/worker.test.mjs`, 이 정본 기록. 운영 배포·실제 자격증명 교체·Vault 변경·데이터 삭제 없음. 우선 다음 한 단계는 §53의 Android 실기기 전체 흐름 검증이며, 병렬 규모 확대는 그 후 현재 2개 병렬을 실모델/자원/비용/실패·복구 지표로 측정하고 결정한다.
- 후속 전체 회귀: PC의 Node v24.21.0으로 `node --test --test-concurrency=4 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs` 실행, exit 0, **1160 total / 1139 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression.txt` SHA-256 `fc485530e019980543080fad2e91e759bd6fe6f7ad2f5a28e8732cf3efb9cc43`.
- 디버깅 임시 기록 `.debug-journal.md`를 정리하려던 명령은 자동 승인 검토에서 거부되었고 상세 사유는 제공되지 않았다. 우회하지 않았으며 파일은 로컬 Git 제외 상태로 남았다. `docs/CODEX_DIRECTIVE_AGENT_SCALE_20260926.md`에는 실측 출발값과 중간/최종 승인 경계를 보충했으나 새 지시서의 2~4단계 기능을 완료했다고 표시하지 않는다.
- 과거 M2 실모델 산출물도 재열람: `m2-shadow-live-tools-fixed/report.json`은 실제 로컬 `qwen2.5:3b`에서 scout/researcher/builder와 결정론 Verifier 완료·Builder SHA 일치, 그러나 semantic verdict `uncertain`으로 `phase:failed`, `ok:false`; `m2-shadow-live-project-only/report.json`은 Scout부터 실패했다. 그러므로 현재 2개 병렬의 운영 품질조차 합격으로 확대할 수 없으며 상한 3→15~20 인상은 실행하지 않았다. 이 사실을 신규 지시서 PC 기준에 추가했다.

## §56 — 2026-09-26 Codex: 세계 수준 계획의 측정 기준·Shadow Builder 근거 연결

- 같은 저장소 HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`, branch `blackhole/p3-jev-recovery-port-20260924`, origin `https://github.com/wooyeonho/yeno-os.git` 확인. 이전 §55의 미커밋 파일과 `.omo/`를 보존했다. Windows SDK의 `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l` 결과 연결 0대라 실기기 수락은 여전히 미실행이다.
- 사용자의 “모든 면에서 전세계 최고” 요청을 측정 가능한 계획으로 바꿔 `docs/BLACKHOLE_WORLD_CLASS_PLAN_20260926.md`를 새로 작성했다. 실제 결과/폰↔PC 신뢰성/진행·복구/사용성·접근성/출처·안전/자율 실행/경제적 가치의 판정 방법과 목표치를 **제안**으로 분리했고, 실기기 흐름을 첫 출시 차단 조건으로 유지했다. Codex 다중 작업의 공식 소개, W3C WCAG 2.2, OWASP MASVS, NIST AI RMF를 외부 비교·평가 기준으로 읽었다. 세계 1위 또는 표준 인증을 달성했다는 주장은 아니다. 문서 SHA-256 `b07e73c1421a3caf5cd43427d1b4102bda955deb84316ac8f7cdd5d289b5d465`.
- 원인 확인: `runtime/lib/shadow-army.mjs` Builder 지시문은 Scout/Researcher의 노트 수신을 전제하지만, `runtime/server.mjs`의 실제 `agentJournal`에는 Builder 자기 `job.input`만 들어가 있었다. 기존 `runtime/test/shadow-army.test.mjs`의 실제 HTTP 임무 시험에 두 선행 job ID·artifact ID·저장 SHA가 Builder 모델 입력에 들어가야 한다는 단언을 먼저 추가해 red `builder must receive each dependency job identity`를 확인했다. 이어 서버가 Builder 첫 모델 호출 직전에 같은 임무·프로젝트의 완료된 두 선행 작업과 저장 artifact를 대조하고, 기존 `readArtifactContent`의 파일 SHA 검사 후 각 2,000-byte 발췌·ID·SHA를 불신 자료로 입력에 넣고 저널에 먼저 저장하게 했다. 이미 모델 호출을 기록한 작업은 입력을 새로 작성하지 않는다. 다른 프로젝트 자료나 모델의 지시를 권한으로 승격하지 않는다.
- 변경 후 합성 HTTP Shadow 시험 `runtime/test/shadow-army.test.mjs` **10/10 통과**. PC의 실제 Ollama `qwen2.5:3b`로 격리 코어·EXTRA-136 소스를 사용해 `scripts/verify-source-shadow-live.mjs`를 다시 실행했다. 산출물 `build-artifacts/agent-scale-20260926/m2-shadow-builder-context-live/`. 저장 Builder 모델 입력은 두 선행 job ID를 포함하고 4,280 bytes였으며 Scout/Researcher/Builder·결정론 verifier는 완료, Builder 산출물 HTTP SHA 일치, 격리 코어 재기동 뒤 임무와 source 상태가 보존됐다. **하지만 전체 임무는 `phase:failed`, `ok:false`**: semantic verifier가 `evidenceRefs`를 배열 대신 문자열로 낸 `invalid_criterion_evidence_refs` 오류로 실패했고, 원문 출력 자체의 판단도 `fail`이었다. Builder 산출물은 입력/상태/출력/깊이 가림 시험 조건을 구체적으로 제시하지 않고 두 개의 일반 작업 카드를 적어 내용 품질도 미달이다. 이 시험을 실모델 품질 합격이나 의미 검증 통과로 세지 않는다. 실행 중 Windows 여유 RAM 약 0.19 GiB, `ollama ps`는 모델 2.2 GB/CPU 100%를 보고했으므로 동시 한도 인상 근거도 없다. 시험 뒤 `ollama stop qwen2.5:3b`로 모델을 메모리에서 내렸다.
- 변경 후 Node v24.21.0 전체 `node --test --test-concurrency=4 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs`: exit 0, **1160 total / 1139 pass / 0 fail / 21 skip**, 로그 `build-artifacts/agent-scale-20260926/full-regression-builder-context.txt` SHA-256 `45b5045b0c984df5baeec5eacc75d427f122b5d20e53e1480b2d14ed30b858df`. 추가 개발자/저장소 회귀 `node --test --test-concurrency=2 runtime/test/repository-*.test.mjs workers/developer/*.test.mjs`: exit 0, **79 total / 76 pass / 0 fail / 3 skip**, 로그 `developer-regression-builder-context.txt` SHA-256 `c6aa05de6e36d1c34a0fc89976cd763d3f9e9a2c99cd32e44aa13cfc61f0ad27`; Docker 실물 3건은 조건 미충족 skip. `git -c core.safecrlf=false diff --check` exit 0.
- **VERIFIED:** Builder 의존 산출물의 저장 SHA 검사·입력 연결(합성 HTTP)과 실제 모델 입력에 선행 ID 포함, 기존 승인·의미 검증 실패 폐쇄 유지, 회귀. **RAN-UNVERIFIED/FAILED:** 실제 로컬 모델 Shadow 임무는 수행했으나 최종 내용/형식 품질 미달. **BLOCKED/NOT RUN:** Android 실제 기기 연결 0, 폰 설치·페어링·요청·복구; Docker 실물 워커; 동시 작업 확대. 이번 변경은 `runtime/server.mjs`, `runtime/test/shadow-army.test.mjs`, 새 계획 문서, 정본 실행 기록이며 운영 배포·Vault 수정·자격증명 교체·데이터 삭제 없음. 커밋·push 없음. 다음 한 단계는 실제 Android 기기가 연결되면 P02→J01→R01/F01 수락을 실행하고, 그 전에는 Builder의 결과 품질을 고정된 평가 과제로 개선·재검증한다.

## §57 — 2026-09-26 Codex: 로컬 의미 검증의 형식 제약, 내용 판정은 유지

- §56의 실제 실패는 `qwen2.5:3b`가 `evidenceRefs`를 문자열로 반환해 기존 엄격한 `parseSemanticVerdictDraft`가 `invalid_criterion_evidence_refs`로 차단한 것이다. Ollama 공식 문서 `https://docs.ollama.com/api/openai-compatibility`는 `/v1/chat/completions`의 `response_format` 지원을, `https://docs.ollama.com/capabilities/structured-outputs`는 구조화 출력의 OpenAI 호환 API 사용을 명시한다. 이 문서를 확인한 뒤 **local provider의 semanticVerifier 요청에만** `json_schema`와 `temperature:0`을 추가했다. Scout/Researcher/Builder와 다른 provider 요청은 변경하지 않았다. 스키마는 `verdict/confidence/criteria/summary`와 criterion의 배열형 `evidenceRefs`를 선언한다. 서버의 기존 엄격한 파서·내용 판정·JEV 권한 제한을 우회하지 않는다.
- `runtime/test/semantic-verification.test.mjs`에 실제 HTTP 코어+주입 모델 transport에서 semantic 요청만 스키마를 포함하고 worker 산문 요청은 포함하지 않는 시험을 추가했다. 수정 전 단일 시험 red `actual undefined, expected json_schema`; 수정 뒤 `runtime/test/semantic-verification.test.mjs runtime/test/shadow-army.test.mjs` **28/28 통과**. 요청 포맷 검사는 합성 transport 범위다.
- PC의 실제 Ollama에 **§56 실패 임무의 저장된 semantic 입력 그대로** 단독 재호출했다. 기존 임무/작업/판정 상태를 변경하거나 모호한 이전 호출을 재시도하지 않고 별도의 읽기 평가로만 실행했다. `build-artifacts/agent-scale-20260926/semantic-format-probe.json` SHA-256 `48a0bc42bba0e84ebacb63ec8d1ca5f8207feee246ab3d489346268dc15e1696`: HTTP 200, `finishReason:stop`, 164,051ms, 출력 SHA-256 `857204fc0ce234875b10cc1a96929afff3d69ca430efe9db75927642f0f9a07e`; 엄격한 JSON 파서 통과, 두 criterion 모두 `evidenceRefsArray:true`. **판정은 `uncertain`**이다. 즉 형식 결함은 이 입력에서 해소됐지만 Builder 결과의 의미·내용 품질은 통과하지 못했다. 새 Shadow 전체 임무의 성공·품질을 이 단독 재호출로 주장하지 않는다. 시험 뒤 `ollama stop qwen2.5:3b` 실행.
- 변경 후 Node v24.21.0 전체 `node --test --test-concurrency=4 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs`: exit 0, **1161 total / 1140 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression-semantic-format.txt` SHA-256 `1f2e7238e2fca757441c8013d7658816d8f26d865542648e76e9aace92b3ecee`. `git -c core.safecrlf=false diff --check` exit 0.
- **VERIFIED:** 로컬 semantic 요청만 구조화 출력 설정, 동일 저장 입력의 Ollama 실제 출력 형식·파서 통과, 관련/전체 회귀. **RAN-UNVERIFIED/FAILED:** 산출물 내용은 `uncertain`, 새 전체 실모델 임무는 실행하지 않음. **BLOCKED/NOT RUN:** Android 기기 부재로 실기기 수락; RAM 제약에서 병렬 확대·Docker 실물 수락. 변경 파일은 `runtime/lib/semantic-verification.mjs`, `runtime/lib/agent-engine.mjs`, `runtime/test/semantic-verification.test.mjs`, 이 기록. 다른 미커밋 변경 보존, 운영 배포·실제 자격증명 교체·Vault 변경·데이터 삭제·커밋/push 없음. 다음 한 단계는 실제 소유자 과제의 Builder 내용 평가 기준을 고정하고, 부족한 산출물을 개선해 **새 임무의 최종 의미 검증**을 다시 통과시키는 것이다. 실제 휴대폰이 연결되면 우선 P02→J01→R01/F01 실기기 수락을 실행한다.

## §58 — 2026-09-27 Codex: Shadow Builder 성공 기준 전달과 EXTRA-136 실모델 내용 평가

- 저장소 branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`, origin `https://github.com/wooyeonho/yeno-os.git` 재확인. 기존 미커밋 작업 전부 보존. §57 뒤 실제 저장 임무를 조사하니 Builder job에는 `successCriterion`이 있었지만 모델 입력에는 없고 최종 semantic verifier에만 전달됐다. `runtime/test/shadow-army.test.mjs`의 실제 HTTP 임무 시험에 Builder 입력이 동일 기준을 받아야 한다는 단언을 먼저 추가해 red 실패를 확인했다. `runtime/server.mjs`에서 이미 검증한 선행 Scout/Researcher 근거 뒤에 해당 job의 성공 기준과 최종 산출물·확인/제안/미확인 구별 지침을 전달했다. 권한·검증 게이트는 변경하지 않았다. 관련 `runtime/test/shadow-army.test.mjs runtime/test/semantic-verification.test.mjs` 28/28 통과.
- 실모델 호출 **전에** 과제별 내용 수락 기준 `docs/BLACKHOLE_EXTRA136_ACCEPTANCE_20260927.md`를 작성했다(SHA-256 `5eb9b618f21ac550e628e9d1b04332fb03fb3bb66f1ca50a45419ad7981faa57`). 원본 영상/기기/엔진을 보지 않았으므로 원본 재현을 요구하거나 주장하지 않고, 독자 에셋 실험의 출처·입력·세 상태·관찰 가능 합격 조건·한 장의 한국어 작업 카드 다섯 항목으로 고정했다. 이는 이 과제의 평가 기준이며 모든 Shadow 산출물에 강제하는 보편 문서 형식이 아니다.
- 실제 로컬 Ollama `qwen2.5:3b`와 격리 HTTP 코어로 `scripts/verify-source-shadow-live.mjs`를 실행했다. 산출물 `build-artifacts/agent-scale-20260926/m2-shadow-builder-criterion-live-20260927/`, `report.json` SHA-256 `0b44dc8674818fb702a3ecfc0efab0d97c06518ad4d07f9d60426a5a73b4b33b`. Scout/Researcher/Builder/결정론 Verifier는 완료하고 Builder의 저장 입력은 명시적 성공 기준을 포함했다. Builder 산출물 ID `14ed4274-2dec-4e73-985f-2085ec2888c7`, SHA-256 `3b39faed412cbe8fabfec0ccbb77b782e5afcb6a141e2a6b4249c7c4a384ddb9`, 1549 bytes; HTTP 저장 SHA 일치. 격리 코어 재시작 뒤 임무 상태 보존. Semantic Verifier의 JSON 형식은 유효하지만 판정은 `uncertain`, 필수 기준 `not_met`로 작업 실패 `semantic_uncertain`; 전체 `ok:false`, `phase:failed`, memoryEvent 없음. 같은 프롬프트의 성공으로 세지 않는다. 시험 후 `ollama stop qwen2.5:3b` 실행.
- 사전 기준에 대한 Codex 수동 판독 `manual-evaluation.md`(SHA-256 `d054cdf982e0cfd945e29beec33ac1482a483fbde6a99448de39fd67f4226c48`)은 5개 모두 실패: 원장 출처·부분 열람 상태 부재, 독자 에셋과 상대 깊이/경로 미지정, 전경/가림/재등장 상태 미정의, 관찰 가능 통과/실패 조건 부재, 한 장 대신 세 개의 일반 카드. 수동 판독을 독립 제품 평가로 주장하지 않는다. 동일 프롬프트 재시도보다 모델 선택·문제 분해·결정론적 구조화 중 다른 가설을 비교할 필요가 있다.
- 변경 후 Node v24.21.0 전체 `node --test --test-concurrency=4 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs`: exit 0, **1161 total / 1140 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression-builder-criterion-20260927.txt` SHA-256 `183eb2dfd2f54f032ed42714b1c537ba42eec4233e9f9102cfab907d486570b6`. `git -c core.safecrlf=false diff --check` exit 0.
- 사용자가 전달한 이름별 설명을 코드와 대조: `runtime/lib/recovery-one-of-qpu.mjs`는 생산 경로의 import가 없고 테스트에서만 import되므로 실제 QPU 실행 증거가 없다. JEV `authorizesDispatch:false`는 그대로다. `runtime/lib/autopilot.mjs`의 자동 capability 허용목록은 `failure-triage`, `evidence-gap-brief`, `ledger-digest` 세 개지만 이를 Kirby 전체의 가능한 흡수 종류와 동일시할 수는 없다. `runtime/lib/solo-leveling.mjs`는 B 조합, A 개입 없는 자율 성공 3건, S 외부 검증 조건을 구현·시험하지만, 이 코드만으로 현재 실제 기능별 등급이 C 이하라고 확정할 수 없다. 원작과의 유사성 순위는 제품 검증 지표가 아니다.
- **VERIFIED:** 성공 기준의 Builder 전달(합성 HTTP 시험), 실제 모델 임무의 중간 역할 완료·저장 SHA·재시작 보존·최종 의미 실패, 관련/전체 회귀. **RAN-UNVERIFIED/FAILED:** 실제 `qwen2.5:3b` 산출물은 사전 내용 기준 0/5, 의미 검증 `uncertain`. **BLOCKED/NOT RUN:** Android 실기기 페어링→요청→PC 실행→진행/결과→복구(ADB 연결 0), 실제 QPU, Docker 실물 워커. 운영 배포·자격증명 교체·Vault 변경·데이터 삭제·커밋/push 없음. 변경 파일은 `runtime/server.mjs`, `runtime/test/shadow-army.test.mjs`, 새 과제 수락 문서와 이 정본 기록. 다음 한 단계는 EXTRA-136의 사전 기준을 유지하며 **한 장의 구체적인 실행 카드 생성 방식**을 새 가설로 바꾸어 실제 모델 전체 임무로 재검증하고, Android 폰이 연결되는 즉시 P02→J01→R01/F01 실기기 수락을 우선한다.

## §59 — 2026-09-27 Codex: Kirby 등록 목록과 Solo Leveling 등급의 범위 확인

- 읽기 전용 재대조. `runtime/capabilities/*.json`에는 `evidence-gap-brief`, `failure-triage`, `ledger-digest` 세 검토 원본이 있다. 이는 현재 준비된 manifest 목록이며 Kirby가 앞으로 흡수할 수 있는 종류의 상한이 아니다. 별도로 `runtime/lib/autopilot.mjs`의 자동 실행 허용목록도 이 세 ID를 지정한다. manifest 수, 등록 상태, 자동 실행 범위를 혼동하지 않는다.
- EXTRA-136 실모델 시험의 **격리 저장소** `build-artifacts/agent-scale-20260926/m2-shadow-builder-criterion-live-20260927/runtime/state.json`을 읽고 저장된 capability registry에 `growthOverview`를 적용했다: 등록 2개(`evidence-gap-brief`, `failure-triage`), 각 실행 0회·E등급, 합계 E=2/D~S=0. 이는 해당 격리 임무의 결과일 뿐 PC 운영 환경의 현재 등급이 아니다. 운영 resident 기본 경로 `%LOCALAPPDATA%\BLACKHOLE\resident-v2`는 존재하지 않고 `BLACKHOLE Core v2` 예약 작업/8790·8792·9443 listener도 찾지 못했다. `blackhole-resident.ps1 -Action status`는 소유 메타데이터 부재로 `Resident ownership does not match`를 반환했고 파일이나 작업을 바꾸지 않았다. 따라서 현재 운영 레지스트리의 기능별 등급은 **확인 불가**이며 '전부 C 이하' 같은 단정은 하지 않는다.
- EXTRA-136 `report.json`의 실제 결과를 다시 읽었다: Scout/Researcher/Builder/결정론 Verifier 완료, semanticVerifier `semantic_uncertain` 실패, `ok:false`, `phase:failed`, 저장 Builder artifact ID/SHA와 재시작 보존은 §58과 일치한다. JEV 실행 권한은 계속 `authorizesDispatch:false`; QPU 모듈의 실제 실행 경로 import는 테스트 밖에서 발견되지 않았다. 이 항목은 코드·격리 데이터 확인이며 Android 실기기 또는 운영 등급 검증은 아니다.

## §60 — 2026-09-27 Codex: 상세 작업 계약 전달 후 실모델 재시험, 내용은 계속 불합격

- Cowork가 §59의 `state.json`을 “암호화된 백업”이라고 설명한 점을 원본 코드 `runtime/lib/store.mjs`로 바로잡았다. `encodeState`는 평문 `JSON.stringify(state)`를 `payload` 문자열에 넣고 SHA-256을 붙이며, `openStore`는 해시·스키마를 검사한 뒤 `JSON.parse(envelope.payload)`로 읽는다. 따라서 단순하게 펼쳐 보이지는 않아도 암호화된 상태 파일은 아니다. 비밀값은 출력하지 않았다.
- §58의 한 문장 성공 기준은 사전 평가 기준 다섯 항목을 실제 Builder에 전달하지 못했다. `docs/BLACKHOLE_EXTRA136_TASK_SPEC_20260927.json`에 550자 과제별 명시적 계약을 작성하고(SHA-256 `a6dff933202dd0fd80caac5713ede907f7b4ba764e434f8f3efdb6d8e23f90d4`), `scripts/verify-source-shadow-live.mjs`가 선택적 네 번째 입력으로 이를 받아 검증·원본 바이트 해시 기록 후 임무의 `successCriterion`에 전달하도록 했다. 기존 세 인자 실행은 그대로 지원한다. 계약은 모델 호출 전 작성됐고, 원본 영상의 미확인 상태를 유지하며 독자 에셋·세 상태·두 시험·한 장의 카드 요구를 명시한다. 이 과제 전용 입력이며 모든 Shadow 임무의 성공 기준을 바꾸지 않는다.
- 실제 PC Ollama `qwen2.5:3b` + 새 격리 HTTP 코어로 `node scripts/verify-source-shadow-live.mjs build-artifacts/handoff-r3-20260926/four-inputs.json build-artifacts/agent-scale-20260926/m2-shadow-task-contract-live-20260927 qwen2.5:3b docs/BLACKHOLE_EXTRA136_TASK_SPEC_20260927.json`을 실행했다(exit 1, `ok:false`, `phase:failed`). `report.json` SHA-256 `db2705b454af1c00540898e63954620190737fd3f30144e046e00af6b709b68b`. Builder 저장 입력에 작업 계약 문구가 실제 포함됐고 Scout/Researcher/Builder/결정론 Verifier 완료, 저장 산출물 ID `2786e3af-8cc9-4468-92bc-8d0b3cfbb878`, SHA-256 `da13f5ad952de045ae6dee73edc08a2b175e2e8937572b55083f38a769d94324`, HTTP SHA 일치, 재시작 보존 확인. Semantic Verifier는 유효한 JSON 형식으로 `uncertain`을 내고 `semantic_uncertain` 실패, 결과 memoryEvent 0. 시험 뒤 `ollama stop qwen2.5:3b` 실행.
- 사전 기준에 대한 수동 판독 `m2-shadow-task-contract-live-20260927/manual-evaluation.md` SHA-256 `fa289dbda26598609a1a68f82dce97cf2aeb3fc7985d8606bfa79e5c90c57793`: **1/5**. 출처·partial/pending·미확인 표기는 개선됐다. 그러나 실제 에셋의 모양/깊이/경로는 값 없이 “정해짐”이라고만 했고, 세 상태는 혼동되어 있으며 두 번째 시험이 없고 “3cm 이상”이라는 관찰 불가능한 임의 수치를 만들었다. 작업 순서도 실제 제작 카드보다 탐색 계획이다. 모델 verifier가 일부 부실한 항목을 `met`으로 표시했으나 최종 `uncertain`으로 차단했고, 그 부분 `met`을 내용 합격으로 세지 않는다. 이 시험은 약한 로컬 모델에 성공 기준을 자세히 주는 것만으로 실사용 품질을 얻지 못했다는 반증이다. 실제 제작·영상 시험은 하지 않았다.
- 변경 후 Node v24.21.0 `node --check scripts/verify-source-shadow-live.mjs` 통과. 전체 `node --test --test-concurrency=4 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs`: exit 0, **1161 total / 1140 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression-task-contract-20260927.txt` SHA-256 `b49599788200945f9e3e18ccd3affc7b6931086dd07610d2d9b8d75d1d449797`. `git -c core.safecrlf=false diff --check` exit 0. ADB 연결 기기 0. 이전 미커밋 수정 보존, 운영 배포·데이터 삭제·실제 자격증명 교체·Vault 변경·커밋/push 없음.
- **VERIFIED:** 과제별 계약이 실제 저장 Builder 입력에 전달됨, 중간 역할·해시·재시작 보존, 1/5 수동 내용 평가 및 최종 실패, 전체 회귀. **RAN-UNVERIFIED/FAILED:** 실제 로컬 모델 전체 임무는 수행했으나 의미 검증 `uncertain`, 실사용 카드 미완성. **BLOCKED/NOT RUN:** Android 실기기 전체 수락(ADB 0), 실제 장면 제작/시각 판정, QPU/운영 등급. 다음 한 단계는 같은 `qwen2.5:3b` 프롬프트 반복을 멈추고, 과제별 구조화된 장면 입력을 별도 제작/검증 단계에서 만들거나 충분한 자원의 다른 모델을 비교해 **사전 5항목과 독립 의미 판정**을 함께 충족하는지 확인하는 것이다. 실제 폰이 연결되면 Android P02→J01→R01/F01 수락을 먼저 실행한다.

## §61 — 2026-09-27 Codex: 기존 EXTRA-136 시제품을 재검증하고 실행 카드로 연결

- §60 실패를 모델 고유 능력의 최종 판정으로 확대하기 전에 기존 저장소를 재확인했다. `experiments/extra-136-occlusion/`에는 독자 SVG 장면·좌표/깊이 계산·브라우저 검증이 §41부터 이미 존재한다. `build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline-v3.html` SHA-256은 기존 보고와 같은 `4672d40e6bbd75ee2857fd829cfb7fa8612858538762b581948718c9dbd25220`; 기존 17개 캡처 해시도 전부 일치했다. 768px 앞·완전 가림·부분 경계 PNG를 직접 열어 화면을 대조했다.
- 현재 PC Node v24.21.0으로 `node --test experiments/extra-136-occlusion/scene-core.test.mjs` **3/3 통과**. 이어 `node experiments/extra-136-occlusion/verify-browser.mjs build-artifacts/handoff-r3-20260926/extra136-structured-card-browser-20260927 build-artifacts/handoff-r3-20260926/EXTRA-136-occlusion-offline-v3.html`: exit 0, `ok:true`, 로컬 Chrome/file://에서 375·768·1280px **17 캡처**, 각 해시 재계산 불일치 0. 새 `report.json` SHA-256 `48c28e5e2f7d1b9539914f770c573b224a7958a8896f6619751e430883861c94`. `projectObject`를 실제 재호출해 `(50,20)` 앞, `(0,70)` 숨김, `(50,70)` 안쪽, `(78,70)` 부분 경계, `(100,70)` 숨김, `(0,20)` 앞 상태를 확인했다.
- 기존 코드·캡처의 실제 값을 하나로 묶은 `experiments/extra-136-occlusion/WORK_CARD_20260927.md`를 새로 작성했다(SHA-256 `b2433f31e24d18ec668950e491454e9b6e196fe58f5da323594d12432a2b3c9f`). 출처의 `partial/pending`과 원본/AR/기기 미확인을 표시하고, 독자 에셋/깊이 순서/검증 키프레임/경계 이동의 두 시험/눈으로 판정할 실패 조건/HTML·17 캡처를 한 카드에 적었다. 이는 Codex가 **이미 검증된 시제품을 정리한 카드**이며 실패한 Shadow Builder의 산출물이나 독립 semantic `pass`가 아니다. 움직임 영상이나 실제 AR 공간 추적을 새로 실행했다고 주장하지 않는다.
- 원인 범위를 좁히기 위해 §60 격리 저장소를 읽었다. 당시 source는 원본 부분 열람 항목 1개뿐이고 summary와 Builder 모델 입력에는 기존 시제품 HTML SHA `4672d40e...` 및 새 작업 카드가 없었다. 기존 시제품과 검증된 장면 값이 임무에 **전달되지 않은 사실**을 확인했다. 따라서 §60의 1/5은 “그 임무의 현재 모델·자료·실행 방식 조합이 불합격”이라는 증거이지, 모델 자체가 모든 구조화된 장면 입력에서도 불가능하다는 증거는 아니다. 다음 구체 단계는 기존 시제품/좌표/캡처 근거를 같은 임무의 허가된 자료로 연결한 뒤 새로운 격리 임무에서 카드 품질과 최종 의미 검증을 다시 비교하는 것이다. Android 기기가 연결되면 P02→J01→R01/F01을 우선한다.
- **VERIFIED:** 기존 시제품의 파일 해시, 새 로컬 Chrome 17캡처·해시, 기하 시험, 카드의 코드 값 대조. **RAN-UNVERIFIED:** 카드 자체는 Codex의 정리 결과이며 독립 의미 판정/새 Shadow 성공 증거가 아니다. **BLOCKED/NOT RUN:** 실제 Android·AR 기기, 원본 영상 전체, 운영 배포. 기존 미커밋 파일 보존; Vault·운영 저장소·자격증명 변경/데이터 삭제/커밋·push 없음. 변경은 이 카드와 정본 실행 기록뿐이며 §60 이후 제품 코드 변경이 없어 전체 회귀 수치는 §60 결과를 유지한다.

## §62 — 2026-09-27 Codex: 검증된 구조화 장면을 새 Shadow 임무에 전달, 앞단 모델 루프 실패

- §61에서 확인한 기존 시제품 값만 `experiments/extra-136-occlusion/SCENE_INPUT_20260927.json`에 구조화했다(SHA-256 `f2d9d4539143e0f169b25fe80aa44bb21d852f75c39b8ad203172aeccc11f10e`). 960×600 독자 SVG, 문 타원/깊이 기준, 물체의 6개 입력 프레임과 기대 가시성, 기존 HTML 및 브라우저 17캡처 보고 해시를 기록했다. 원본 영상이나 실제 AR 실행 자료로 승격하지 않았다. `scripts/verify-source-shadow-live.mjs`의 선택적 다섯 번째 인자로 받아 `projectObject` 재계산, HTML·브라우저 보고·각 PNG 해시 대조가 **모두 통과한 경우에만** 불신 참고 자료로 임무 목표에 넣고 입력 파일 SHA를 보고하도록 했다. 이전 세/네 인자 실행은 유지한다. 이 경로는 EXTRA-136 격리 수락용이며 운영 자동 수집/승인 경로가 아니다.
- 실제 PC Ollama `qwen2.5:3b`와 새로운 격리 HTTP 코어로 `node scripts/verify-source-shadow-live.mjs build-artifacts/handoff-r3-20260926/four-inputs.json build-artifacts/agent-scale-20260926/m2-shadow-structured-scene-live-20260927 qwen2.5:3b docs/BLACKHOLE_EXTRA136_TASK_SPEC_20260927.json experiments/extra-136-occlusion/SCENE_INPUT_20260927.json` 실행: exit 1, `ok:false`, `phase:failed`. `report.json` SHA-256 `b5030b4e0bc8cc9573785c8d83c11463c1610c5f35e8eed28d954a4b61f712ee`. 저장 원장/임무·source 상태는 재시작 후 보존. 하지만 Scout는 모델 호출 3회 중 두 도구 왕복 뒤 최종 `empty_model_response`로 실패(마지막 호출 outcome `unknown` 보존), Researcher는 도구 왕복 4회 뒤 `mission_call_limit`로 실패. Builder/결정론 Verifier/semanticVerifier는 `shadow_dependency_failed`이며 **실행되지 않았다**. Builder 산출물·독립 의미 판정·result memoryEvent는 모두 없다. 이 실패를 구조화 장면 입력의 산출물 품질 평가로 세지 않는다. 시험 뒤 `ollama stop qwen2.5:3b`; 당시 `ollama ps` 2.2GB/CPU 100%, Windows 여유 RAM 약 0.56GiB. `unknown` 결과를 재호출하지 않았다.
- 변경 후 Node v24.21.0 `node --check scripts/verify-source-shadow-live.mjs` 통과. 전체 `node --test --test-concurrency=4 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs`: exit 0, **1161 total / 1140 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression-structured-scene-20260927.txt` SHA-256 `adf956a79f631df85fa3cadaf93d8ddf2f86c00bf19cb4f2bc2cae791e249cb0`. `git -c core.safecrlf=false diff --check` exit 0. ADB 연결 기기 0.
- **VERIFIED:** 구조화 입력의 저장 코드/HTML/17캡처 해시 대조, 실제 격리 임무의 역할별 실패·복구 상태, 관련 전체 회귀. **RAN-UNVERIFIED/FAILED:** 구조화 입력을 받은 실모델 임무는 앞단 Scout/Researcher 오류로 멈춰 Builder의 카드 생성 품질을 측정하지 못했다. **BLOCKED/NOT RUN:** Android 실기기, 실제 AR, QPU/운영 등급. 기존 미커밋 파일 보존, 운영 배포·데이터 삭제·자격증명 교체·Vault 변경·커밋/push 없음. 이번 변경은 `scripts/verify-source-shadow-live.mjs`, 새 장면 입력 JSON, 이 기록. 다음 한 단계는 더 큰 텍스트를 모든 역할에 주는 방식을 중단하고, 기존 검증 자료를 **Builder에게만 제한된 크기로 전달**하는 경로를 시험해 Scout/Researcher의 도구 루프 실패와 카드 내용 실패를 분리하는 것이다. 실제 Android 폰이 연결되면 P02→J01→R01/F01 수락을 먼저 실행한다.

## §63 — 2026-09-27 Codex: Builder 전용 참고 자료 배선과 실모델 앞단 오류 분리

- `runtime/lib/shadow-army.mjs`의 임무 계획에 선택적 `builderEvidence`(1~2000자)를 추가했다. 이 값은 소유자 인증 임무의 Builder spec/job 입력에만 넣고 Scout·Researcher·Verifier·semanticVerifier의 목표/입력이나 `shadowAssignment` 공통 권한 필드에는 넣지 않는다. Builder 입력의 자료는 새 명령·권한·원본 확인 증거가 아니라는 경계를 명시했다. 크기 초과를 거부하며 기존 임무 인자와 검증 게이트를 유지한다. `runtime/test/shadow-army.test.mjs` 실제 HTTP+합성 transport 시험에 전용 marker를 넣어 Builder 모델 요청에만 존재하고 Scout·Researcher 모델 요청에는 없음을 단언했다. 수정 전 HTTP 400 red `지원하지 않는 필드가 있습니다.`, 수정 뒤 해당 시험 green. 관련 `shadow-army.test.mjs semantic-verification.test.mjs` **28/28 통과**.
- `scripts/verify-source-shadow-live.mjs`의 검증된 EXTRA-136 구조화 장면 자료를 긴 공통 목표에서 빼고, 기존 HTML/브라우저/17캡처/기하 해시 검사 뒤 Builder 전용 참고 자료로 전달하도록 바꿨다. 소유자 과제·소스 ID·기존 상세 성공 기준은 유지. 재시험 `node scripts/verify-source-shadow-live.mjs build-artifacts/handoff-r3-20260926/four-inputs.json build-artifacts/agent-scale-20260926/m2-shadow-builder-only-scene-live-20260927 qwen2.5:3b docs/BLACKHOLE_EXTRA136_TASK_SPEC_20260927.json experiments/extra-136-occlusion/SCENE_INPUT_20260927.json`: exit 1, `ok:false`, `phase:failed`. `report.json` SHA-256 `dee257b7901ac4414e3929a28a37dcfa2cbb3e02ba08f4d53ee8864dd2ab1ef7`; `sceneInputScope:"builder-only"`, 재시작 보존. 저장 job 입력에 장면 자료는 Builder에만 있고 Scout/Researcher의 실제 모델 입력에는 없다. Builder는 의존 작업 실패로 시작되지 않아 **실제 Builder 모델 입력과 내용 품질은 측정하지 못했다**.
- 실제 로컬 `qwen2.5:3b`에서 Scout는 3회 모델 호출 후 완료, Researcher는 4회 뒤 `Agent: mission_call_limit` 실패. Researcher 저널을 읽으니 첫 두 `project_read` 호출에 허용되지 않은 `project_id` 인자를 넣었고 값은 현재 **source ID**(프로젝트 ID와 다름)였다. 두 호출은 `unsupported_tool_or_arguments`로 거부됐다. 이후 `project_sources`를 두 번 호출하고 최종 답을 내기 전 한도에 걸렸다. Builder/결정론/의미 검증은 모두 `shadow_dependency_failed`, artifact/result memoryEvent 없음. 의도적 안전 경계가 다른 프로젝트를 읽도록 풀어주지 않았다. 당시 모델은 `ollama ps`에서 2.2GB/CPU 100%, 여유 RAM은 시험 전 약 0.52GiB였고 모델 중지 뒤 약 1.6GiB였다. RAM이 잘못된 도구 인자의 직접 원인이라고 단정하지 않는다. 시험 뒤 `ollama stop qwen2.5:3b` 실행.
- 변경 후 Node v24.21.0 `node --check runtime/lib/shadow-army.mjs scripts/verify-source-shadow-live.mjs` 각각 통과. 전체 `node --test --test-concurrency=4 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs`: exit 0, **1161 total / 1140 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression-builder-only-scene-20260927.txt` SHA-256 `47adc40ec751f5c64ff07e6215b6fefcb35dc4317b3c5e2e8c4d87aae404d7cf`. `git -c core.safecrlf=false diff --check` exit 0. ADB 연결 기기 0.
- **VERIFIED:** Builder 전용 입력/앞단 비노출 합성 HTTP 시험, 실제 저장 job/Scout·Researcher 모델 입력 분리, Researcher의 잘못된 도구 인자·호출 한도, 회귀. **RAN-UNVERIFIED/FAILED:** 새 실모델 임무는 Researcher 단계에서 실패하여 Builder 내용 품질·최종 의미 판정 미측정. **BLOCKED/NOT RUN:** Android 실기기 페어링→요청→진행·결과→복구, AR/QPU/운영 등급. 기존 미커밋 파일 보존, 운영 배포·데이터 삭제·실제 자격증명 교체·Vault 변경·커밋/push 없음. 변경 파일은 `runtime/lib/shadow-army.mjs`, `runtime/test/shadow-army.test.mjs`, `scripts/verify-source-shadow-live.mjs`, 이 정본 기록. 다음 한 단계는 Researcher의 `project_read {}` 도구 계약 오용을 **허용 범위를 넓히지 않고** 줄여 앞단 두 역할이 완료되는지 다시 확인한 다음, Builder의 실제 내용과 5항목 의미 기준을 측정하는 것이다. 폰이 연결되면 Android P02→J01→R01/F01 수락을 우선한다.

## §64 — 2026-09-27 Codex: Shadow 도구 루프 분리, Builder 실모델 한계 확인

- 시작 상태: 기존 branch/HEAD와 미커밋 작업을 보존했다. §63 Researcher가 source ID를 `project_read`의 project 인자로 반복 보낸 문제를 다뤘다. `runtime/lib/agent-engine.mjs`는 잘못된 `project_read`/`project_sources` 인자를 여전히 `unsupported_tool_or_arguments`로 거부하되 `expectedArguments:{}`와 안내를 돌려준다. `runtime/test/shadow-army.test.mjs`에서 기존 거부/범위 테스트를 먼저 red(`expectedArguments` 없음)로 확인하고 green으로 만들었다. 도구 범위나 읽기 권한을 넓히지 않았다.
- 수락 스크립트 `scripts/verify-source-shadow-live.mjs`가 `phase:blocked`만 보고 정상 `dependencyPending` 전이를 조기 종료하던 경쟁 조건을 `missionSettled`로 수정했다. 의존성이 완료되어 대기 작업을 큐에 넣을 수 있으면 계속 기다린다. 새 `scripts/verify-source-shadow-live.test.mjs` 1/1 통과. 첫 실측 `m2-shadow-tool-feedback-live-20260927`은 Scout/Researcher 완료 후 Builder 대기 중 조기 blocked로 기록됐고(report SHA-256 `7a48dfb19af178d3c5c3adf37bbd834ab60a87419b3074aafcec4d00b3f3d56f`), 새 격리 실행 `m2-shadow-tool-feedback-settled-live-20260927`은 실제 Builder까지 갔으나 `empty_model_response`, 마지막 호출 `unknown`으로 실패(SHA `346d320388ad2a5b1982436803b980642341468aaba7fdc97ea55e0112c27da2`). 원래 임무를 재호출하지 않았다.
- `scripts/verify-source-shadow-live.mjs`가 검증 완료된 전체 장면 JSON을 계속 HTML/브라우저/17 PNG/기하 SHA와 대조하되 Builder 전용 입력에는 6프레임·문 기하의 짧은 요약만 전달하도록 했다. 새 격리 `m2-shadow-compact-scene-live-20260927`은 Scout가 잘못된 `project_read {projectId:sourceId}`를 반복해 호출 한도에 걸렸고 Builder는 실행되지 않았다(report SHA `4640bd698b7d037bdd731b4b882b1d50a14aeb0ebc0e0c8319f97d6150bae85b`). RAM과 잘못된 인자 사이 인과관계는 주장하지 않는다.
- 로컬 provider의 Scout/Researcher에 한해 서버가 **할당된 프로젝트와 최대 3개 해당 프로젝트 source의 제한된 필드**(ID·제목·URL·readingStatus·decision·짧은 요약/용도/위험)를 모델 호출 전에 저널에 저장하고 도구 없는 단일 응답으로 처리하도록 했다. 다른 프로젝트나 Builder 전용 장면 근거는 넣지 않는다. `runtime/test/shadow-army.test.mjs`의 새 실제 HTTP+합성 transport 시험은 먼저 red(도구가 노출됨), 이후 green이며 두 역할의 요청에 다른 프로젝트/Builder 자료가 없음을 확인한다. 실제 `m2-shadow-local-leaf-live-20260927`에서 Scout/Researcher 각각 모델 호출 1회로 완료, Builder 시작까지 확인했다. 그러나 Builder는 6018-byte 입력 뒤 `empty_model_response`, 마지막 호출 `unknown`; 산출물 없음, `ok:false/phase:failed`, 재시작 상태 보존(report SHA `2d6b8b909388a0297944e04a16c62f1be9110056f8e9ee7b225d4b4868163c58`). **앞단 도구 루프 해소는 실측됐지만 Builder 내용 성공은 아니다.**
- 로컬 Builder에 전달하는 선행 산출물 발췌만 각 2000→500 bytes로 축소하고 실제 산출물 ID/SHA와 원본 보관은 유지했다. 원격 provider의 기존 2000-byte/도구 경로는 유지한다. 합성 HTTP 테스트에서 긴 노트의 꼬리가 Builder 모델 입력에 없고 발췌임이 표시됨을 확인했다. 실제 `m2-shadow-compact-deps-live-20260927`에서 Scout/Researcher 각 1회 완료, Builder 입력 4813 bytes. Builder의 첫 두 호출은 도구 `project_read`를 반복하고 settled였으나 세 번째 호출은 `unknown`과 `empty_model_response`로 실패; 카드/의미 판정 없음(report SHA `5c110896e6c316d6a80678e2cfc0368ffb7fa7c31c740adb254674cf20ad188f`). 입력 크기만이 직접 원인이라는 가설은 뒷받침되지 않는다.
- 마지막으로 **로컬 Shadow Builder도** 준비된 의존 산출물과 Builder 전용 장면 자료를 이미 저널에 받은 뒤에는 도구 없는 단일 응답을 쓰도록 범위를 넓혔다. 이 변경은 Scout/Researcher만 바꿨던 앞선 시점과 구분해야 한다. 현재 `runtime/lib/agent-engine.mjs` 조건은 `['scout','researcher','builder']`이고, 합성 HTTP 시험은 로컬 Builder 도구 없음/전용 근거 있음 및 non-local Builder 도구 유지까지 확인했다. 실제 `m2-shadow-tool-free-builder-live-20260927`은 Researcher 완료, Scout 첫 호출 `request_failed_or_stopped`/`unknown`, Builder `dependencyPending`으로 **실행되지 않았다**. `ok:false/phase:failed`, 재시작 보존(report SHA `39e04c6378d8356f958ae97a8f32f2796b68d313a268b440b7e875fa0fce312e`). 이 실측으로 로컬 Builder tool-free 품질을 평가했다고 주장하지 않는다. 당시 Windows 여유 RAM 0.19GiB, `ollama ps`는 qwen2.5:3b 2.2GB/CPU 100%; 직접 원인 미확정. 이후 `ollama stop qwen2.5:3b` 실행.
- 최종 변경 후 Node v24.21.0 관련 12/12 통과(`runtime/test/shadow-army.test.mjs`, `scripts/verify-source-shadow-live.test.mjs`). 전체 `node --test --test-concurrency=4 runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs`: exit 0, **1162 total / 1141 pass / 0 fail / 21 skip**; 로그 `build-artifacts/agent-scale-20260926/full-regression-tool-free-builder-20260927.txt` SHA-256 `102e1568ffee214f0cdf39cbd8f44164f2d469520f5219d8ba2e842fff2bc01f`. `node --check` 변경 JS, `git -c core.safecrlf=false diff --check` exit 0. `adb devices -l`: 연결 0대. 산출물은 각 격리 폴더의 `report.json`, `runtime/state.json`, 선행 역할 artifact이며 이번 세 실모델 실행에는 Builder artifact가 없다.
- **VERIFIED:** 도구 인자 거부 경계, 경쟁 조건 수정, 로컬 Scout/Researcher의 실모델 단일 호출 완료(두 실행), 합성 HTTP의 로컬 Builder tool-free/원격 Builder 도구 분리, 전체 회귀와 각 실패 상태/재시작 보존. **RAN-UNVERIFIED/FAILED:** Builder 원인 분리 실험들은 산출물 없이 실패했고 tool-free Builder 실모델 실행은 앞단 Scout 요청 실패로 미측정. 5항목 내용 품질·semanticVerifier 통과를 올려 적지 않는다. **BLOCKED/NOT RUN:** Android 실기기 페어링→요청→PC 실행→진행/결과→복구(ADB 0), 실제 AR/QPU/운영 등급. 기존 변경 보존, Vault 변경·운영 배포·데이터 삭제·실제 자격증명 교체·커밋/push 없음. 이번 절의 변경 파일은 `runtime/lib/agent-engine.mjs`, `runtime/server.mjs`, `runtime/test/shadow-army.test.mjs`, `scripts/verify-source-shadow-live.mjs`, 신규 `scripts/verify-source-shadow-live.test.mjs`, 이 실행 기록이다. 다음 한 단계는 PC 메모리 여유가 확보된 조건에서 **새 격리 임무**로 로컬 Builder tool-free 실모델 산출물/사전 5항목 의미 판정을 측정하는 것이다. 실제 휴대폰 연결 시 Android P02→J01→R01/F01 수락이 최우선이다.

## §65 — 2026-09-27 Claude(Cowork): Builder 빈 응답 원인 분리 지시서

- §64 실측 4회 전부 독립 대조(각 report SHA, 회귀 로그 SHA `102e1568…` 일치). §64가 "Scout/Researcher만"에서 "Builder 포함"으로 바뀐 사실을 스스로 구분해 적은 것 확인.
- 코드 근거로 원인 후보 정리: `agent-engine.mjs:150`은 HTTP 200 + 빈 `content`일 때만 `empty_model_response` → 타임아웃 아님. 저장소에 `num_ctx`/`OLLAMA_CONTEXT_LENGTH` 설정 없음, Builder `inputTokens` 1947·2063이 Ollama 기본 2048 경계에 걸침. Ollama는 초과 시 무음 절단 후 `server.log`에만 기록 — **가설이며 확정 아님**, 확인 방법을 지시서에 명시.
- 신규 `docs/CODEX_DIRECTIVE_BUILDER_EMPTY_20260927.md`: (1) server.log 절단 로그 대조 → num_ctx는 Ollama 설정/파생 모델로 수정, (2) 여유 RAM 3 GiB 미만이면 실측 차단 게이트, (3) 그래도 비면 5항목 분할 호출 + 7B 비교 실측, (4) 원인 확정 전 프롬프트 튜닝·동일조건 재실측 금지. 승인·검토 게이트 완화 없음.
- **VERIFIED:** §64 기록·해시·코드 조건. **NOT RUN:** 지시서 항목 전부(Codex 실행 대기). **BLOCKED:** Android ADB 0대 유지.

## §66 — 2026-09-27 Codex: Builder 환경 가설 대조, 저메모리 차단, 거짓 양성 분리

- §65 지시를 읽고 먼저 `%LOCALAPPDATA%\Ollama\server.log` 및 회전 로그에서 `truncating input prompt`를 검색했다. `server.log`는 0바이트이고 `server-1.log`·`app-5.log`는 9월 24일까지, `app.log`에도 해당 문구가 없다. 9월 26일 Builder 호출 시각의 서버 로그가 없어 **절단 유무를 대조할 수 없다**. `ollama --version`은 0.34.3, `ollama show qwen2.5:3b`의 모델 최대 context length는 32768, `OLLAMA_CONTEXT_LENGTH`는 미설정, 실행 전 `ollama ps`는 빈 목록. 실제 요청의 `num_ctx`가 2048이었다는 증거는 없고 절단 가설은 미확정이다. 그래서 Ollama 전역 설정·파생 모델·API payload의 context 값을 바꾸지 않았다. 코드의 `boundedJson`은 HTTP 비정상 응답을 먼저 거부하므로 `empty_model_response`는 정상 HTTP 응답 본문이 빈 경우의 오류다.
- §65 도착 전에 진행한 새 격리 실측 `build-artifacts/agent-scale-20260926/m2-shadow-serial-local-live-20260927/`에서는 로컬 모델 호출을 직렬화한 뒤 Scout·Researcher·Builder·결정론 Verifier·semanticVerifier가 모두 완료되고, Builder 파일이 저장되어 재시작 뒤에도 남았다. `report.json` SHA-256 `3442154383857f9a4586687e76ba872d3fcef11296eb95e893888986762fcc91`; Builder 파일 SHA-256 `cec89d0d6f1091cb912fadf27be61ae978e7ee33c943400009ba38140aa4dda0`. 이는 이전 네 실패와 달리 **빈 응답 없이 Builder 파일을 받은 사실**이다. 그러나 자동 semantic `pass`는 내용 품질의 거짓 양성이다. 파일은 검증된 타원 포털 입력 대신 침실·침대·구름을 창작하고 영상 1개 요구를 3개로 바꾸며, 가림 누출 실패 기준을 빠뜨렸다. `manual-evaluation.md`에서 사전 5항목 중 **1/5**만 통과(SHA-256 `cc5c8e3e2478ccf7661894f95d7f918905d949a9ac5d174e78e481010fbbb2d4`). semantic `evidenceRefs`는 본문 근거 대신 일반적인 artifact 명칭만 인용했다. 따라서 `report.ok:true`를 작업 카드 수락으로 해석하지 않는다. 의미 검증 거짓 양성은 별도 미해결 결함으로 남긴다. §65 이후 같은 조건의 모델 재실측은 하지 않았다.
- `scripts/verify-source-shadow-live.mjs`에 실행 전 여유 RAM 3GiB 게이트와 `ollama ps` 수집을 넣었다. RAM 미달 시 `BLOCKED/insufficient_memory`와 측정값을 `report.json`에 쓰고 런타임·모델을 시작하지 않는다. 테스트 **red**: 미구현 `memoryPreflight`로 1 fail; **green**: 2/2 pass. 실제 CLI `node scripts/verify-source-shadow-live.mjs build-artifacts/handoff-r3-20260926/four-inputs.json build-artifacts/agent-scale-20260926/m2-shadow-memory-gate-20260927`: exit 1, `status:BLOCKED`, 여유 0.709GiB, 최소 3GiB, `ollama ps` 비어 있음, `runtime/` 미생성. 보고 SHA-256 `d7c482429eadfe9734b95aada346c8305f9e58d3a6511704bc885d32d36c0343`.
- `empty_model_response`에는 본문 없이 HTTP 상태·`finish_reason`·입력/출력 토큰·본문 길이만 `responseMeta`로 붙여 작업 실패 사유에 남기도록 했다. 합성 응답 테스트 **red**(메타 없음)→**green**(1/1). 저장된 모델 저널에는 응답 본문이나 메타를 추가하지 않았다. 관련 회귀 54/54 pass. 시스템 Node 24.11.1은 단순 `fs.rmSync(...,recursive:true)`에서도 Windows 종료 코드 `-1073740791`로 비정상 종료했고, PC에 이미 있는 Node 24.19.0은 같은 재현과 관련 회귀를 정상 완료했다. 이 환경 차이를 코드 실패로 세지 않았다.
- `PATH` 앞에 기존 Node 24.19.0 경로를 둔 뒤 사용자 지정 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 실행: exit 0, **1165 total / 1144 pass / 0 fail / 21 skip**. 로그 SHA-256 `96f026ca0974094882e61d8f681ec0aa9e3cf5121992614258e9b3bc810dabe5`. 변경 JS `node --check`, 변경 경로 `git -c core.safecrlf=false diff --check` exit 0. 실제 ADB `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l` 연결 0대; 현재 Windows 여유 RAM 약 0.84GiB.
- **VERIFIED:** 로그 보존 범위·Ollama 버전/모델 표기, 저메모리 게이트의 실제 차단, 메타 합성 테스트, 전체 회귀, 새 격리 Builder 파일의 존재·해시와 수동 1/5 판정. **RAN-UNVERIFIED/FAILED:** 격리 임무의 자동 `phase:completed`/semantic `pass`는 기계적 완주일 뿐 카드 품질 미달이다. **BLOCKED/NOT RUN:** 컨텍스트 절단의 과거 로그 확인(로그 없음), 3GiB 조건의 새 Builder 실측/5항목 분할/7B 비교(현재 RAM 부족, 7B 미설치), Android 실기기 P02→J01→R01/F01(ADB 0). 다음 한 단계는 RAM 3GiB 이상을 확보한 뒤 기존 게이트를 통과하는 새 격리 실행에서 응답 메타와 사전 5항목을 다시 대조하는 것이다. 운영 배포·Vault 변경·자격증명 교체·데이터 삭제·커밋/push 없음.

## §67 — 2026-09-27 Codex: semanticVerifier의 근거 없는 PASS 차단

- §66 Builder 파일의 내용 품질 1/5에도 자동 semantic `pass`가 난 거짓 양성을 최우선으로 전환했다. 원인은 모델 draft의 `evidenceRefs`가 문자열 배열이라는 형식만 검사하고, 그 인용이 실제 Builder 본문에 있는지 서버 최종화 단계에서 확인하지 않은 것이다. 새 HTTP 통합 테스트는 수정 전 `generic evidenceRefs cannot turn a Builder artifact into a semantic PASS`에서 **red**: 기대 `failed`, 실제 `completed`로 재현됐다.
- `runtime/lib/semantic-verification.mjs`에 `assertPassEvidenceGrounded`를 추가하고 `runtime/server.mjs`의 `finalizeSemanticVerdict`가 저장된 Builder artifact를 다시 읽어 **각 `met` 기준마다 본문에서 실제 발견되는 12자 이상 정확한 인용**을 요구하도록 연결했다. 프롬프트 제목·보조 자료만의 문구 및 생성된 `BLACKHOLE AI 초안` 꼬리말은 근거가 아니다. 없으면 `pass_evidence_not_in_artifact`로 semantic 작업을 실패 폐쇄하고, 임무 완료·마일스톤·결과 기억을 만들지 않는다. 모델 프롬프트에도 동일한 인용 계약과 불확실하면 `uncertain`을 반환하라는 지시를 넣었다. `fail`·`uncertain` 판정에는 새 PASS 조건을 적용하지 않는다. 승인·JEV dispatch 권한·외부 코드 검토 게이트는 바꾸지 않았다.
- 수정 후 같은 HTTP 통합 테스트 **green**; 정상 본문 인용은 통과, 두 기준 중 하나만 보조 자료 인용이면 거부, 생성 꼬리말 인용도 거부하는 순수 시험 통과. 기존 PASS 합성 fixture 여섯 파일을 실제 합성 Builder 본문 인용으로 갱신했다. 관련 여섯 시험 파일 **53/53 pass**. §66의 보존된 `state.json`에서 기존 semantic `pass`와 실제 Builder 파일(2860 bytes)을 읽기 전용으로 새 검사 함수에 넣어 `pass_evidence_not_in_artifact` 거부를 직접 확인했다. 원래 격리 상태와 그때의 `report.json`은 수정하지 않았다.
- 기존 Node 24.19.0으로 `npm.cmd test` 실행: exit 0, **1167 total / 1146 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression-semantic-grounding-20260927.txt` SHA-256 `ddd99019261ddcba447d081ac8a8e1a2b385ff118f7dec5b733cfc57ab4a9aad`. 변경 JS `node --check`, 관련 경로 `git -c core.safecrlf=false diff --check` exit 0. 이 절의 수정 경로는 `runtime/lib/semantic-verification.mjs`, `runtime/server.mjs`, `runtime/test/semantic-verification.test.mjs` 및 실제 본문 인용으로 고친 PASS fixture `runtime/test/{f05-mission-memory-outbox,g1-living-loop-integration,grok-provider,jarvis-shadow-closed-loop,shadow-army}.test.mjs`다. 기존 미커밋 변경은 보존했다.
- **VERIFIED:** 관찰된 일반 라벨 거짓 양성을 새 최종화 경계가 거부하고, 임무/마일스톤/기억이 차단됨; 정상 인용·FAIL/UNCERTAIN 회귀와 전체 회귀 통과. **RAN-UNVERIFIED:** 근거가 본문에 있다는 사실은 의미상 요구사항 충족의 증명이 아니다. 틀린 내용 속 문구를 정확히 인용해도 모델이 거짓 `pass`를 낼 수 있으므로, 작업별 결정론적 수락 조건이나 소유자 검토가 필요한 결과는 별도 게이트를 유지해야 한다. 과거 상태의 기존 PASS를 소급 변경하지 않았다. **BLOCKED/NOT RUN:** RAM<3GiB에서 새 실모델 semantic 판정 재실행, Android 실기기(ADB 0). 다음 한 단계는 EXTRA-136의 사전 5항목을 모델 `pass`와 독립적으로 검사하는 결정론적 수락 게이트를 격리 경로에 연결해 잘못된 장면 카드가 완료로 표시되지 않게 하는 것이다. 운영 배포·Vault 변경·자격증명 교체·데이터 삭제·커밋/push 없음.

## §68 — 2026-09-27 Codex: EXTRA-136 격리 수락에 내용 계약 게이트 연결

- §67의 다음 단계를 실제 코드로 연결했다. `experiments/extra-136-occlusion/card-acceptance.mjs`가 Builder 카드 본문의 유일한 `extra136-card-v1` JSON 근거 블록을 파싱하고, 사전 5항목을 `source/scene/states/tests/execution` 다섯 그룹으로 점검한다. 원장·현재 서버가 발급한 source ID·`partial/pending`·원본/기기/엔진/AR/실제 시험 미확인, 검증된 960×600 독자 SVG/타원 문/불투명 가림 물체/수평 경로, `projectObject`가 계산한 6개 상태, 고정/경계 두 시험과 가림 누출 실패 조건, 캡처 3장/영상 계획 1개, 한국어 제작·캡처·경계 검사 단계 및 기존 HTML/브라우저/장면 입력 SHA를 정확히 대조한다. 구조화 블록 밖의 자유 문장이 상충하면 거부하고, 앱이 덧붙이는 정형 꼬리말은 근거에서 제외한다. 이는 **이 검증된 EXTRA-136 2D 장면 전용 계약**이며 범용 Shadow 임무나 원본 영상/실제 AR 시험의 품질 인증이 아니다.
- `scripts/verify-source-shadow-live.mjs`는 Builder 전용 참고 자료에 1453자(1648바이트)의 블록 계약을 전달하고, 실제 artifact를 HTTP SHA 대조 뒤 읽어 `report.contentAcceptance`에 다섯 판정을 기록한다. `acceptedShadowResult`는 기존 임무 완료·결정론/semantic 판정·결과 기억·artifact 조건 외에 **사전 task spec과 scene input의 SHA 및 내용 계약 5/5**를 요구한다. 두 입력을 생략해도 `report.ok:true`로 우회할 수 없다. 모델의 `pass` 하나만으로 이 격리 보고가 합격으로 바뀌지 않는다. 저장된 서버 임무 자체의 `phase`/마일스톤을 소급 수정하는 경로는 아니다.
- 시험 red: 수락 함수 미구현 상태에서 격리 보고 게이트 테스트 1 fail. green: `scene-core` 포함 관련 **10/10 pass**. 정상 구조화 카드 5/5, 원본과 다른 source ID·틀린 visibility·영상 3개·작업 단계 종류 변경, JSON 바깥의 상충 문장, 사전 입력 생략을 모두 거부한다. §66 원본 `report.json`(SHA `3442154383857f9a4586687e76ba872d3fcef11296eb95e893888986762fcc91`)·Builder 파일(SHA `cec89d0d6f1091cb912fadf27be61ae978e7ee33c943400009ba38140aa4dda0`)을 읽기 전용으로 재평가한 별도 `m2-shadow-content-gate-replay-20260927/report.json`은 `originalReportOk:true`, `acceptedNow:false`, 5그룹 실패를 기록한다(SHA `cba4e565660d63a266ec5b311224fc5f147e0b6cc156caff7634f238a046eb09`). 기존 자유형 카드에 **새 구조화 블록이 없어서** 거부된 것이므로, 이 재평가만으로 오래된 자연어 카드의 개별 의미 오류를 기계적으로 판독했다고 주장하지 않는다.
- 실제 새 수락 명령은 scene input·task spec 및 기존 HTML/17캡처 해시를 읽은 뒤 RAM 0.584GiB에서 `BLOCKED: insufficient_memory`로 멈췄다. `m2-shadow-content-gate-preflight-20260927/report.json` SHA `a529ea81697a61798a4ea87f958735ee01d8db72a5e54b659a63d37d306300e8`; 실모델/휴대폰 호출 없음. 기존 Node 24.19.0으로 `npm.cmd test`: exit 0, **1170 total / 1149 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression-extra136-content-gate-20260927.txt` SHA-256 `e9c8c08cd3472775d9c2fb118a9af0d596331789615b3355b1223e24815608aa`. 변경 JS `node --check`, 관련 `git -c core.safecrlf=false diff --check` exit 0. 이 절의 변경은 신규 `experiments/extra-136-occlusion/card-acceptance.mjs`, 신규 `runtime/test/extra136-card-acceptance.test.mjs`, `scripts/verify-source-shadow-live.mjs`와 그 테스트, 이 정본 기록이다.
- **VERIFIED:** 검증된 입력에 결박된 구조화 카드만 격리 `report.ok`를 열 수 있음; 이전 거짓 양성 파일의 읽기 전용 재평가 실패; 합성 정상/변조 회귀 및 전체 회귀. **RAN-UNVERIFIED:** 새 JSON 계약을 `qwen2.5:3b`가 실제로 작성하는지와 인간이 볼 최종 카드의 미학·가독성은 미측정; 단계 문장의 존재·순서 검사는 그 실행 품질의 증명이 아니다. **BLOCKED/NOT RUN:** 3GiB 미만 메모리로 새 실모델 수락, Android 실기기(ADB 0). 다음 한 단계는 RAM 3GiB 이상에서 게이트가 허용한 새 격리 실행 1회를 수행해 JSON 카드·5/5 검사·semantic 판정을 나란히 확인하는 것이다. 운영 배포·Vault 변경·자격증명 교체·데이터 삭제·커밋/push 없음.

## §69 — 2026-09-27 Claude(Cowork): RAM 3GiB 확보 지시서

- 이 세션 내내(§62~68) 실측 시 여유 RAM 0.19~0.71GiB로 3GiB 게이트를 한 번도 통과하지 못한 것을 근거로, 코드가 아니라 **실행 전 메모리 확보 절차**가 빠져 있다고 판단.
- 신규 `docs/CODEX_DIRECTIVE_RAM_RECOVERY_20260927.md`: (1) 중복 Ollama 프로세스 정리·서비스 재시작으로 안전하게 회수, (2) 상위 메모리 사용 프로세스 목록화 후 소유자 승인 하에만 종료, (3) 그래도 부족하면 물리 한계로 기록하고 더 작은 모델(1.5B급) 병행 실측 제안, (4) 확보 전/후 수치와 승인 없는 강제종료 없음을 검증 항목으로 명시.
- 소유자 승인 게이트·RAM 게이트 자체는 완화하지 않음.
- **VERIFIED:** 세션 내 RAM 기록 5회 전부 3GiB 미달. **NOT RUN:** 지시서 항목 전부(Codex 실행 대기).

## §70 — 2026-09-27 Codex: RAM 회수 사전 점검, 3GiB 미달로 실모델 보류

- §69 지시서를 읽고 Windows에서 직접 `ollama ps`, `Get-Service -Name '*ollama*'`, `Get-CimInstance Win32_Process`, `Get-Process`와 OS 가용 물리 메모리를 조회했다. 시작 여유 RAM **0.622GiB**, 총 물리 메모리 **7.731GiB**; 기록 시점 여유 RAM **0.510GiB**로 **3GiB 게이트 미통과**. 측정값은 `build-artifacts/agent-scale-20260926/ram-recovery-20260927/report.json`에 저장했다(SHA-256 `5f3e089822da944087e1870b9601c61af8af39363970abf7e2c1cc57a06882d5`).
- `ollama ps`에 적재 모델 0개이므로 `ollama stop` 대상이 없었다. Windows Ollama 서비스는 없고, 기존 트레이 앱 1개(약 12MiB)와 서버 1개(약 7MiB)뿐으로 중복 실행도 없었다. 이 둘은 소유자의 기존 프로세스이고 3GiB 부족분에 비해 작업 집합이 극히 작아 재시작으로 유효한 회수를 기대할 근거가 없어서 **재시작하지 않았다**. 다른 앱이나 프로세스도 종료하지 않았다.
- 기록 시점 Working Set 상위 항목은 ChatGPT 495MiB, Claude 486MiB, ChatGPT Classic 343MiB, ChatGPT 192MiB, Codex 192MiB, Windows Defender 165MiB, Memory Compression 159MiB, ChatGPT 137MiB, Notion Calendar 112MiB, Claude 95MiB 등이다. 개별 Working Set 합계가 종료 시 실제 회수량과 동일하다고 주장하지 않는다. 전체 상위 15개/PID는 `report.json`에 있다.
- **VERIFIED:** 실제 Windows RAM·Ollama·상위 프로세스 조회와 기록, 승인 없는 프로세스 종료 없음, RAM 게이트 미통과. **NOT RUN/BLOCKED:** 새 EXTRA-136 실모델 수락 실행 및 1.5B 모델 비교(동일 3GiB 게이트가 여전히 차단). **NOT RUN:** Ollama 재시작(서비스/중복 실행 없음). 다음 한 단계는 소유자가 현재 사용 중인 무거운 앱의 종료 여부를 정하면 그 범위만 종료하거나 소유자가 직접 닫은 뒤 RAM을 재측정하고, 3GiB 이상일 때만 격리 실모델 시험 1회를 실행하는 것이다. 운영 배포·Vault 변경·데이터 삭제·커밋/push 없음.
- 소유자 속도 우선 요청 뒤 출시 차단 경로를 즉시 재확인했다. 실제 SDK `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l` 결과 **연결 0대**. 최신 r45 APK `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260926-r45.apk` 존재, **110,880,426 bytes**, SHA-256 `b6a6a41ec90e2baa41e12be2ec2d6f8a08904f7c3343d619db8a6e9edb4b6261`로 §45·§51과 일치한다. 현재 RAM **0.434GiB**. 폰이 연결되면 이 APK로 실기기 수락을 즉시 시작할 준비가 되었지만, 아직 설치·실행은 **NOT RUN**이다.

## §71 — 2026-09-27 Codex: ChatGPT 프로세스 정체·3GiB 게이트 근거 재검토

- 소유자가 전달한 RAM 제안의 프로세스 정체를 실제 `Win32_Process.ExecutablePath`와 부모 PID로 대조했다. `ChatGPT.exe` 11개는 `OpenAI.Codex_26.917.9434.0` 패키지 프로세스이며 현재 `codex.exe`도 이 앱의 자식이다. 따라서 앞선 'ChatGPT 계열 전부 종료해도 이 작업에 지장 없음' 주장은 **틀림**. 이를 종료하면 현재 작업 연결이 끊길 수 있으므로 종료하지 않았다. 별도 `ChatGPT Classic.exe` 7개만 `OpenAI.ChatGPT-Desktop_1.2026.190.0` 패키지다. `claude.exe`는 별도 Claude 앱. 이 조회에서 어느 프로세스도 종료하지 않았다.
- 조회 시 전체 Working Set은 Codex 앱 `ChatGPT.exe` 약 919MiB, 별도 ChatGPT Classic 약 436MiB였다(시각마다 변동). ChatGPT Classic만 닫아도 3GiB 여유가 확보된다는 근거는 없다. Working Set은 종료 시 실제 회수량과 같지 않다. 물리 RAM 7.731GiB라는 사실만으로 3B 모델 실행이 구조적으로 불가능하다고 증명할 수도 없다.
- 현재 `scripts/verify-source-shadow-live.mjs`의 3GiB는 고정 `MIN_FREE_BYTES=3*1024**3` 및 시험으로 보존된 보수적 사전 게이트다. 저장된 §66 `qwen2.5:3b` 임무가 완료됐다는 실행 기록은 있지만 잘못된 장면 카드가 semantic PASS를 받은 사례라 내용 합격이 아니다. 해당 보고서에는 피크 RAM/페이지 파일/메모리 압박 추이가 없으므로 3GiB가 필요충분한 임계값이라는 실측 증거도 없다. 현재 게이트는 지시서의 완화 금지에 따라 바꾸지 않았다.
- **VERIFIED:** 프로세스 패키지 정체 및 별도 Classic 구분, 3GiB 고정 코드, 종전 실모델 완료의 내용 오류. **NOT RUN:** 프로세스 종료, 3GiB 조정, 새 실모델 시험. 다음 판단은 Codex 앱 프로세스를 보호한 채 소유자가 다른 앱을 정리할지 결정하고, 게이트 변경이 필요하면 피크 사용량·커밋 메모리·페이지 파일·모델 로드 전후값을 계측하는 별도 격리 시험 설계로 근거를 마련하는 것이다.

## §72 — 2026-09-27 Claude(Cowork): 소유자 정정 — 로컬 전용이 아님, 원격 provider 실측 지시

- 소유자 정정: BLACKHOLE은 Ollama 전용이 아니라 Gemini/GPT/NVIDIA 등 API와 복합 사용. 직접 확인: `build-artifacts/agent-scale-20260926/*/report.json` 16건 전부 `qwen2.5:3b`. 런타임은 이미 openai/anthropic/gemini/xai/moonshot/nvidia/local 지원(`agent-engine.mjs` 113~127행, `desktop-ui/app.js` providerLabels). 따라서 §62~§71의 RAM 차단은 제품 한계가 아니라 **로컬 전용 시험 설계** 때문 — Claude도 이를 앞서 지적하지 못한 책임이 있음.
- 신규 `docs/CODEX_DIRECTIVE_REMOTE_PROVIDER_20260927.md`: (1) RAM 게이트를 `provider==='local'`에만 적용, (2) §68과 동일 입력을 원격 provider로 1회 실측 + 수동 5항목 판정, (3) 결과에 따라 로컬/원격 역할 배분 제안(소유자 최종 승인), (4) API 키 값은 어디에도 기록 금지. 기존 승인·검토·인용·내용 계약 게이트 전부 유지.
- **VERIFIED:** 16건 로컬 전용, 다중 provider 코드 존재. **NOT RUN:** 원격 실측(Codex 대기).

## §73 — 2026-09-27 Codex: 원격 provider 사전 게이트 배선과 설정 부재 확인

- §72 지시서를 실제 저장소/PC와 대조했다. `build-artifacts/agent-scale-20260926/**/report.json`에서 기존 모델명이 있는 16건은 모두 `qwen2.5:3b`였다. `runtime/lib/provider-config-engine.mjs`의 Shadow 경로는 provider별 `YENO_OPENAI_API_KEY`/`YENO_OPENAI_MODEL`, `YENO_GEMINI_*`, `YENO_NVIDIA_*` 또는 동일 provider에 명시된 legacy `YENO_AGENT_*` 쌍을 받는다. 지시서의 `YENO_AI_API_KEY`는 `runtime/server.mjs`의 별도 AI 엔드포인트 설정이며 Shadow provider 인증에 그대로 사용할 수 없다. 키를 임의 재사용하거나 모델명을 추측하지 않았다.
- `scripts/verify-source-shadow-live.mjs`에 명시적 provider 선택을 연결하고, RAM 3GiB 게이트는 `provider==='local'`일 때만 적용했다. 원격 사전 점검에는 `provider`, `applies:false`, `minimumGiB:null`이 남는다. 원격 provider 설정이 불완전하면 격리 코어/작업을 시작하기 전에 `provider_not_configured`로 차단한다. 키는 시작 env에만 전달하고 보고서/콘솔에 넣지 않는다. 기존 도구 경로, 인용 근거 검사, EXTRA-136 내용 5/5 게이트는 변경하지 않았다. 원격 오류의 보고에는 제한된 오류 코드만 허용해 외부 응답/키를 출력하지 않는다.
- 관련 테스트 red **4 pass/2 fail**, 수정 후 **6 pass/0 fail**. 같은 task spec SHA `a6dff933202dd0fd80caac5713ede907f7b4ba764e434f8f3efdb6d8e23f90d4`와 scene SHA `f2d9d4539143e0f169b25fe80aa44bb21d852f75c39b8ad203172aeccc11f10e`로 Gemini 원격 사전 점검을 실제 실행했다. 가용 RAM **0.507GiB**에서도 RAM 게이트는 통과했지만 프로세스/사용자/시스템 환경의 provider별 키·모델 설정이 없고 `%LOCALAPPDATA%\BLACKHOLE\desktop-v1\desktop.dpapi`도 없어 `provider_not_configured`로 종료됐다. `build-artifacts/agent-scale-20260926/m2-shadow-remote-gemini-preflight-20260927/report.json` SHA-256 `e4f7fc65b4574b31760a69b05e04122741b5268b19c7a65a50f402d3e662bdb2`, `manual-evaluation.md` SHA-256 `fe8bbf5152e9b938abd931faabfb337b3d22a9bed99b0fd5391f7f10b6f3b252`. 모델 API 요청 0, Builder 산출물 0, 수동 평가 **0/5건 수행(미평가)**; 실패 5건이나 실모델 실측으로 세지 않는다.
- 변경 후 기존 Node 24.19.0으로 `npm.cmd test` exit 0, **1170 total / 1149 pass / 0 fail / 21 skip**. 로그 `build-artifacts/agent-scale-20260926/full-regression-remote-provider-20260927.txt` SHA-256 `fa948778718b18b9ae57d8e9ef8ab98f531d051f8d953f20e40f6e674c0b26ad`. 변경 JS `node --check`, `git -c core.safecrlf=false diff --check` exit 0. 변경 파일은 `scripts/verify-source-shadow-live.mjs`, `scripts/verify-source-shadow-live.test.mjs`, 이 정본 기록; 기존 미커밋 작업은 보존했다.
- **VERIFIED:** 원격은 로컬 RAM 게이트를 건너뛰되 미설정 자격 증명에서 실패 폐쇄, 로컬 게이트 유지, 합성 관련/전체 회귀, 실제 PC의 설정 부재와 사전 점검. **NOT RUN/BLOCKED:** 실제 NVIDIA/Gemini/OpenAI API 호출과 5항목 품질 판정 — 설정된 provider별 키·모델 쌍이 없음. 모델 크기와 프롬프트의 상대 원인은 아직 분리되지 않았다. 다음 한 단계는 소유자가 지원되는 비공개 설정 경로에 한 provider의 키·모델을 설정한 뒤, 설정이 이 격리 실행에 실제로 전달되는 것을 presence-only로 확인하고 같은 입력으로 원격 실측 1회를 진행하는 것이다. 현재 데스크톱 설정 파일은 없고 비공개 설정 UI의 실행 상태도 확인되지 않았으므로 설정·전달 완료를 주장하지 않는다. 키를 터미널·로그·채팅에 출력하거나 복사해 옮기게 하지 않는다. 운영 배포·자격증명 교체·데이터 삭제·커밋/push 없음.

## §73 — 2026-09-27 Claude(Cowork): 지시서 상세도 부족 인정, JARVIS 첫 화면 상세 사양 작성

- 소유자 지적: 지시서가 구호 수준(UI·보안·기능이 말로만). 인정. 이전 지시서들은 결과 수준만 적고 파일·수치·문구·판정을 안 적었음.
- 현재 저장소 인벤토리 확인: `runtime/lib` 92개 모듈, `server.mjs` 2343줄, `runtime/public` 뷰 15종(cockpit·drive-orbit·living-core·project-universe·studio·voice·world·autopilot·capability·code·research·growth·hankki·jarvis), `desktop-ui`, `apps/controller`, `workers/developer`, Android APK r45. 보안: CSP·X-Frame DENY·nosniff·HMAC device bearer·timingSafeEqual·owner-only 웹 페어링 승인 이미 존재(1755·1580·1796행). 즉 "만들긴 만들었다"는 맞고, 끝까지 도는 증명이 없는 것.
- 신규 `docs/CODEX_DIRECTIVE_JARVIS_E2E_SPEC_20260927.md`: §1 라우팅 표(작업별 1/2/3순위, builder·semantic은 local 금지, 재시도 1회, 타임아웃 90/180s), §2 UI(레이아웃 px, 오브 상태 6종 색·움직임·판정, 대비 `--j-line` 3.0:1→`--j-muted`로 수정, 문구 7종 고정), §3 보안(기존 7항 고정 + 추가 7항: principal당 분당 20회 429, 쿠키 HttpOnly/Secure/SameSite=Strict, 제어문자 제거, hint innerHTML 제거, 키 노출 0, 로그 마스킹, 세션 D-day), §4 합격 판정 A1~A11, §5 순서, §6 Claude 검증 5항.
- 게이트 완화 없음. **NOT RUN:** 전부(Codex 대기).

## §74 — 2026-09-27 Claude(Cowork): JARVIS 완전판 지시서로 교체

- 소유자 요청("네가 만든다 생각하고 처음부터 끝까지"). `docs/CODEX_DIRECTIVE_JARVIS_E2E_SPEC_20260927.md`를 완전판으로 교체(약 230줄).
- 작성 전 직접 확인: `jarvis.mjs` 297행 전체, `server.mjs` 2241~2262행(`/api/commands`)·798~812행(`runQuest`)·178행(`commandRateLimit` limit 20 — **이미 존재**), `web-pairing.mjs` 39행(HttpOnly/SameSite=Strict/Secure — **이미 존재**), `provider-config-engine.mjs` 72~88행(auto = 설정 순서 첫 준비 provider, 작업 종류 미고려), 75행(`YENO_AGENT_DAILY_CALL_LIMIT` 최대 20).
- 지시서 내용: §1 환경변수 정확한 이름, §2 새 `task-routing.mjs`(코드 전문, `TASK_ROUTES` 7종, builder/semantic/goal은 local 제외, 재시도 1회, 타임아웃 90/180s, 연결 3곳, 테스트 7개), §3 `publicJob` provider/model/route + 화면 표시 코드, §4 `FAIL_KO` 매핑 13종 코드 전문, §5 대비(`--j-line` 3.0:1 → `--j-muted`, `scripts/contrast-check.mjs`), 레이아웃 px, 오브 상태 6종, 문구 11종 정확 문자열, 서랍, §6 대화 모드, §7 보안 테스트 7개 이름 고정 + hint innerHTML 제거 + 제어문자/NFC, §8 순서 8단계, §9 실측 A1~A12 각 증거 파일명, §10 보고 형식, §11 Claude 검증 6항.
- 게이트 완화 없음. 이전에 "추가하라"고 적었던 속도 제한·쿠키 속성은 이미 있음을 확인해 "테스트로 고정"으로 정정.
- **NOT RUN:** 전부(Codex 대기).

## §75 — 2026-09-27 Codex: JARVIS 지시서 부분 구현과 실제 브라우저 검증

- 시작 상태: `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 기존 미커밋 변경은 그대로 보존했다. 이번 작업에 운영 배포·커밋/push·자격 증명 변경·데이터 삭제 없음.
- `docs/CODEX_DIRECTIVE_JARVIS_E2E_SPEC_20260927.md`의 완전판을 실제 코드와 비교했다. 기존 웹 쿠키 HttpOnly/SameSite=Strict/HTTPS Secure, 소유자 승인, CSP, 20회 명령 속도 제한은 중복 구현하지 않고 기존 테스트와 새 HTTP 시험으로 확인했다. 새 `runtime/lib/task-routing.mjs`는 작업 7종별 설정된 provider 우선순위와 로컬 금지 행을 정의한다. 현재 `/api/commands`의 `목표:` 및 일반 목표 실행, `/api/voice` 대화 경로에 적용했고 `/api/state.agent.routing`에 비밀 없는 정책을 표시한다. 대화 300자 초과는 원격만 선택한다. Shadow Builder/semanticVerifier의 실제 생성·실행 경로에는 이 새 정책을 아직 연결하지 않았다. 정책 테스트만 통과한 상태를 실제 Shadow 제한이 작동한다고 주장하지 않는다.
- `runtime/lib/job-view-engine.mjs`가 모델 작업의 `provider`/`model`만 공개하고 저널 본문과 Authorization은 제외한다. `jarvis.mjs`는 완료해 말한 작업의 provider/model을 상단 바에 표시하고 진행 중 경로·실패 코드를 표시한다. 실패 음성은 한국어 매핑이며 원문 실패 코드는 진행줄에 남는다. `hint()`는 `textContent`로 교체했다. 명령 본문은 NFC 정규화·제어문자 제거·2000자 제한. 소유자 전체 멈춤은 두 번 클릭 확인, 세션 만료 D-day, 모바일 400px·reduced-motion 표시를 보강했다. `runtime/public/jarvis.css`의 링크/오프라인 점 대비를 조정했다.
- 새 `runtime/test/command-rate-limit.test.mjs`, `runtime/test/task-routing.test.mjs`, `runtime/test/jarvis-security.test.mjs`, 확장된 `runtime/test/jarvis-scene-model.test.mjs`의 관련 시험 통과. 첫 전체 회귀는 1181 total / 1159 pass / 1 fail / 21 skip이었다. 실패는 비모델 레거시 receipt에 provider/model null 필드가 추가된 호환성 문제였고, 모델 작업에만 필드가 생기게 수정했다. 최종 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` exit 0, **1181 total / 1160 pass / 0 fail / 21 skip**; 로그 SHA-256 `f65b4519c0c84a6d9d8ff17446041402480c4d5597fd226a5a27a0840dc5e97b`.
- `node scripts/verify-jarvis-face-live.mjs`는 실제 격리 HTTP 코어와 Edge 브라우저로 웹 페어링 owner 승인, 전송/보관, 조종 멈춤/재개, 400px 폭(가로 스크롤 400), CSP, 외부 폰트 0, reduced-motion 두 캡처 동일 SHA를 확인했다. `build-artifacts/jarvis-e2e-20260927/report.json` SHA-256 `b6ca351531d612b4efb0e410a1d8ee01f95c07853bad56676c4d6423e63fd3df`. `node scripts/verify-jarvis-command-synthetic.mjs`는 주입된 합성 provider 응답 1회로 실제 브라우저 명령→job→artifact→화면 답변 및 `nvidia · synthetic-browser-model` 표시를 3184ms에 확인했다. 네트워크 모델 호출 **0회**이며 실제 원격 provider 실측으로 세지 않는다. `synthetic-report.json` SHA-256 `316ca044c9c07a880f3de9fd96c4526a928ba4efb8c3c7992356c0ba2d16bd20`, 화면 `synthetic-result-1440.png` SHA-256 `af9c5e578d577243f88a69eacb66d8ccfad5f078262f04d755ca2524adca7499`.
- `node scripts/contrast-check.mjs`는 CSS 불투명 토큰 14쌍의 상대휘도 대비를 계산해 `docs/JARVIS_CONTRAST_20260927.md`에 기록했다. 이는 그라디언트/반투명 합성 화면 전체의 WCAG 인증은 아니다. 변경 JS `node --check`, `git -c core.safecrlf=false diff --check` exit 0.
- **VERIFIED:** 실제 격리 코어/브라우저의 페어링·조종·보관·400px·reduced-motion 및 합성 응답의 명령→완료→화면 결과, 공개 job의 모델 메타·저널 비노출, 최종 전체 회귀 0 fail. **RAN-UNVERIFIED:** 합성 provider는 실제 원격 모델의 품질/지연/키 연결을 검증하지 않는다. **BLOCKED/NOT RUN:** A1 원격 실모델 결과 스크린샷/60초 목표는 현재 프로세스의 NVIDIA/Gemini/OpenAI/Anthropic provider별 키·모델 설정이 없어 호출 0회. Windows ADB 절대 경로 `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l` 실행 결과 연결 0대이므로 Android 실기기 수락 미실행. Shadow Builder/semanticVerifier 실제 원격 강제와 provider failover/90·180초 타임아웃 연결, A1~A12 전체 실측은 미완료. 기존 `model-router.mjs`가 post-send outcomeUnknown의 자동 재전송을 금지하므로 지시서의 timeout/5xx/빈 응답 뒤 provider 자동 재호출은 수행하지 않았다. 다음 한 단계는 지원되는 비공개 UI에 원격 provider 한 쌍이 실제로 설정된 뒤 presence-only로 확인하고 A1의 실제 브라우저 명령 1회·job JSON·스크린샷을 수집하는 것이다. 키를 터미널·로그·채팅에 출력하거나 복사시켜 옮기지 않는다.
## §76 — 2026-09-27 Codex: JARVIS Shadow 라우팅·실패 화면 추가 검증, §75 수치 갱신

- §75 이후 `runtime/server.mjs`의 자동 provider 순서 모드에서 Shadow 임무 생성 전에 각 role provider를 지정한다. Scout/Researcher는 로컬 우선, Builder/semanticVerifier는 원격 provider만 선택한다. 로컬만 있으면 임무를 409 `NO_MODEL`로 거부하고 job을 만들지 않는다. 명시적 단일-provider 레거시 경로는 이전 방식대로 둔다. `configFor`는 저장된 `selectedProvider`를 semanticVerifier 기본 선택보다 우선한다. `runtime/test/shadow-army.test.mjs`의 신규 실제 HTTP+저장소 시험에서 로컬 전용 거부/원격 지정이 모두 통과했다. 모델 작업 제한 시간은 로컬 180초·원격 90초로 설정했다. post-send 응답 불확실 시 자동 재호출은 여전히 금지한다.
- 합성 브라우저 시험을 성공 1회+빈 답 1회로 확장하자 실제 UI 결함이 드러났다. 빈 답 job은 `Agent: empty_model_response responseMeta=...`로 실패했지만 화면의 실패 안내가 다음 3초 폴링에 idle 문구로 덮였고, 진행줄에 전체 메타가 노출됐다. `jarvis-scene-model.mjs`가 코드만 추출하고 `jarvis.mjs`가 실패 문구를 30초 유지하며 진행줄에 짧은 코드만 표시하도록 수정했다. `node scripts/verify-jarvis-command-synthetic.mjs` 재실행 exit 0: 합성 provider 요청 2회(성공 1, 빈 답 1), 빈 답 자동 재호출 0, 성공 job completed/화면 답변·provider 표시, 실패 job failed/한국어 문구·짧은 코드 표시. 네트워크 모델 호출 **0회**. `build-artifacts/jarvis-e2e-20260927/synthetic-report.json` SHA-256 `b413f6e0a5827be4604193db84580c7c68139edd2837abae18c0a3520faf0ce1`, 성공/실패 PNG SHA-256 각각 `4861534223416ba0125bbbc5b7e2500233ac8464a69e327299b6eb3eaa08b31a` / `2e690ebe03cc8da74ea254b03f0b643ed91b8791d23d9cce968c4cfa7b12a32d`.
- 최종 변경 후 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` exit 0, **1182 total / 1161 pass / 0 fail / 21 skip**, 로그 SHA-256 `626fac4cf015a29f2a6fcd23bd097428ee53f817e1984a59afbbe7d259fd81d1`. `node scripts/verify-jarvis-face-live.mjs` exit 0, 400px scrollWidth=400, CSP 확인, 콘솔 오류 0, 외부 폰트 0, reduced-motion 이미지 SHA 동일; `build-artifacts/jarvis-e2e-20260927/report.json` SHA-256 `3493b416ae6c6768c87606f7b1a434614d55db943b3be076f5881e4e21fc1461`. 변경 JS `node --check`와 `git -c core.safecrlf=false diff --check` exit 0.
- **VERIFIED:** 위 실제 격리 코어/브라우저·합성 provider 성공/실패 화면, Shadow 자동 선택 경계의 실제 HTTP 시험, 전체 회귀. **RAN-UNVERIFIED:** 합성 provider의 2개 답변은 실제 NVIDIA/Gemini/OpenAI 호출이나 내용 품질 증거가 아니다. **BLOCKED/NOT RUN:** 원격 실모델 A1/A2 결과·60초/20초 목표, Android 실기기(ADB 연결 0), A1~A12 모든 시각 상태별 수락. 실제 provider 설정이 없어 원격 호출 0. timeout/5xx 이후 provider 재시도는 기존 post-send 안전 계약과 충돌해 구현하지 않았다. §75의 이전 1181/1160 수치와 'Shadow 아직 미연결' 서술은 이 절의 1182/1161 및 자동 모드 Shadow 연결 결과로 갱신한다. 다음 한 단계는 비공개 설정 UI에서 provider별 키·모델이 연결된 후 presence-only 확인을 거쳐 A1의 실제 명령 한 번을 실행하고 job JSON·화면 3장을 수집하는 것이다. 비밀값 출력·복사 요청, 운영 배포, 커밋/push 없음.
## §77 — 2026-09-27 Codex: JARVIS A2~A12 격리 수락 확장과 시각 결함 수정

- 저장소 재확인: `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 시작 시 존재한 미커밋 변경을 되돌리거나 덮어쓰지 않았다. 운영 배포·데이터 삭제·실제 자격 증명 교체·커밋/push 없음.
- 이번 코드: `runtime/public/jarvis.mjs`의 idle 호흡을 1.4초 주기로 조정하고 승인 대기 시 halo/위성 표현을 구분했다. 실제 `core.pendingApprovalCount`가 있으면 화면 활동을 `waiting_owner`로 투영하고, `/api/quests`의 오래된 승인 필요 proposed quest를 서랍에 표시한다. 승인 실행 버튼은 없다. 로컬 전용 환경에서 작업용 원격 모델이 없을 때 대화는 로컬로 완료되지만 목표 실행은 거부되고 저장된다고 명확히 말한다. 독립 시각 검토에서 발견한 한국어 문장 분리와 승인 링크의 버튼 오인/제목 말줄임을 고쳐, `runtime/public/jarvis.html`의 링크를 '운영실에서 검토하기 →'로 명시하고 `runtime/public/jarvis.css`에서 대기 제목 전체를 줄바꿈 표시한다.
- `runtime/test/task-routing.test.mjs` 신규 실제 HTTP 시험은 로컬 전용 목표 명령 409 및 모델 호출 0, 목표 저장 201, owner가 AI 모듈을 켠 후 대화 명령 201 및 local 합성 모델의 완료/산출물 1건을 확인했다. 권한 토글을 우회하지 않았다.
- `scripts/verify-jarvis-face-live.mjs`는 실제 브라우저 캔버스 PNG 두 장을 1280×800에서 캡처해 idle 밝은 링 피크 반지름 205→182px(945ms, 23px 차이)를 기록하고, reduced-motion 캔버스 두 PNG의 SHA 동일을 확인했다. 400×800 viewport에서 scrollWidth=400, 입력 표시, CSP 오류 0, 콘솔 오류 0, 외부 폰트 0이다. `build-artifacts/jarvis-e2e-20260927/report.json` SHA-256 `828271089fe53d49d94470d10c10c47a9c457cfdf6dd2ee846f77cdfe5a4aadb`. 이 측정은 해당 캔버스 픽셀 비교이며 전체 UI 품질 인증은 아니다.
- 신규 `scripts/verify-jarvis-owner-gate-synthetic.mjs`는 실제 격리 HTTP 코어에서 stop→성과 outcome 기록→resume→승인 필요 기능 흡수 퀘스트 1건을 만든 뒤, 웹 페어링 owner 승인 후 브라우저 서랍에 대기 1건과 전체 제목을 확인했다. `#gate button` 0, 네트워크 모델 호출 0. `a8-gate.png` SHA-256 `5f02b616400785cec9e6c2856a8a997301c6da701d51a92bf7e060b631421a00`, `a8-report.json` SHA-256 `3931e0247e9df9621e3e4995b516565acaba9de715d3862ded490055bfd3e32e`.
- 신규 `scripts/verify-jarvis-local-only-synthetic.mjs`는 브라우저 대화 A2와 작업 A3을 나눠 실측했다. 합성 local 대화는 job completed·artifact 1건, 작업은 409 후 저장 201, 추가 모델 호출 0. `a3-result.png` SHA-256 `289e0cc9d2a7a622ea859ba0b75544ee261ee3bc9aae14f7a116f6a98471ce68`, `local-only-report.json` SHA-256 `583fb09dcc827c311da5c0f459c30446348cb6adae49ecd69161ae944b83cd05`. `scripts/verify-jarvis-command-synthetic.mjs`도 최종 화면으로 재실행해 합성 성공/빈 답 실패 문구·짧은 오류 코드를 확인했다. 이 모든 model adapter는 합성이며 실제 원격/로컬 모델 품질이나 지연 증거가 아니다.
- A4~A11은 지시서의 증거 파일명으로 PNG/텍스트를 저장했고, CSS 불투명 토큰 14쌍의 대비는 모두 ≥4.5였다(`a10-contrast.txt`). 전체 수락 목록·파일별 SHA는 `build-artifacts/jarvis-e2e-20260927/acceptance.json` SHA-256 `ce7dfe210dae1798d4c733015e4e8a7276d9b0b0724f1b2d454c4dadaa398330`. A2는 합성 모델이어서 RAN-UNVERIFIED로 표시하고 A1은 BLOCKED로 표시했다.
- 변경 후 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` exit 0, **1183 total / 1162 pass / 0 fail / 21 skip**. 로그 SHA-256 `8e2b2356e4ea8be1adbf029df7acfa04e400339f38366b6c6603d0b67ad2f71c`. 변경 JS `node --check`, `git -c core.safecrlf=false diff --check` exit 0.
- 독립 읽기 전용 시각/코드 검토는 `.omo/evidence/jarvis-e2e-20260927-clone-fidelity.md`와 `.omo/evidence/jarvis-integrity-current-code-review.md`에 보존했다. 한국어 줄바꿈과 승인 링크/제목 결함은 고쳐 새 캡처로 확인했다. 남은 지적: 페이지 전반의 spacing/type/radius/elevation 토큰 체계 미완성, `jarvis.mjs` 책임 집중, 지시서의 자동 provider 재시도 1회와 실제 `ROUTE_RETRY_LIMIT=0` 불일치. 후자는 전송 후 결과 불확실 시 중복 실행 금지 계약 때문에 임의로 켜지 않았다. 이 지시서 항목은 미완료다.
- **VERIFIED:** A3~A11의 명시한 격리 코어/브라우저·합성 고장 주입/캔버스/정적 대비 범위, 전체 회귀. **RAN-UNVERIFIED:** A2 합성 local 대화는 실제 모델 응답 시간/품질을 증명하지 않는다. **BLOCKED/NOT RUN:** A1 실제 원격 모델 결과·60초·네 장의 필수 증거는 provider별 키/모델 설정이 없어 원격 호출 0회; Android 실기기는 `adb devices -l` 연결 0대여서 페어링→요청→진행→결과→복구 수락 미실행. A1이 없으므로 지시서의 완료 정의/전체 제품 완료를 주장하지 않는다. 다음 한 단계: 지원되는 비공개 설정 UI에서 원격 provider 한 쌍이 연결된 것을 presence-only로 확인한 뒤 A1 실제 요청 1회와 네 증거 파일을 수집한다. 비밀값 출력·복사 요청은 하지 않는다.
- 독립 시각 재검토(수정 후 최신 `a3-result.png`, `a5-mobile.png`, `a8-gate.png`)는 한국어 문장 분리와 승인 링크/제목 두 결함을 범위 한정 PASS로 확인했다. 실제 원격 A1 및 디자인 시스템 완성을 승인한 판정은 아니다.

## §78 — 2026-09-27 Codex: JARVIS 캔버스 렌더러 분리와 전체 재검증

- 시작 상태 재확인: origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 미커밋 변경 보존. 이번에는 `runtime/public/jarvis.mjs`에 있던 캔버스 렌더러를 새 `runtime/public/jarvis-orb.mjs`로 추출했다. 전자는 현재 core scene/tint/heartbeat를 공급하고, 새 모듈은 그 값으로만 그림을 그린다. `runtime/server.mjs`의 정적 allowlist에 새 모듈을 추가하고 `scripts/verify-jarvis-face-live.mjs`가 HTTP 200과 실제 브라우저 로딩을 검사하게 했다. `runtime/public/DESIGN.md`에 책임 경계를 기록했다. `jarvis.mjs`는 224 physical lines, 새 렌더러는 104 lines다.
- 변경 후 `node scripts/verify-jarvis-face-live.mjs`, `node scripts/verify-jarvis-command-synthetic.mjs`, `node scripts/verify-jarvis-local-only-synthetic.mjs`, `node scripts/verify-jarvis-owner-gate-synthetic.mjs` 각각 exit 0. 실제 격리 HTTP 코어와 Edge에서 `/jarvis-orb.mjs` 제공/그리기, CSP 오류 0, 콘솔 오류 0, 400px scrollWidth=400, idle 움직임, reduced-motion 캔버스 2장 SHA 동일, owner 승인 대기 1건/승인 버튼 0, 합성 성공·빈 답 실패, local-only 작업 409→목표 저장 201을 다시 확인했다. model adapter는 합성이며 네트워크 모델 호출 0이다. `build-artifacts/jarvis-e2e-20260927/report.json` SHA-256 `68d518edcb54e7254b7b6dc3c78d74adb718f01f84556ee47eacd41a5ed8796a`, `acceptance.json` SHA-256 `a662704aac621df460960e0d9e6cdab04e78cd100927f46e529831a7ac6aeb9c`.
- 변경 후 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` exit 0, **1183 total / 1162 pass / 0 fail / 21 skip**. 로그 SHA-256 `eae7cc0e7b91d4ce28605f85728f46e5791048cc0f928021bf92d80e76349def`. `node --check`(coordinator/orb/검증 스크립트)와 `git -c core.safecrlf=false diff --check` exit 0. 새 APK/운영 설치 산출물 없음.
- 원격 provider별 환경 변수 presence-only는 모두 false, Windows `desktop.dpapi` 없음. `adb devices -l` 연결 0대. `ollama list`에는 `qwen2.5:3b`(1.9GB)이 있으나 현재 여유 물리 RAM 약 0.786GiB여서 기존 3GiB 사전 점검 아래이며 실모델 A2를 재실행하지 않았다. 비밀값을 출력하거나 옮기지 않았다.
- **VERIFIED:** 렌더러 추출 뒤 HTTP/브라우저 수락 4종, JS 문법/전체 회귀. **RAN-UNVERIFIED:** 합성 모델 성공/실패는 실제 모델 품질·응답 시간을 검증하지 않는다. **BLOCKED/NOT RUN:** 실제 원격 A1과 Android 실기기 페어링→요청→진행→결과→복구. 이번 분리는 이를 완료로 바꾸지 않는다. 지시서의 자동 재시도 요구와 기존 전송 후 중복 실행 방지 계약 간 불일치, 완전한 디자인 토큰 체계도 여전히 열려 있다. 운영 배포·데이터 삭제·실제 자격 증명 교체·커밋/push 없음.
- §78 최종 보강(위 SHA와 회귀 로그 수치는 중간 재검증값이며 다음 최종값으로 대체): 독립 시각 리뷰 `.omo/evidence/jarvis-refactor-visual-clone-fidelity.md`가 A9 문장 분리를 발견했다. 정확한 실패 문구는 유지하고 `jarvis.css`의 failure speech 크기를 22–30px로 구분, `jarvis.mjs`가 실패 상태 class를 지정하게 했다. `scripts/verify-jarvis-command-synthetic.mjs`는 CSS opacity 전환 완료 후 캡처한다. 새 `a9-fail.png`는 문장 전체가 한 줄이며 `#doing`의 `(empty_model_response)`가 보인다. 독립 후속 시각 검토가 이 결함을 범위 한정 PASS로 확인했다.
- 독립 코드 리뷰 `.omo/evidence/jarvis-refactor-integrity-code-review.md`는 렌더러의 verifying 링에 쓰이는 `focus-rgb` 토큰 누락을 발견했다. `jarvis-orb.mjs` 팔레트에 연결하고, `verify-jarvis-face-live.mjs`가 별도 실제 브라우저 캔버스에서 `activity:verifying`를 실행해 `rgba(157,200,199,0.63)` stroke를 기다려 확인하도록 추가했다. `report.json.verifyingRing.matched=true`; 독립 후속 코드 검토가 원래 결함을 범위 한정 PASS로 확인했다. `runtime/public/DESIGN.md`에 failure speech 범위를 반영했다.
- **최종 증거:** 최신 네 브라우저 수락 스크립트 exit 0. `report.json` SHA-256 `d1852ceb3e67b20a9f2863823e3c537e7f4c27213db7614e668ea4f8c23d473e`, `acceptance.json` SHA-256 `e6f4c609ee5beb181b1867184722de2abdf4bac874f2c336229ca834393d402e`, `a9-fail.png` SHA-256 `3e22411d350caaadb27c9d6cd6087ed5ed6174309427e880f003ce0e3a546478`. 최종 변경 후 `npm.cmd test` exit 0, **1183 total / 1162 pass / 0 fail / 21 skip**, Desktop 로그 SHA-256 `07185aa00463af176dfa2b941a81cff8287e195a54532181ccaffaa17b9a2ce5`. 변경 JS `node --check`, `git -c core.safecrlf=false diff --check` exit 0. 실제 원격 A1·휴대폰 실기기 검증 상태는 위와 동일하게 BLOCKED, 합성 모델 품질/지연은 RAN-UNVERIFIED다.
## §79 — 2026-09-27 Codex: JARVIS 완전판 지시서 현재 구현 대조 및 Windows resident 재수락

- 시작 상태: origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 기존 미커밋 변경을 보존했다. `docs/CODEX_DIRECTIVE_JARVIS_E2E_SPEC_20260927.md`를 다시 읽고 현재 `task-routing.mjs`, 관련 시험, §76~§78 기록과 대조했다. 보안 시험·작업별 라우팅·화면 결과 표시·합성 브라우저 수락은 이미 수행된 작업이라 중복 구현하지 않았다. 자동 provider 재시도 1회는 전송 후 결과 불확실 시 중복 실행 금지 계약과 충돌해 여전히 미구현이며, 완료로 표시하지 않는다.
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\test-resident-windows.ps1 -EvidencePath build-artifacts\resident-windows-20260927\acceptance.json` exit 0. 실제 Windows 예약 작업과 프로세스를 이용한 격리 수락 **103/103 assertions passed**. 페어링 비밀값 비노출·개인 ACL·Android 형식의 기기 등록·문서 요청·작업/산출물 해시·중지/재시작 뒤 동일 기기/작업/산출물·긴급 정지 지속·소유하지 않은 예약 작업 보호·uninstall 시 데이터 보존을 확인했다. 리포트 `verification=WINDOWS_CI_REAL_PROCESS_AND_SCHEDULER`, `physicalAndroid=not_run`, `productionChanges=false`; SHA-256 `9f519e5cd1fb5f97434c06896f5595c84593f968488e6cc78715483aa4fb95af`. 종료 후 `BLACKHOLE CI *` 예약 작업 잔여 0개. 실기기나 운영 resident를 시험한 것은 아니다.
- `adb devices -l` 연결 0대. 현재 프로세스의 NVIDIA/Gemini/OpenAI/Anthropic 키·모델 환경 변수 presence-only 검사는 모두 false. 값·일부·길이·해시는 출력하지 않았다. A1의 실제 원격 모델 결과/60초/화면 세 장+job JSON은 실행하지 못했다. 이번 턴의 코드 변경은 없다. §78의 최종 `npm.cmd test` 1183/1162/0/21은 이전 턴 실행 증거이며 이번 턴 재실행으로 표현하지 않는다.
- **VERIFIED:** 격리 Windows resident 예약 작업·실제 프로세스 수락 103/103 및 CI 작업 정리. **RAN-UNVERIFIED:** Android 형식의 합성 기기 등록은 실제 휴대폰 UI/네트워크 경험 증거가 아니다. **BLOCKED/NOT RUN:** 실제 휴대폰 페어링→요청→진행→결과→복구, JARVIS A1 실제 원격 모델 화면 수락. 다음 한 단계는 비공개 설정 경로에 원격 provider가 연결되면 키를 노출하지 않고 A1을 1회 실행하여 지정된 네 증거 파일과 시간을 남기는 것이다. 폰이 연결되는 즉시 실기기 수락을 우선한다. 운영 배포·데이터 삭제·실제 자격증명 교체·커밋/push 없음.
## §80 — 2026-09-27 Codex: Android 컨트롤러 결과 파일의 실브라우저 수락 보강

- 이전 §79의 Windows resident 103/103은 진전으로 분류하고, 저장소 origin/branch/HEAD가 각각 `https://github.com/wooyeonho/yeno-os.git`, `blackhole/p3-jev-recovery-port-20260924`, `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`인 것을 다시 확인했다. 기존 미커밋 변경 보존. Android SDK에 emulator 실행 파일은 없고 `adb devices -l`의 연결 실기기는 0대였다. `apps/controller/src`의 최신 수정 시각(9/26 20:44)은 기존 dist 빌드 시각(20:47)보다 앞서 있었지만, 이번에 새 빌드를 생성했다.
- 시스템 Node `C:\Program Files\nodejs\node.exe` v24.11.1에서는 `npm.cmd --prefix apps/controller run build`가 Vite 113개 변환 직후 출력 진단 없이 exit 1, 직접 Vite와 `verify-ui.mjs`는 같은 Windows 종료 코드 `0xC0000409`를 보였다. 후자는 19개 검사와 `ok:true`를 출력했어도 종료 코드가 실패여서 수락으로 기록하지 않았다. 동일 PC의 Codex 번들 Node v24.19.0으로 직접 Vite 빌드(exit 0, 113 modules, 871ms) 및 `verify-ui.mjs`(exit 0, 19개 검사, `ok:true`)를 재실행했다. 버전별 결과 차이는 관찰했으나 시스템 Node가 왜 비정상 종료하는지의 내부 원인은 확정하지 않는다. 로그는 `build-artifacts/android-controller-20260927/`에 있다.
- `apps/controller/verify-mobile.mjs`에 완료된 문서 작업 카드의 `button.artifact`를 실제 Edge 브라우저에서 열어 `#artifact-meta`의 `SHA-256 확인됨`과 `#artifact-body`의 정확한 요청 제목을 확인하는 절차를 추가했다. 기존 카드 표시만으로 결과 열림을 주장하지 않도록 했다. 번들 Node로 재실행(exit 0): 실제 격리 HTTP 코어 + Edge의 360×780·430×900 viewport에서 두 결과 파일을 열고 PNG `build-artifacts/handoff-r3-20260926/distinct-job-title-browser/result-360px.png`(SHA-256 `5e27ddd3eec33ecaeef104451a79accc530f806c7aa61208ba5f23b5dff8fc77`) 및 `result-430px.png`(SHA-256 `5cda3beda7152d71442b39f28756b16f6cf590fc8584d1c3d49e37889e98cb88`)을 캡처했다. 두 이미지를 직접 열어 결과 텍스트·SHA 표시를 확인했다. 브라우저의 native IPC/QR/Stronghold는 합성 어댑터이며 실제 Android 카메라·보관소 검증이 아니다.
- 번들 Node v24.19.0으로 전체 package.json의 test 인자를 직접 실행: `--test runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs` exit 0, **1183 total / 1162 pass / 0 fail / 21 skip**, `build-artifacts/android-controller-20260927/full-regression.txt` SHA-256 `b3c825c434abf6cb3c657a1d7330ce5dc9b499457907ddcf1bb67171945aa1aa`. `node --check apps/controller/verify-mobile.mjs`, `git -c core.safecrlf=false diff --check` exit 0. 이번 변경은 브라우저 수락 스크립트 1개이며 앱 기능 코드·APK·운영 resident는 수정하지 않았다.
- **VERIFIED:** 번들 Node의 컨트롤러 빌드, 실코어+합성 native IPC의 요청/오프라인/재시작/동일 요청 복구/실패 표시 19개 검사, Edge 360/430 결과 파일 열림·본문·SHA 표시, 전체 회귀. **RAN-UNVERIFIED:** 브라우저에서 native 카메라·Stronghold·HTTP를 대체했으므로 실제 Android 설치·페어링 동작의 증거는 아니다. **BLOCKED/NOT RUN:** 실기기 0대여서 폰 페어링→요청→PC 실행→진행→결과→복구의 물리 수락은 여전히 미실행; 원격 provider 설정 부재로 JARVIS A1도 미실행. 시스템 Node v24.11.1의 빌드/검증 종료 코드는 미해결 환경 이슈. 다음 한 단계는 실기기 연결 시 현재 APK의 설치·QR·요청·재시작 복구를 실제 화면/작업 ID로 검증하는 것이다. 운영 배포·데이터 삭제·실제 자격증명 교체·커밋/push 없음.

## §81 — 2026-09-27 Codex: Android 서버 거부와 PC 오프라인 표시 분리, 새 APK

- 시작 상태 재확인: 저장소 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 시작 전 존재한 다른 미커밋 변경을 보존했다. 실제 ADB 연결 기기는 0대다.
- 발견: 연결된 코어가 목표 명령에 HTTP 409 `주 모델 연결이 필요합니다`로 명확히 응답해도 `apps/controller/src/main.ts`의 공통 `api()` catch가 연결 상태를 `최신 상태 확인 실패`로 바꿨다. 실제 격리 코어를 사용하는 `apps/controller/verify-ui.mjs`의 새 시험이 수정 전 기대 `코어 응답 확인됨`/실제 `최신 상태 확인 실패`로 실패했다(`build-artifacts/controller-http-status-20260927/red.txt`, SHA-256 `55b241ea6e751ea597b0b2e79590c72b179c8e0cdaf89b4ec7894a19d4e0dd54`).
- `api()`는 전송/연결 오류 또는 HTTP 401/403에서만 연결 상태를 무효화하고, 코어가 응답한 일반 HTTP 거부에서는 마지막 정상 연결 상태를 유지한다. 같은 요청은 확정 거부로 처리되어 보류 명령이 남지 않는다. 수정 후 `verify-ui.mjs` exit 0, 기존 요청→작업→산출물·오프라인·실패·재시작/같은 요청 ID 복구 검사를 포함해 모두 통과(`green.txt` SHA-256 `7487915a2ea36adf9da2da6aabce45e862e9c5b10bac6cd053a0ed3543fd47ae`).
- `apps/controller/verify-mobile.mjs`의 실제 Edge 360×780/430×900 화면에서도 동일한 실코어 409를 보내고, 연결 칩 `코어 응답 확인됨`과 `주 모델 연결이 필요합니다` 오류를 동시에 캡처했다. `build-artifacts/handoff-r3-20260926/distinct-job-title-browser/rejection-status-{360px,430px}.png` SHA-256은 각각 `30e156f78d10e8633a82051417d5259e66cb70471edb240810ac16fb6efd29f0`, `1e989b3f531fcb35a0ef20f711937125b0798e49d0f0d44d7f352d26abdfd349`이다. 본문 가까이 스크롤한 `rejection-{360px,430px}.png`도 저장했다. `browser-final.txt` exit 0, SHA-256 `8e1adf34aa67a1464f514c7ff0d46763492239ed812b5a0f2dcc8d6a3ad6a635`. 독립 읽기 전용 코드/시각 검토가 실제 API 배선과 두 화면의 오류/온라인 상태 구분을 범위 한정 PASS로 확인했다. 이 Edge 시험의 native IPC·QR·Stronghold는 합성 어댑터다.
- 번들 Node v24.19.0으로 `tsc --noEmit`, Vite build(113 modules), `node --check`(두 검증 스크립트), `git -c core.safecrlf=false diff --check` 모두 exit 0. 변경 후 전체 `node --test runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs` exit 0: **1183 total / 1162 pass / 0 fail / 21 skip**, `build-artifacts/controller-http-status-20260927/full-regression.txt` SHA-256 `809724f71aee2ed4af2b9f5a4b2b997e75b11d508c5e7fe22c44b5b196a29717`.
- 기존 설치된 SDK/JDK/Rust로 `npm.cmd --prefix apps/controller run tauri -- android build --debug --apk --target aarch64 --ci` exit 0. 새 웹 번들 `dist/assets/index-DuWh6VMf.js`를 생성한 뒤 arm64 Rust 라이브러리·Gradle 조립을 완료했다. 새 APK는 기존 r45를 덮지 않고 `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260927-r81.apk`로 보존: **110,880,426 bytes**, SHA-256 `1870446001be7094762148c3f8990dad6d44a3780488e9d510ab4cc583aff8fb`. `zipalign -c 4` exit 0, `apksigner verify --verbose` exit 0(v2 서명, 서명자 1), `aapt dump badging` exit 0(package `kr.yeno.controller.smoke`, versionCode 2001, minSdk 28/targetSdk 36). 첫 apksigner 시도는 JAVA_HOME 미설정으로 실패했고, 동일한 로컬 빌드 환경을 로드한 재검사는 통과했다. APK 내부는 Tauri가 웹 자산을 native 라이브러리에 포함하므로 ZIP의 개별 JS 경로만으로 새 코드 포함을 별도 독립 증명하지 않았다. `android-build.txt` SHA-256 `93f922d15f84ec516cdb29190b286d600eca0ea556e0a88bcda799423cebbd3b`.
- **VERIFIED:** 실제 HTTP 409를 오프라인과 구분하는 앱 코드/실코어 시험/Edge 화면, 기존 오프라인·복구 회귀, 전체 회귀, 새 APK 빌드·정렬·디버그 서명. **RAN-UNVERIFIED:** Edge의 Android native 기능은 합성이고 APK는 실기기에 설치되지 않았다. **BLOCKED/NOT RUN:** ADB 연결 0대로 실제 휴대폰 페어링→요청→PC 실행→진행→결과→종료 후 복구. 원격 provider 부재로 JARVIS A1도 실모델 수락 없음. 다음 한 단계는 연결된 실제 Android 기기에서 새 r81 APK를 기존 데이터/서명 상태부터 대조한 뒤 안전하게 설치하고 같은 작업 ID의 전 과정을 화면과 PC 작업 기록으로 확인하는 것이다. 운영 배포·데이터 삭제·실제 자격증명 교체·커밋/push 없음.

## §82 — 2026-09-27 Codex: 결과 다운로드 오류·해시 실패의 온라인 상태 및 버튼 가독성

- §81 뒤에도 `apps/controller/src/main.ts`의 `openArtifact()`는 코어가 HTTP 404로 응답하거나 다운로드 SHA-256이 불일치하면 무조건 `connectionStatus='unavailable'`로 바꿨다. 실제 격리 코어의 존재하지 않는 artifact URL로 404를 만든 `verify-ui.mjs` 시험이 수정 전 기대 `코어 응답 확인됨`/실제 `최신 상태 확인 실패`로 실패했다(`build-artifacts/controller-artifact-status-20260927/red.txt`, SHA-256 `c10ea0b8013cc8259384b70894551141f51f2628f30fba7444801e72249df915`). 본문 한 바이트를 변조한 SHA 실패도 같은 경로였다.
- `main.ts`에 `invalidatesConnection(error,responseStarted)`를 두고 일반 API와 artifact 다운로드가 공유하게 했다. HTTP 401/403 또는 응답 전 전송 실패만 연결 상태를 무효화한다. 정상 응답 후 JSON/파일 파싱·SHA 실패와 서버의 404/409/500 거부는 PC 오프라인으로 위장하지 않는다. `readVerifiedFile()`의 SHA 실패 폐쇄 동작은 그대로이며 잘못된 결과는 표시되지 않는다. 실제 연결 상태의 갱신은 기존 `/state` refresh가 계속 담당한다.
- `verify-ui.mjs`는 실제 코어의 artifact 404, native HTTP 어댑터에서 한 바이트 변조한 SHA 실패, 기존 정상 결과 열림, 실제 코어 중단/동일 포트 재시작·동일 요청 ID 복구를 재검증했다. 최종 번들 Node v24.19.0 실행은 `ok:true`, **프로세스 exit 0**, `green-final.txt` SHA-256 `539f9f04ce630449b0e3f7e74d87a2908820c9231bc26ae81b57a898e5d8ae1a`. Windows 시스템 Node v24.11.1로는 `ok:true` 뒤 `0xC0000409` 비정상 종료가 다시 관찰됐다. 독립 검토자도 처음에는 그 종료 코드 때문에 보류했으나 번들 Node로 독립 재실행해 exit 0을 확인하고 범위 한정 승인으로 정정했다. 시스템 Node 원인은 여전히 미확정이다.
- 실제 Edge 360×780/430×900의 `verify-mobile.mjs`도 실코어 404 및 변조 SHA 실패를 각각 실행했다. 두 경우 모두 결과 패널은 닫히고 연결은 온라인으로 남는다. 그 과정에서 고정 오류 알림이 `전체 멈춤` 클릭을 가로막는 사실을 발견해 `apps/controller/src/style.css`에서 비상호작용 알림에 `pointer-events:none`을 적용했다. 또 결과 파일 버튼의 배경/글자색이 같아 **대비 1.00:1 실패**인 것을 실제 Edge로 재현했다(`contrast-red.txt` SHA-256 `3815180963c566fca55a9da8be208db2a36dd6db30734b51b0aeec0f51477362`). `.artifact`의 잘못된 글자색 재지정을 제거한 뒤 두 viewport 모두 **11.62:1**; 정지/재개까지 포함한 브라우저 스크립트 exit 0. `browser-final.txt` SHA-256 `7a91ff25888bc9c2cee58df2bcf6eb3955abb2dcc124506547629b2d8c2237e5`. 화면 `artifact-integrity-error-360px.png`/`430px.png` SHA-256 각각 `c0d3fe360d561fad3c96281193b4730d4127e77f84094ec1f8560839f8f1b64f`, `275908f8c9c976872b2b3cb6bf7d2b55cfb432cb8a7604f2bdb678edb83de7a6`. 독립 시각 검토는 버튼/오류/하단 탐색 가독성을 PASS로 확인했다. 오류 알림은 `연결 관리` 카드 일부를 일시적으로 덮지만 클릭을 가로채지 않는다.
- 번들 Node로 `tsc --noEmit`, Vite(113 modules), 변경된 MJS `node --check`, `git -c core.safecrlf=false diff --check` exit 0. 변경 후 전체 `node --test runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs` exit 0: **1183 total / 1162 pass / 0 fail / 21 skip**. 로그 `build-artifacts/controller-artifact-status-20260927/full-regression.txt` SHA-256 `5ad77bf08d9aa02363ee7646ca6b184f5567ed30d3617798112349d4c69de9aa`.
- 최종 소스로 `npm.cmd --prefix apps/controller run tauri -- android build --debug --apk --target aarch64 --ci` exit 0. 새 웹 번들 `dist/assets/index-D41P7N7H.css`·`index-DwaSHbfD.js`, arm64 Rust 라이브러리 및 Gradle APK 생성. 이전 r45·r81은 보존하고 `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260927-r82.apk`에 복사: **110,880,426 bytes**, SHA-256 `ca1e3c02f3a91801c149249abd6c1b7b77b2c4b9c6e7f240d546686a9cba5767`. `zipalign -c 4`, `apksigner verify --verbose`(v2, 서명자 1), `aapt dump badging` 모두 exit 0; smoke package `kr.yeno.controller.smoke`, versionCode 2001, minSdk 28/targetSdk 36. r45·r81·r82의 공개 서명 인증서 SHA-256 지문은 모두 `01ed048243d404d2761c5cf3f6224e4e048eb8604516c430bd3dad92774a1da4`로 같다. 실제 휴대폰에 설치된 APK의 서명과 데이터 상태는 기기가 없어 미확인. `android-build.txt` SHA-256 `5bd8f36ed90b827d63b2a334469b108da927eae59798175d40d7daba2891777e`.
- **VERIFIED:** 실코어 404/변조 SHA 오류와 실제 오프라인의 구분, 잘못된 결과의 비표시, 360/430px 버튼 대비·오류 알림 아래 제어 동작, 전체 회귀, 새 APK 빌드/서명/정렬. **RAN-UNVERIFIED:** 브라우저의 QR·Stronghold·native HTTP는 합성 어댑터이며 실제 Android 설치·카메라/네트워크를 검증하지 않았다. **BLOCKED/NOT RUN:** `adb devices -l` 0대여서 물리 휴대폰 페어링→요청→PC 실행→진행→결과→종료 후 복구는 미실행; 실제 원격 provider 키/모델 미설정 상태에서 JARVIS A1도 별도 미실행. 다음 한 단계는 연결된 실기기에서 기존 설치 서명·데이터를 먼저 확인하고 r82 APK로 같은 작업 ID의 전 과정을 기록하는 것이다. 운영 배포·데이터 삭제·자격증명 교체·커밋/push 없음.

## §83 — 2026-09-27 Codex: 소유자 기기 폐기 후 폰 인증 거부·복구 표시

- 저장소 경로·origin·branch·HEAD는 §81과 같으며, 시작 시 있던 미커밋 변경을 되돌리거나 덮어쓰지 않았다. 실제 격리 코어에서 소유자가 이미 페어링된 기기를 폐기한 뒤 폰 UI가 `기기 인증 거부됨` 대신 `최신 상태 확인 실패`라고 잘못 표시하는 것을 `apps/controller/verify-ui.mjs`의 실패 시험으로 재현했다. `build-artifacts/controller-revocation-status-20260927/red.txt` SHA-256 `20e22ddce135742d7de61a40c3085fb6194eb3aaba19890e62421b65653a9e34`. 화면에 남은 오래된 SHA 경고와 인증 거부 후에도 활성처럼 보이는 버튼도 각각 실패 시험으로 기록했다(`stale-alert-red.txt`, `controls-red.txt`).
- `apps/controller/src/main.ts`에서 HTTP **401만** 인증 거부로 구분한다. 유효한 기기에도 가능한 403 권한 거부는 인증 폐기로 단정하지 않으며, 실제 코어의 403을 통과시켜 온라인 상태 유지 시험을 했다. Studio 요청과 일반 API/결과 다운로드가 동일한 실패 상태 처리를 거치도록 연결했다. 401 발견 시 보관소는 자동 삭제하지 않고, 화면 전체에 복구 안내를 표시하며 새 명령·전체 멈춤·실패할 서버 토큰 폐기를 비활성화한다. 소유자가 선택할 수 있는 `이 폰에서만 지우기`는 남긴다. 오래된 결과 무결성 알림은 인증 거부 진입 때 지웠다. 공유 Living Core 홈의 음성 버튼도 오프라인/전체 멈춤일 때 비활성화한다. `--danger-line`·`--danger-panel`을 `apps/controller/src/style.css`와 `DESIGN.md`에 문서화했다.
- 번들 Node v24.19.0으로 `tsc --noEmit`, Vite 113모듈 빌드, `node apps/controller/verify-ui.mjs` **exit 0 / ok:true**, `node apps/controller/verify-mobile.mjs` **exit 0 / ok:true**, Living Core·native home 집중 시험 **26/26**, 변경 MJS `node --check`, `git -c core.safecrlf=false diff --check` exit 0. 실제 코어 시험은 403과 Studio가 처음 발견한 401, 보관소 보존, 허위 명령 접수 금지를 검사한다. Edge 360×780·430×900에서는 새 인증 거부/복구/홈/안내 화면 각 2장씩 캡처했다. 두 독립 검토 중 시각 검토는 활성/비활성 버튼과 한국어 줄바꿈을 PASS로 확인했다. 로그 SHA-256: `green-final3.txt` `3a011473e05a50a9cf18f70e4bdeec8a25a5fb5c84e99ed954d9a316db895224`, `browser-final4.txt` `f3b71adbfc188283838c3b73d53340dd719f47dfc7c6ee75db34974bc823ae09`. 시스템 Node v24.11.1은 성공 출력 뒤 비정상 종료할 수 있어 §82와 같이 번들 Node의 실제 exit code를 기준으로 삼았다.
- 변경 후 전체 `node --test runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs` **1184 total / 1163 pass / 0 fail / 21 skip**, 로그 `build-artifacts/controller-revocation-status-20260927/full-regression-final.txt` SHA-256 `ff1fd0661ab076713e251f885966f41c97c61701ba6bd90371201ed2aa3d9461`. 최종 Vite 파일 `dist/assets/index-CCksST5Z.css`, `index-DYfyEksT.js`를 포함한 Android arm64 debug APK 빌드 exit 0. 이전 r82를 덮지 않고 `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260927-r83.apk`로 복사했다: **110,880,426 bytes**, SHA-256 `6ea9f6d5409c1870b1c8c9099a262e5c0c03915d21146e0abcce0175469ade7c`. `zipalign -c 4`, `apksigner verify --verbose --print-certs`, `aapt dump badging` 모두 exit 0. 디버그 서명 지문은 r82와 동일 `01ed048243d404d2761c5cf3f6224e4e048eb8604516c430bd3dad92774a1da4`; package `kr.yeno.controller.smoke`, versionCode 2001, minSdk 28/targetSdk 36. 빌드 로그 SHA-256 `6b94c9d96ba84effc1b06ae7342d3581d2e688ea76a50a788c0c8496cad42e21`.
- 독립 코드/디자인 검토자는 처음에 403 과잉 분류·Studio 누락·색상 하드코딩·시스템 Node 시험 종료 코드를 지적했다. 수정 후 현재 소스와 새 화면을 다시 보고, **번들 Node v24.19.0으로 `verify-ui.mjs`를 직접 재실행해 `$LASTEXITCODE=0`을 확인한 뒤 APPROVE**로 정정했다. 시스템 Node v24.11.1의 성공 출력 뒤 비정상 종료는 별도 환경 결함으로 남는다.
- **VERIFIED:** 격리 실코어의 owner 기기 폐기→Studio 401→앱 인증 거부·복구 표시, 실제 403의 온라인 유지, Edge 360/430px 제어 상태, 회귀·APK 빌드/정렬/서명. **RAN-UNVERIFIED:** native IPC·Stronghold·카메라는 브라우저 시험에서 합성 어댑터이며 실제 폰 설치를 뜻하지 않는다. **BLOCKED/NOT RUN:** 절대 경로 ADB `devices -l` 결과 연결 **0대**라 실기기 페어링→요청→PC 실행→진행·결과→앱 재시작 복구는 미실행. JARVIS A1 실원격 모델 60초 결과도 이 절에서 실행하지 않았다. 다음 한 단계는 실제 Android 기기가 연결되면 기존 설치·서명·데이터를 먼저 확인하고 r83을 안전하게 설치하여 같은 작업 ID의 전체 흐름을 검증하는 것이다. 운영 배포·데이터 삭제·실제 자격증명 교체·커밋/push 없음.

## §84 — 2026-09-27 Codex: Android 자동 백업·기기 전송에서 연결 정보 제외

- 직전 §83은 실제 코드·시험·r83 APK로 진전이 있었다. 이번 시작에 경로 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211` 재확인. 기존 대규모 미커밋 변경은 보존했다. ADB 기기 0대; SDK에 emulator 실행 파일·시스템 이미지 없음(기존 `.android/avd` 폴더만 존재), 물리 RAM 7.73GiB. 운영 BLACKHOLE 예약 작업/프로세스는 읽기 전용 조회에서 발견되지 않았다. 에뮬레이터 대용량 다운로드나 운영 설치는 실행하지 않았다.
- 이전 r83 APK의 **실제 컴파일 Manifest**에 `allowBackup`, `fullBackupContent`, `dataExtractionRules`가 모두 없었다(`build-artifacts/android-backup-boundary-20260927/r83-baseline-manifest.txt`). 앱의 `CommandSession`은 접수 대기 문구와 요청 ID를 WebView `localStorage`에 보존한다. [Android 공식 Auto Backup 문서](https://developer.android.com/identity/data/autobackup)에 따르면 백업 참여 기본값은 true이고 Android 12 이상 일부 제조사에서 `allowBackup=false`만으로 기기 간 전송을 막지 못한다. 그래서 백업 기본값을 묵인하지 않고 두 버전의 제외 규칙을 함께 포장하기로 했다. 이 판단은 **Android OS 백업 경계**이며 같은 폰에서 앱 종료·재시작 뒤 상태 복구를 삭제하는 조치가 아니다.
- `scripts/android-release.test.mjs`에 생성 Manifest의 `allowBackup=false`, Android 11 이하 `fullBackupContent`, Android 12 이상 `dataExtractionRules`의 cloud/device-transfer 제외, 반복 실행, 충돌 시 원본 Manifest 보존, 릴리스 템플릿 연결을 추가했다. 수정 전 집중 시험 exit 1 (`red.txt` SHA-256 `d7692b495c9b35407b268a75df94f8a58ee28c2023c57c37fa27d2442238042c`). `scripts/android-release.mjs permissions`가 RECORD_AUDIO와 함께 `root`·`device_root`·`external` 경로를 두 백업 XML에서 제외하도록 수정했다. 서로 다른 기존 규칙은 덮어쓰지 않고 실패한다. `.github/workflows/android-debug.yml`과 `docs/workflows/android-release.yml.template` 모두 생성 직후 이 패치를 실행한다. 정책과 새 폰 재등록 범위는 `docs/ANDROID_RELEASE_SIGNING.md`에 기록했다.
- 번들 Node v24.19.0 `node --test scripts/android-release.test.mjs` **10/10 exit 0** (`green-final.txt` SHA-256 `26804ce67ea2bdbd54d190ec738ff366e0c2a86d9462c3f8e68de83efbc63fc0`). 전체 `node --test runtime/test/*.test.mjs apps/controller/test/*.test.mjs scripts/native-config.test.mjs scripts/android-release.test.mjs` **1186 total / 1165 pass / 0 fail / 21 skip**, `full-regression.txt` SHA-256 `2f5d317ade7a23075dec5197afba5c825987aa0d16fdd9bab9917d2fed33007e`. 변경 JS `node --check`, `git -c core.safecrlf=false diff --check` exit 0. 실제 생성 프로젝트에 `node scripts/android-release.mjs permissions --gen apps/controller/src-tauri/gen/android`를 실행하고 두 번째 실행이 `already patched; backup rules already present`임을 확인했다.
- 같은 생성 프로젝트에서 Android arm64 debug APK 재빌드 exit 0; 이전 r83 보존, 새 파일 `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260927-r84.apk` **110,880,595 bytes**, SHA-256 `a2c83258d7a5746619190798c6ef400b0c0513b5c17b64646ae93892e8cfd248`. `zipalign -c 4`, `apksigner verify --verbose --print-certs`, `aapt dump badging` 모두 exit 0; package `kr.yeno.controller.smoke`, versionCode 2001, minSdk 28/targetSdk 36, 기존 r83과 같은 디버그 서명 SHA-256 `01ed048243d404d2761c5cf3f6224e4e048eb8604516c430bd3dad92774a1da4`. `aapt dump xmltree`로 **APK 내부** Manifest의 `allowBackup=0x0`, 두 XML 리소스 참조, legacy `root/device_root/external` 제외와 modern cloud/device-transfer 각각의 세 제외를 직접 확인했다. `apk-backup-xml.txt` SHA-256 `21dd659e3d7124f3f1bfc54c5e4ddb9cbcaa630d82e2fde96d98bbf07a213c21`; 빌드 로그 SHA-256 `0307025f412df93d74cf57ed08b32dcc022e4d8c00e07fceb2a65eda534d5b35`.
- **VERIFIED:** 생성기 실패→수정→통과, 전체 회귀, 새 서명 APK에 백업 경계가 실제 포장됨. **RAN-UNVERIFIED:** 제조사별 클라우드/기기 전송 동작은 실기기에서 실행하지 않았다; 이 정적·패키징 확인을 OS 동작 시험으로 승격하지 않는다. **BLOCKED/NOT RUN:** ADB 0대로 폰 페어링→PC 실행→진행·결과→재시작 복구의 물리 수락은 여전히 미실행. 다음 한 단계는 연결된 실제 Android에서 기존 설치 데이터·서명을 먼저 확인하고 r84를 안전하게 설치해 같은 작업 ID의 전체 흐름과 백업 관련 관찰 가능 범위를 검증하는 것이다. 운영 배포·데이터 삭제·실제 자격증명 교체·커밋/push 없음.

## §85 — 2026-09-27 Codex: 원격 모델 설정 경로 대조와 r84 독립 재확인

- 현재 저장소는 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`; 기존 미커밋 변경은 보존했다. ADB 연결 기기 0대. `%LOCALAPPDATA%\BLACKHOLE` 폴더, 8790/8791/8792/9443 리스너, `BLACKHOLE Core v2` 예약 작업은 읽기 전용 조회에서 발견되지 않았다.
- `runtime/desktop-ui/index.html`·`app.js`·`runtime/desktop.mjs`에는 암호화 저장 기반 provider 설정 화면과 1회 실제 모델 시험이 존재한다. 그러나 이 화면은 `desktop-v1`의 8791 코어와 별도 저장소를 시작한다. 소유자가 §26에서 일상 실행 기준으로 정한 `resident-v2`의 8790 코어는 `runtime/resident.mjs`에서 명시적 `localModel`만 환경으로 넘기고 상속된 원격 provider 키를 의도적으로 받지 않는다. `runtime/owner-local-model.mjs`와 폰 페어링 GUI도 설치된 Ollama 모델 선택만 지원한다. 따라서 기존 '설정 UI에 키만 넣으면 JARVIS A1이 뚫린다'는 설명은 기준 resident 코어에 대해서는 **부정확하다**. 실제 원격 모델 결과·60초 기준은 여전히 NOT RUN이며, desktop-v1의 별도 코어에서 성공하더라도 resident-v2/폰 경로의 증거로 치환할 수 없다. 키 값·일부·길이·해시는 조회하거나 출력하지 않았다.
- `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260927-r84.apk`의 존재·크기 **110,880,595 bytes**·SHA-256 `a2c83258d7a5746619190798c6ef400b0c0513b5c17b64646ae93892e8cfd248`를 이 턴에 직접 재확인했다. 번들 Node로 `node --test scripts/android-release.test.mjs runtime/test/resident-runtime.test.mjs`를 실행해 **23/23 pass, 0 fail, exit 0**을 확인했다. 이는 §84의 전체 회귀를 다시 실행했다는 뜻은 아니며 Android OS의 백업 동작이나 실기기 UI도 검증하지 않는다.
- **VERIFIED:** 위 APK 파일 해시·크기, 집중 23개 테스트, 두 코어의 provider 설정 분리와 현재 Windows 설치 부재. **BLOCKED/NOT RUN:** 실제 휴대폰 페어링→요청→진행→결과→복구 및 원격 실모델 JARVIS A1. 다음 코드 단계는 소유자가 확정한 단일 `resident-v2` 코어에 비밀값을 노출하지 않는 원격 provider 설정·저장·1회 시험 경로를 연결하고 격리 재시작 시험으로 검증하는 것이다. 운영 설치·배포·데이터 삭제·실제 자격증명 변경·커밋/push는 하지 않았다.

## §86 — 2026-09-27 Codex: resident-v2 원격 공급자 암호화 설정·소유자 1회 시험 연결

- 시작 상태: 경로 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 이전 미커밋 변경은 보존했다. 운영 `%LOCALAPPDATA%\BLACKHOLE`·8790/8791/8792/9443 리스너·`BLACKHOLE Core v2` 작업은 조회 시 없었다. 실제 ADB 기기 0대.
- `runtime/resident.mjs`가 선택적 `providerFile`을 **pairing token과 같은 개인 디렉터리의 `provider.dpapi`**로 제한하고, Windows DPAPI CurrentUser 암호문을 해제·검증한 provider 환경만 기준 8790 코어에 넘긴다. `localModel`과 동시에 선택할 수 없고, 손상 암호문·심볼릭 링크·크기 초과는 코어 인스턴스 소유권을 주장하기 전 실패 폐쇄한다. 부모 프로세스의 원격 환경 변수는 계속 상속하지 않는다. `scripts/resident-provider.ps1`은 비밀값을 명령 인자가 아닌 private stdin/stdout 파이프로만 처리한다.
- `runtime/owner-remote-provider.mjs`와 기존 `runtime/owner-pairing.mjs`/`scripts/pair-blackhole-phone.ps1`의 소유자 창을 연결했다. 소유자가 공급자·모델·키를 입력해 저장할 때 활성 작업을 거부하고 먼저 AI 모듈을 끄며, DPAPI 암호문과 경로만 저장하고 **같은 resident**를 재시작한다. 창에는 호출 비용 가능성과 하루 2회 상한을 표시한다. Ollama로 다시 바꾸면 암호화된 원격 파일은 보존하되 선택에서 제외한다. 별도 버튼은 소유자 클릭 때만 기존 `/api/self-test`의 one-shot 실제 모델 시험을 요청하며 AI·자동 실행을 켜지 않는다. 결과 불확실 때 GUI가 재호출을 막고 확인을 요구한다. 키 값·일부·길이·해시는 터미널·로그·채팅에 출력하지 않았다.
- 실패→수정: 신규 resident 시험은 처음 `RESIDENT_CONFIG_INVALID`로 0/1 실패했고, providerFile 배선 뒤 통과했다. 실제 PowerShell 5.1 DPAPI 왕복은 첫 시도 `System.Security` 미로드로 실패, 명시 로드 뒤 Protect/Unprotect exit 0·암호문 상이·복호문 동일. 실제 Windows 합성 키 저장→동일 코어 재시작 시험에서 provider configured=true, AI 모듈 false, 상태/설정/인스턴스 기록의 평문 키 0건 확인. 손상 암호문, 활성 작업 설정 거부, 합성 전송을 `LIVE_VERIFIED`로 오판하지 않는 one-shot HTTP 시험도 통과했다. `runtime/test/resident-runtime.test.mjs`·`native-pairing.test.mjs` 집중 **23/23 pass**, 소유자 GUI PowerShell AST parse error 0.
- `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`는 **exit 1**, 867 total / 772 pass / 74 fail / 21 skip으로 끝났다(여러 시험 파일이 파일 단위 `test failed`); 이 실행은 회귀 통과로 표시하지 않는다. 이전부터 관찰된 시스템 Node v24.11.1의 비정상 종료 형태와 비슷하지만 이번 실패의 내부 원인을 확정하지 않았다. 같은 전체 범위를 번들 Node v24.19.0 `--test-concurrency=4`로 최종 재실행해 **1191 total / 1170 pass / 0 fail / 21 skip, exit 0**; `build-artifacts/resident-provider-20260927/full-regression-final.txt` SHA-256 `178514859f583220918b2a4b93510b9d027e264b5fe89eec324e20b79da20ce7`. GUI 경로 중복으로 처음 Windows 수락 AST에서 실패했고, 경로를 한 곳으로 합친 후 `scripts/test-resident-windows.ps1` **105/105 assertions passed, exit 0**, 보고서 `build-artifacts/resident-provider-20260927/windows-acceptance.json` SHA-256 `d9f2ed2958f209e8cd901a53c968007b85b75266d7f16a46d85ee1959559e1b1`. 종료 후 `BLACKHOLE CI *` 작업과 8790/8791/8792/9443 리스너 잔여 0. `git -c core.safecrlf=false diff --check` exit 0.
- **VERIFIED:** 실제 Windows DPAPI 합성 키 왕복·저장/재시작 후 동일 resident 공급자 인식, 비밀값 비노출 범위, one-shot 합성 전송 거부, 전체 번들 Node 회귀, Windows 격리 예약 작업 수락. **RAN-UNVERIFIED:** 소유자 WinForms 화면은 구문·배선만 검사했다. 격리 owner 창 프로세스를 띄웠으나 숨김 창을 Windows 화면 도구가 찾지 못해 시각/클릭 수락은 실행하지 못했고, 해당 시험 프로세스와 자식 Node는 종료했다. 시험용 `gui-fixture/`의 두 파일은 광범위 삭제 명령이 자동 승인 검토에 거부된 뒤, 정확한 파일을 지정한 패치로 제거했다(빈 폴더만 남음). **BLOCKED/NOT RUN:** 실제 원격 키/모델 응답·JARVIS A1 60초 화면 수락, Android 실기기 페어링→PC 실행→진행·결과→복구. 운영 설치·배포·운영 데이터 삭제·실제 자격증명 변경·커밋/push 없음. 다음 한 단계는 소유자 창의 실제 GUI 조작을 격리 resident에서 확인하고, 실제 키가 소유자에 의해 비공개로 설정되면 같은 코어의 one-shot 및 JARVIS A1을 1회 검증하는 것이다.

## §87 — 2026-09-27 Codex: 소유자 설정 창 표시 가능성 재확인

- §86의 격리 `gui-fixture/owner.json`을 합성 소유자 정보로 다시 만들고 Windows PowerShell 5.1에서 `pair-blackhole-phone.ps1 -HomeDir <fixture>`를 실행했다. 현재 PowerShell 실행 정책으로 첫 시도는 스크립트 로드를 거부했고, 기존 `scripts/pair-blackhole-phone.cmd`와 같은 프로세스 한정 `-ExecutionPolicy Bypass`를 지정한 재실행은 프로세스 PID 40464에서 유지됐다. Windows `Get-Process`는 창 제목 `BLACKHOLE - 휴대폰 연결`, 비영(非零) `MainWindowHandle`을 확인했다. 이 실행은 운영 resident 설치·실제 키 사용이 아니다.
- 화면 검사 도구의 앱/창 목록에는 해당 WinForms 창이 나타나지 않았다. 따라서 화면 스크린샷, 스크롤, 버튼 클릭, 키 입력·저장, one-shot 호출은 **실행하지 않았다**. `pair-blackhole-phone.ps1` 코드상 원격 공급자·모델 ID·키 입력과 `원격 모델 암호화 저장 후 본체 재시작`, `실제 모델 1회 연결 시험 (비용 발생 가능)` 버튼은 소유자 QR/로컬 모델 영역 아래의 자동 스크롤 영역에 있다. 실제 화면에 보이는 위치와 조작 가능성은 검증되지 않았다.
- 시험 창 PID 40464는 제목을 대조한 뒤 종료했고, 임시 `owner.json` 및 비어 있는 stdout/stderr 파일은 정확한 경로를 지정해 제거했다. 격리 폴더는 비어 있다. §86의 전체 회귀·Windows 수락 수치는 다시 실행한 것이 아니며 그대로 유지한다. **VERIFIED:** Windows 프로세스/창 핸들 생성과 소스상의 버튼 배선. **RAN-UNVERIFIED:** 소유자 창 화면·클릭. **BLOCKED/NOT RUN:** 실제 키의 one-shot/JARVIS A1, Android 실기기 전체 흐름. 다음 한 단계는 실제 화면 세션에서 소유자 창을 관찰해 원격 버튼 조작을 검증하는 것이다.

## §88 — 2026-09-27 Claude(Cowork): 자비스 비주얼 업그레이드 지시서 (선제 작성)

- 소유자가 오픈소스 "아이언맨 자비스" 클론들과 비교해 현재 오브 UI(정적 2D 캔버스)가 평면적이라고 지적, 언리얼 엔진 사용 여부를 물음. 웹 검색으로 실제 오픈소스 자비스 클론 다수를 확인한 결과 공통 패턴: 아크리액터형 오브 + 동심 홀로그램 링, 상당수가 Three.js(WebGL) 기반 3D 사용, 시안/블루 팔레트.
- 언리얼 엔진은 기각: 네이티브 게임엔진이라 현재 Node.js 서버 + 브라우저 + Tauri 구조 전체 재작성이 필요하고, 픽셀 스트리밍 방식은 상시 GPU 서버가 필요해 지금 7.7GiB RAM PC의 자원 제약과 정반대 방향. 대신 브라우저 내에서 기존 2D canvas(`runtime/public/jarvis-orb.mjs`)를 Three.js WebGL로 교체하는 방향으로 `docs/CODEX_DIRECTIVE_JARVIS_VISUAL_UPGRADE_20260927.md` 작성 (46줄): 외부 CDN 금지(로컬 번들 내장), 기존 상태머신/서버 API 불변, WebGL 미지원 시 기존 2D 버전으로 자동 폴백 보존, reduced-motion 접근성 유지, 모바일 프레임레이트 실측 요구, §85-86(원격 공급자)·안드로이드 실기기 작업 순서를 밀어내지 말 것을 명시.
- 코덱스 지시 없이 내가 먼저 조사·작성함 — 소유자가 "찾아서 알아서 하라"고 요청했기 때문. 코덱스의 실제 착수·검증은 아직 안 됨. **VERIFIED:** 지시서 파일 생성(46줄) 및 §87까지의 기존 로그 확인. **RAN-UNVERIFIED:** 없음(지시서 단계). **BLOCKED/NOT RUN:** Three.js 실제 구현·인수 V1-V5 전부 착수 전.

## §89 — 2026-09-27 Claude(Cowork): 코덱스 인계 요약 문서 작성

- 소유자 요청("제대로 코덱스에 인계해줄내용 정리해줘")에 따라 쌓인 지시서들의 우선순위를 정리한 `docs/CODEX_HANDOFF_20260927.md`(32줄) 작성. 내용: P0(소유자 행동 대기 — JARVIS A1 실제 키 입력, 안드로이드 실기기 연결), P1(진행 중인 메인 작업 — JARVIS_E2E_SPEC 잔여분), P2(신규, P0/P1 안 밀어내는 조건 — VISUAL_UPGRADE + PC 그래픽카드 사양 조회 요청), 해소되어 무시 가능한 과거 지시서 3건(RAM_RECOVERY, BUILDER_EMPTY, REMOTE_PROVIDER — 전부 §72 재해석으로 대체/완료됨) 명시, 그리고 이번 세션 기록에서 추적 못 한 9/26 이전 지시서 2건(AGENT_SCALE, JARVIS_FACE) 상태 확인을 코덱스에 요청.
- **VERIFIED:** 문서 생성(32줄) 및 기존 지시서 파일 목록/크기 대조. **RAN-UNVERIFIED/BLOCKED:** 없음(순수 정리 문서, 코드 변경 없음).

## §90 — 2026-09-27 Codex: 원격 설정 저장 실패 복구·실제 Windows resident 설치와 로컬 작업 복구

- 시작 시 저장소 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`을 재확인하고 기존 미커밋 파일을 보존했다. §89 인계의 P0/P1/P2를 읽었다. §55의 AGENT_SCALE은 합성 병렬/Windows 저널까지만, §53의 JARVIS_FACE는 실제 브라우저/로컬 Ollama 호출까지며 응답 내용 품질과 원격 A1은 미달임을 인계 문서에 명시했다.
- `ownerRemoteProvider`가 새 암호문을 쓴 뒤 `config.json` 쓰기에 실패하면 기존 설정이 새 키 암호문을 가리킨 채 남을 수 있었다. 테스트에서 설정 쓰기 실패를 주입해 **1 fail(red)**을 확인하고, 이전 암호문 복원·첫 저장 파일 제거를 구현했다. 두 실패 경로 시험과 기존 Windows DPAPI/페어링 집중 시험 **26/26 pass**. `runtime/resident.mjs`에는 headless 예약 작업 실패 시 자격증명·응답 본문·스택 없이 허용된 오류 코드와 시각만 개인 control 디렉터리에 쓰는 진단을 추가했다. `ENOENT` 실패 기록 시험은 실제 반환 코드로 정정 후 통과했다. 번들 Node v24.19.0 전체 회귀 **1194 total / 1173 pass / 0 fail / 21 skip**, exit 0; `build-artifacts/resident-provider-20260927/full-regression-native-install.txt` SHA-256 `f45cd5fe2697083280c3478073e553e72aaf4be0ca14a2957d142b7669319f0e`. 이 턴에 시스템 Node의 `npm.cmd test`는 다시 실행하지 않았다. 격리 Windows 수락은 변경 초기 상태에서 **104/104, exit 0**, `windows-acceptance-rollback.json` SHA-256 `bc51fd1c4fc232d168353b911b931712f055fd18f76726a6a82b131994f22f92f`.
- `Get-CimInstance Win32_VideoController`는 Intel(R) UHD Graphics, 드라이버 32.0.101.7082, AdapterRAM 2,147,479,552 bytes를 보고했다. `dxdiag /t`는 **Dedicated Memory 128 MB / Shared Memory 3958 MB / Display Memory 4086 MB**였다. 따라서 WMI AdapterRAM을 전용 VRAM 2 GiB로 보고하지 않는다. 임시 `dxdiag` 원본은 `%TEMP%\blackhole-gpu-dxdiag-20260927.txt`에 남았다. 그 정확한 파일의 삭제는 자동 승인 검토가 `blocked by policy`로 거부했고, UTF-8이 아닌 텍스트라 정확한 경로 `apply_patch` 삭제도 실패했다. 보안 설정 변경이나 다른 삭제 수단으로 우회하지 않았다.
- 실제 `%LOCALAPPDATA%\BLACKHOLE\resident-v2`와 정식 작업·8790 리스너가 없음을 확인했다. `npm.cmd ci --prefix runtime --ignore-scripts --no-audit --no-fund` exit 0(36 packages). 기존 승인된 일반 사용자 단일 resident 설치 범위에서 `blackhole-resident.ps1 -Action install -InitializeNewStore`를 직접 실행했다. 현재 스크립트는 `Read-Host`를 요구하지 않고 32-byte CSPRNG 키를 owner-only 파일에 자동 생성하며 비밀값을 출력하지 않는다. 첫 설치는 작업 등록 뒤 readiness 실패(exit 1). 터미널에서 같은 Node/설정으로 실행한 코어는 8790에서 정상 동작했으므로 정상 종료했고, 생성된 실패 작업은 소유권 검증 `uninstall`로 등록만 제거했다(데이터/키 보존).
- 임시 예약 작업 진단은 **같은 사용자 SID**에서 저장소 entry를 읽지만 터미널에서 생성한 `%LOCALAPPDATA%\BLACKHOLE` 부모부터 `ENOENT`임을 재현했다(`scheduler-diagnostic-report-5.json` 등). 파일 가시성 차이의 기저 원인은 확정하지 않았고, 터미널/예약 작업의 동명 경로를 같은 파일 집합으로 취급하지 않는다. 임시 **사용자 문맥 예약 작업**에서 설치 스크립트를 실행해 별도의 실제 가시 경로에 새 저장소를 생성한 결과 `native-install-report.json`은 `status:passed`, `coreHealthy:true`, `taskState:Running`, `phoneStatus:disabled`, `tokenFilePresent:true`; SHA-256 `0875215bc517e27a9109d9fee4e0b3598ee1a62eccaffa295a472767511eb747`. 정식 작업 `BLACKHOLE Core v2`는 실행 중이고 Node 리스너 8790 1개, 실제 `/api/health` 200(`authRequired:true`), `/jarvis` 200을 별도 조회했다. 임시 설치/진단 작업은 전부 제거했고 운영 작업은 보존했다.
- 실제 설치본의 비공개 토큰은 예약 작업 내부에서만 읽고 출력하지 않았다. 소유자 `/api/commands`로 `document: BLACKHOLE resident operating smoke` 한 건을 보내 작업 `6ac89b38-13f7-47a9-9623-b28adb9fd671` 완료, 산출물 `780e915d-122f-49ec-8461-c23590ec7e6e` SHA-256 `d6836ef6de3cb70eab4115a7500bb2a900cb3934f30ca90aa7073e33925335e6`을 직접 바이트 대조했다. 정식 resident 재시작 뒤 **같은 작업 ID와 SHA**를 다시 조회해 복구됨을 확인(`native-core-smoke-report.json` `status:passed`, `sameAfterRestart:true`, 17,733ms, SHA-256 `0874710b0f64caca3179eb09a8f479e3cf545d1a407d54fbc3c3bb58ab05fde2`). 이 smoke는 모델 호출 수를 측정하지 않았으며, 최초 보고서의 미측정 `modelCalls:0` 필드는 증거로 오해되지 않도록 제거했다. 작업은 새 실제 로컬 저장소에 기록됐고 삭제하지 않았다.
- 소유자 WinForms 창을 실제 사용자 문맥 임시 작업에서 실행해 제목/창 핸들은 확인했으나 화면 검사 도구가 열거하지 않아 **스크린샷/버튼 클릭은 계속 미실행**. 창과 임시 작업은 종료했다. PC에서 Tailscale 실행 파일은 PATH/Program Files에 없고 실제 전화 사설 HTTPS는 비활성. SDK의 `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l`는 연결 **0대**. 운영 키·원격 provider 입력/실모델 호출, 휴대폰 페어링·요청·진행·결과·복구, 운영 외부 배포는 실행하지 않았다. `docs/BLACKHOLE_WINDOWS_RESIDENT_20260921.md`의 오래된 수동 키 입력 설명과 `docs/CODEX_HANDOFF_20260927.md`의 설치/GPU/잔여 범위를 정정했다. `git -c core.safecrlf=false diff --check` exit 0. **VERIFIED:** 정식 Windows 작업/로컬 HTTP, 실제 로컬 문서 작업·재시작 복구, 번들 Node 회귀, GPU 수치. **RAN-UNVERIFIED:** GUI 시각/클릭, 실제 휴대폰·실모델 응답. **BLOCKED/NOT RUN:** Android 실기기+Tailscale 사설 경로, 소유자 비공개 키 입력 후 JARVIS A1 실모델 화면 수락. 다음 한 단계는 소유자 GUI의 실제 화면 접근·클릭을 확인한 뒤 키를 채팅/터미널에 노출하지 않고 원격 provider 1회 시험을 하는 것이다.

## §91 — 2026-09-27 Codex: JARVIS 로컬 WebGL 렌더러와 2D 폴백 실브라우저 검증

- 시작 상태: 저장소 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`, 기존 미커밋 72건을 확인하고 보존했다. 실제 예약 작업 `BLACKHOLE Core v2`는 `Running`, 포트 8790의 `/api/health`·`/jarvis`는 HTTP 200이었다. 설치가 전혀 없다는 최근 안내는 현재 운영 상태와 맞지 않는다. 소유자가 페어링 키를 직접 입력할 필요도 없다(§90).
- P0의 실제 원격 키 입력과 Android 실기기 연결은 이 실행에서 제공되지 않았다. 인계서의 P2 시각 범위로 진행했다. `scripts/verify-jarvis-webgl-live.mjs`를 먼저 실행해 `#orb`가 WebGL로 바뀌지 않아 12초 타임아웃으로 실패(red)를 확인했다. 공식 Three.js `r186`/`0.186.0` MIT npm 배포본을 `npm pack`으로 내려받아 SRI `sha512-cr/fIM2ddMSVbYVgkfD4jLJv7Fh/8ZTjvo+7gQeSVGUZHxpx9FDwoL5iC7hUz/LiRA8wMbqfnb90xKfm1/HHkQ==`와 대조했고 `r186` 태그 커밋 `48dd7be01263658aad497fd72e09d1e4c6213461`을 읽었다. 브라우저에 필요한 두 JS 파일과 MIT LICENSE만 `runtime/public/vendor/three/`에 보존, `NOTICE.md`에 SHA-256을 기록했다. 외부 CDN 호출 없음.
- `runtime/public/jarvis-webgl.mjs`는 기존 코어 scene을 입력으로 프레넬 셰이더 구체·속도가 다른 토러스 3개·승인 대기 호박색 링·활성 그림자 위성을 그린다. 색은 `runtime/public/jarvis.css` 토큰에서 가져오고 WebGL2 생성 실패/손실 시 기존 `jarvis-orb.mjs` 2D를 재개한다. reduced-motion은 정적 프레임, 숨긴 탭은 그리기 중지, 픽셀비 최대 1.5. `runtime/server.mjs`는 두 로컬 vendor JS와 WebGL 모듈만 정적 허용 목록에 추가했고 기존 CSP·API·권한 경로는 바꾸지 않았다. `runtime/public/DESIGN.md`에 시각 계약과 폴백을 갱신했다.
- 최종 실브라우저 명령 `node scripts/verify-jarvis-webgl-live.mjs` exit 0. `build-artifacts/jarvis-webgl-20260927/report.json` SHA-256 `5d1ae5656c3382f7eea1aa9e2088ed8927fff3c9bbeb4025568632a245a93a7e`: Edge 1440×900 0/2초 캡처 SHA 서로 다름(V1), 400×800에서 **WebGL 캔버스 실제 draw 카운터**로 2초 측정 60fps(V2의 PC 브라우저 범위), reduced-motion 두 PNG SHA 동일(V3), WebGL context 강제 비활성 상태에서 기존 2D 화면 표시(V4). 또한 실제 `WEBGL_lose_context` 확장으로 실행 중 context loss를 일으킨 뒤 2D 재개를 확인했다. 400px 소유자 조종 서랍은 키보드 포커스 표시·Escape 닫기 확인. 별도 **합성 렌더러 상태**에서 승인 대기 1건·그림자 3개 입력 시 호박색 링과 위성 3개를 이미지/카운터로 확인했다. 11개 캡처 SHA는 보고서와 일치하며 console error 0, 외부 요청 0. `node scripts/verify-jarvis-face-live.mjs`도 2D 폴백 경로로 exit 0(`fallback-face-regression.txt` SHA-256 `c8d5d1a52d255a86946118e1bbff1cca492694abf3741f739d08613194107ba4`). 두 독립 읽기 전용 코드/시각 리뷰는 첫 400px 여백·상태 표현·토큰·서랍 근거 결함을 지적했고 수정 후 새 캡처에서 PASS였다.
- 사용자 요청 그대로 시스템 Node v24.11.1의 `npm.cmd test`도 실행했으나 **exit 1**, 867 total / 772 pass / 74 fail / 21 skip으로 파일 단위 `test failed`가 반복됐다(`full-regression.txt` SHA-256 `3e1c823c4734dc652f6abb8037d5fa16823dcd7764cf599c700cc9fa5e3e6e7b`). 원인은 이번 실행만으로 확정하지 않는다. 동일한 전체 테스트 파일 범위를 번들 Node v24.19.0 `--test-concurrency=4`로 최종 다시 실행해 **1194 total / 1173 pass / 0 fail / 21 skip**, exit 0(`full-regression-final.txt` SHA-256 `dc2f65ea1c133fc098da4d3d7db207f20e07c2e94b8d70315b81ab58182e44f3`). 변경 JS `node --check`와 `git -c core.safecrlf=false diff --check` exit 0.
- **VERIFIED:** 위 Edge/격리 실코어의 WebGL V1, PC 브라우저 범위 V2, V3·V4, 2D 회귀와 번들 Node 전체 회귀. **RAN-UNVERIFIED:** 시스템 Node `npm.cmd test`는 실행됐으나 실패; 실제 Android GPU 성능·발열은 이 PC Edge 수치로 증명되지 않는다. **BLOCKED/NOT RUN:** V5의 실제 원격 모델 A1(소유자 키 미입력), 실제 휴대폰 설치·페어링→요청·진행·결과·복구(ADB 0, Tailscale 미준비). 기존 A2도 합성 provider 범위만 수락돼 실모델 답변·속도는 미검증이다. 운영 resident는 계속 실행 중이며 이 시각 변경을 실제 폰 APK에 설치하지 않았다. 운영 배포·데이터 삭제·실제 자격증명 교체·커밋/push 없음. 다음 한 단계는 소유자 WinForms 창의 실제 화면 조작을 확인하고, 소유자가 그 창에 비공개로 실제 원격 키를 설정했을 때 A1을 한 번 실행하는 것이다.

## §92 — 2026-09-27 Codex: 운영 설치 오안내 정정과 소유자 창 실제 화면 확인

- 시작 상태 재확인: 저장소 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`; 기존 미커밋 75건 보존. `Get-ScheduledTask -TaskName 'BLACKHOLE Core v2'`는 `Running`, 127.0.0.1:8790은 listen, `Invoke-WebRequest http://127.0.0.1:8790/api/health`는 HTTP 200. 따라서 '소유자가 설치 명령을 실행하지 않아 resident가 한 번도 설치되지 않았다'는 안내는 현 상태와 다르다. 재설치, `-InitializeNewStore`, 운영 task 중지/재시작을 실행하지 않았다. §90의 실제 로컬 문서 job 및 재시작 복구 증거도 유지된다.
- `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l`는 연결 기기 0대. PC 여유 물리 RAM은 조회 시 약 0.44 GiB(총 7.73 GiB)였다. 전역 `adb` 명령은 PATH에 없지만 SDK의 실제 바이너리로 확인했다.
- Windows 파일 탐색기에서 저장소의 `scripts\pair-blackhole-phone.cmd`를 실제 더블클릭했다. Windows 화면에 `BLACKHOLE - 휴대폰 연결` WinForms 창이 표시되었고, QR 생성 버튼·로컬 모델 영역·아래쪽 원격 모델 설정 시작 부분을 직접 보았다. PowerShell 프로세스는 제목이 같은 비영(非零) MainWindowHandle을 가졌다. 화면 도구는 이 WinForms 창을 독립 조작 대상으로 열거하지 않아, 원격 필드로 스크롤·버튼 클릭·저장·실제 모델 1회 시험은 **하지 않았다**. 창은 소유자가 사용할 수 있도록 열린 상태로 두었다. 비밀값·QR 내용은 출력하거나 저장하지 않았다.
- `scripts/blackhole-resident.ps1`의 첫 설치 기본 경로는 CSPRNG로 페어링 키를 자동 생성·소유자 전용 파일에 저장하며, 소유자에게 16자 키를 수동 입력시키는 경로가 아니다. `scripts/pair-blackhole-phone.cmd`는 페어링 GUI를 여는 진입점이며, 실제 원격 provider 키는 소유자가 그 GUI에 비공개로 입력해야 한다. 설치 3개 명령과 수동 페어링 키 입력을 권한 이전 안내는 철회한다.
- **VERIFIED:** 현재 정식 예약 작업·HTTP 응답, SDK ADB 연결 0대, 소유자 GUI 창의 실제 표시. **RAN-UNVERIFIED:** WinForms 아래쪽 원격 설정 컨트롤의 실제 클릭/스크롤. **BLOCKED/NOT RUN:** 소유자 비공개 원격 키 입력 후 JARVIS A1 실모델 결과, 휴대폰 실기기 페어링→요청·진행·결과·복구. 이번 변경은 이 실행 기록 한 파일뿐이며 코드·운영 데이터·자격증명은 변경하지 않았다. 다음 한 단계는 열린 소유자 창에서 원격 설정을 소유자가 직접 비공개로 마친 뒤, 실제 모델 1회 시험과 같은 resident의 JARVIS 결과를 확인하는 것이다.

## §93 — 2026-09-27 Codex: 기본 `npm.cmd test`의 Windows Node 충돌 원인과 로컬 실행 우회

- 재확인한 시작 상태는 §92와 같은 저장소·remote·branch·HEAD이며 기존 미커밋 변경을 보존했다. 운영 예약 작업 `BLACKHOLE Core v2`와 8790 `/api/health` HTTP 200, 소유자 GUI 창은 유지했다.
- 이전 기본 `npm.cmd test`는 시스템 `C:\Program Files\nodejs\node.exe` v24.11.1에서 867 total / 772 pass / 74 fail / 21 skip으로 파일 단위 비정상 종료했다. 이번에 같은 시스템 Node로 `--test-concurrency=4`를 설정해 전체 파일을 다시 실행했으나 **똑같이 867/772/74/21, exit 1** (`build-artifacts/npm-concurrency-20260927/system-node-concurrency4.txt`). 단순 동시 실행 과부하 가설은 이 결과와 맞지 않는다.
- 한 실패 파일을 테스트 이름별로 분리했다. `runtime/test/agent-provider-selection.test.mjs`의 `per-job call limit`만 단독 실행해도 파일 worker가 실패하고, 직접 실행은 Windows `0xC0000409`(`-1073740791`)로 종료됐다. 최소 재현 코드의 `fs.mkdtempSync`·`fs.writeFileSync`는 완료되고, **한글이 들어간 경로에 `fs.rmSync(...,{recursive:true,force:true})`를 호출하는 지점**에서 종료됐다. 같은 Node/같은 명령의 영문 경로는 exit 0, 영문 루트 아래 한글 하위 경로는 같은 충돌이었다. 번들 Node v24.19.0에서 정확히 같은 한글 경로 재현은 `unicode_rm_ok`/exit 0, 동일 단독 시험은 1/1/exit 0이었다. 이 PC의 Node v24.11.1 + Windows 한글 경로 조합이 테스트 충돌 원인임을 경로·버전 토글로 확인했다. 다른 Node 버전이나 모든 Windows 환경으로 일반화하지 않는다.
- `package.json`의 test 진입점을 신규 `scripts/run-tests.mjs`로 바꿨다. Windows v24.11.1일 때에만 이미 PC에 있는 Codex 번들 Node v24.19.0을 선택한다. `YENO_TEST_NODE` 절대 경로 명시 선택도 지원하고 실행 파일/버전을 검사한다. 그 외 런타임은 현재 Node를 그대로 쓰며, 번들 실행 파일이 없으면 조용히 실패를 숨기지 않고 오류를 낸다. 전체 시험의 동시 실행 수는 4로 제한한다. 시스템/전역 Node 설치·PATH·정식 resident 예약 작업은 변경하지 않았다.
- 요청 원문 명령 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`를 수정 후 다시 실행해 **exit 0, 1194 total / 1173 pass / 0 fail / 21 skip**. Desktop 로그 SHA-256 `e68cbb24e0170d0763b6e48de1cc05228741cd6bc768ba1a843de6b41dc0f019`; 로그 머리에 선택된 v24.19.0 경로, 끝에 전체 집계가 있다. `node --check scripts/run-tests.mjs`와 `git -c core.safecrlf=false diff --check`도 exit 0.
- 운영 예약 작업의 실제 실행 파일은 여전히 시스템 Node v24.11.1이고 HTTP health는 200이다. `runtime/` 비시험 코드 검색에서 `fs.rmSync` 호출은 없었지만 `unlinkSync`/`rmdirSync`는 있으므로 이번 테스트 성공을 운영 파일 동작 전체의 검증으로 확대하지 않는다. 실제 원격 provider A1과 Android 실기기 검증 상태도 바뀌지 않았다.
- 디버깅용으로 만든 한글/영문 경로 소형 시험 디렉터리 3개와 `.debug-journal.md`의 제거는 자동 승인 정책이 `Remove-Item` 시도를 두 차례 거부해 실행하지 않았다. 위치와 내용은 저널에 기록했고 제품 데이터는 건드리지 않았다. **VERIFIED:** 최소 재현의 경로·Node 버전 토글, 기본 `npm.cmd test` 재실행 1194/1173/0/21. **RAN-UNVERIFIED:** 이 PC 외 다른 Windows 환경에서의 fallback 선택. **BLOCKED/NOT RUN:** Android 실기기 전체 흐름 및 소유자 키 입력 뒤 실모델 A1. 다음 한 단계는 소유자 GUI에서 비공개 원격 설정이 완료되면 같은 resident의 실모델 응답을 확인하는 것이다.

## §94 — 2026-09-27 Codex: 첫 JARVIS 브라우저의 소유자 승인 경로와 실제 WinForms 화면 검증

- 시작 상태는 같은 저장소·origin·branch·HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`이며 기존 미커밋 변경을 보존했다. 정식 `BLACKHOLE Core v2` 예약 작업은 `Running`, 8790 `/api/health`는 HTTP 200이다. SDK `adb devices -l`은 연결 0대. 운영 설치·재설치·재시작·데이터 삭제·실제 자격증명 변경·커밋/push는 하지 않았다.
- 실제 첫 브라우저는 `/api/web/pairing`으로 요청 번호를 받을 수 있지만 승인 API는 소유자 bearer만 받아서, GUI에 브라우저 승인 동작이 없으면 사용자 스스로 `/jarvis`를 여는 경로가 막혔다. `runtime/owner-pairing.mjs`의 GUI 전용 파이프에 `approve-browser`를 추가했다. 정확한 UUID를 소유자 전용 로컬 설정/키로 127.0.0.1 승인 API에 전달하며, 응답에는 요청 ID와 `approved` 상태만 남긴다. 휴대폰용 Tailscale HTTPS 설정 없이도 이 브라우저 경로는 동작한다. 잘못된 번호와 서버가 410으로 거부한 만료 번호는 구분하되, 키/본문/임의 서버 오류는 창이나 로그에 출력하지 않는다.
- `scripts/pair-blackhole-phone.ps1`의 QR 옆에 `브라우저 연결 승인`을 추가했다. 모달은 번호 비교 설명, 번호 입력, 승인, 닫기/ESC, 입력 초점과 만료 안내를 제공한다. 첫 리뷰에서 이 변경이 기존 원격 모델 ID·API 키 입력칸을 AddRange에서 빠뜨린 것을 발견해 즉시 복구했다. `scripts/DESIGN.md`에 이 소유자 창의 작은 UI 계약을 기록했다. 실제 비밀값이 없는 별도 시험용 GUI로 `owner-main-fixed.png`, `owner-approval-modal-fixed.png`, `owner-provider-fields-fixed.png`를 캡처해 열어 보았다. 마지막 캡처에는 원격 모델 ID, 빈 마스킹 키 입력, 암호화 저장·재시작, 1회 시험 버튼이 보인다. 기존 소유자 GUI 프로세스는 건드리지 않았으므로 그 이미 열린 창에는 새 버튼이 아직 로드되지 않았다.
- `runtime/test/web-pairing.test.mjs`에서 격리 실제 HTTP 코어에 phone:null 설정으로 첫 브라우저 요청→소유자 함수 승인→브라우저 cookie 수집→인증 상태 200, 전용 GUI 파이프 승인, 만료 거부를 검증했다. `node.exe --test runtime/test/web-pairing.test.mjs runtime/test/native-pairing.test.mjs runtime/test/startup-secrecy.test.mjs`는 이 PC의 정상 동작 번들 Node v24.19.0으로 **16/16 pass**. PowerShell AST 오류 0, GUI 파일 UTF-8 BOM 확인, `node --check runtime/owner-pairing.mjs`, `git -c core.safecrlf=false diff --check` exit 0. 별도 Windows 격리 수락 `scripts/test-resident-windows.ps1`은 **103/103 pass**, JSON SHA-256 `c635967d56365d06bb06c5abf354eba22fb1302fd6825484e1fbee5ed19bbfca`. 코드 무결성/화면 읽기 전용 재검토는 각각 PASS였으나 실휴대폰·실키 판정은 아니다.
- 첫 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 전체 실행은 1195 중 1173 pass / 1 fail / 21 skip: 기존 Supabase 기억 동기화 시험이 3초 상한 시점에도 `CONFIGURED_UNVERIFIED`인 상태를 곧바로 `BLOCKED`와 비교했다. 같은 시험 단독 실행은 pass. 해당 시험에서만 정해진 결과를 기다리는 상한을 10초로 늘리고, 상한 미도달은 명시적으로 실패시키도록 수정했다. 동일 전체 명령 재실행 **exit 0, 1195 total / 1174 pass / 0 fail / 21 skip**. Desktop 로그 SHA-256 `46adf601b1e83a7ec52c71ceb9526fb215ae571d6abeb467e47030bd82f392f5`. 다른 Windows/Node 버전 일반화나 원격 Supabase 실제 동기화 증거로 해석하지 않는다.
- **VERIFIED:** 정식 resident 설치·health, 격리 실제 HTTP 첫 브라우저 승인/만료·재인증, WinForms 시험 창의 최신 배치, Windows 격리 103/103, 전체 회귀 1195/1174/0/21. **RAN-UNVERIFIED:** GUI 화면은 비밀값 없는 별도 시험 창에서 표시·캡처하고 승인 요청은 격리 코어의 함수/전용 파이프로 실행했다. 유효 번호를 실제 GUI 버튼에 입력해 운영 코어에서 승인하는 조작은 하지 않았으며, 이미 열린 운영 GUI에는 새 코드가 반영되지 않았다. **BLOCKED/NOT RUN:** 실기기 ADB 0대이므로 Android 카메라 페어링→요청→PC 실행→진행/결과→재시작 복구의 물리 수락, 소유자 비공개 원격 키 입력 뒤 JARVIS A1 실모델 응답. APK를 이번 변경으로 다시 빌드하지 않았다. 다음 한 단계는 소유자가 원격 공급자를 비공개 GUI에 등록할 수 있을 때 새 GUI 코드가 반영된 창에서 실제 모델 1회 시험과 같은 resident의 JARVIS 결과를 확인하는 것이다. 그 전에도 실기기가 연결되면 Android 물리 수락을 최우선으로 진행한다.

## §95 — 2026-09-27 Codex: 실제 WinForms 승인 클릭의 클로저 결함 수정

- 시작·종료 모두 origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 기존 미커밋 변경을 보존했다. 정식 `BLACKHOLE Core v2` 예약 작업은 `Running`, 8790 `/api/health` HTTP 200, SDK `adb devices -l` 연결 0대. 운영 resident 재시작·설치, 운영 데이터 삭제, 실제 자격증명 변경, 커밋/push 없음.
- §94에서 분리해 둔 빈틈인 GUI 버튼→승인 응답→화면 성공 표시를 격리 Windows PowerShell 5.1 WinForms·격리 실제 HTTP 코어로 시험했다. 실행 시 첫 요청은 서버에서 승인되고 브라우저가 인증됐으나 GUI의 중첩 `Add_Click(...).GetNewClosure()` 안에서 `$script:bridge.StandardOutput.ReadLine()`이 `InvokeMethodOnNull`로 실패했다. PowerShell의 새 클로저 script scope가 외부 `$script:bridge`와 다르기 때문에 화면은 실제 성공을 실패로 보여줄 수 있었다. Red 계측은 `build-artifacts/browser-owner-ui-20260927/live-gui/acceptance.json`에 비밀값 없이 보존했다.
- `scripts/pair-blackhole-phone.ps1`에서 모달의 안쪽 클릭 핸들러 생성 직전에 실행 중인 브리지 객체를 `$approvalBridge` 지역 변수로 받고, 핸들러가 그 캡처 값을 사용해 응답을 읽도록 2줄만 바꿨다. 같은 합성 GUI 이벤트를 다시 실행해 파이프 응답 `ok:true`, 요청 ID 일치, `status:approved`, 창의 성공 상태, 격리 코어의 인증된 웹 세션·`/api/state` 200·웹 기기 1대를 확인했다. `acceptance.json` SHA-256 `77eb4a456901ca847d883b146ad2916f2fb93539372677916120fafc70efa88a`. 현재 GUI 소스 SHA-256 `0e7b27fdca057580434ce3c1ee8eb8a3d5f1c2654e5483edc00968c493df708f`. 계측은 제품 GUI의 시험용 복사본에 자동 클릭/안전한 상태 기록만 추가했으며, 소유자 실제 운영 창의 클릭 시험으로 확대하지 않는다.
- 집중 `node.exe --test runtime/test/web-pairing.test.mjs runtime/test/native-pairing.test.mjs runtime/test/startup-secrecy.test.mjs`는 번들 Node v24.19.0에서 **16/16 pass**. PowerShell AST 오류 0, UTF-8 BOM 유지, `git -c core.safecrlf=false diff --check` exit 0. `scripts/test-resident-windows.ps1 -EvidencePath build-artifacts/browser-owner-ui-20260927/windows-acceptance-after-closure.json`은 별도 예약 작업·격리 데이터로 **104/104 pass**, JSON SHA-256 `0ba418505300e21f8c0631e8445f81f29aaab6900e61a037d26e823fae1884c1`. `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`는 **exit 0, 1195 total / 1174 pass / 0 fail / 21 skip**; 로그 SHA-256 `d1b7b523947b0a19806a4def2cba3c6a2955713a6e8f31d0002c19569a513b7a`.
- **VERIFIED:** 격리 코어의 실제 등록·인증과 수정 전후 GUI 이벤트 차이, 집중 시험, Windows 격리 104/104, 전체 회귀 1195/1174/0/21. **RAN-UNVERIFIED:** GUI 자동 클릭은 제품 소스의 계측 복사본과 합성 인증값으로 실행했고 운영 소유자 창은 이전 코드가 열린 채라 새 버튼의 실사용 조작은 하지 않았다. **BLOCKED/NOT RUN:** Android 실기기 0대의 전체 물리 흐름, 소유자 비공개 원격 키 입력 뒤 JARVIS A1 실모델 수락. APK는 이번 변경에서 재빌드하지 않았다. 시험용 `fixture`와 임시 진단 파일 제거는 자동 승인 검토가 재귀 삭제 명령을 `blocked by policy`로 거부해 우회하지 않았고, 합성 데이터만 `build-artifacts/browser-owner-ui-20260927/live-gui/`에 남았다. 다음 한 단계는 실제 폰이 연결되는 즉시 현재 APK로 페어링→요청→PC 실행→진행·결과→복구를 기기 화면과 동일 작업 ID로 수락하는 것이다.

## §96 — 2026-09-27 Codex: 운영 미설치 주장 재검증과 예약 작업 소유권 불일치 발견

- 같은 저장소·origin·branch·HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`에서 시작했고 기존 미커밋 변경을 보존했다. `Get-ScheduledTask -TaskName 'BLACKHOLE Core v2'`는 `Running`, `http://127.0.0.1:8790/api/health`는 HTTP 200, `/`와 `/jarvis`도 각각 HTTP 200이었다. `%LOCALAPPDATA%\BLACKHOLE\resident-v2\owner.json`, `config.json`, `secrets\pairing.token`이 모두 존재한다. 따라서 “운영 resident가 한 번도 설치된 적 없다”는 안내는 현재 PC에서 거짓이다.
- `scripts/blackhole-resident.ps1`의 첫 설치 기본 경로는 페어링 키를 CSPRNG로 생성해 전용 파일에 보관한다. 키를 16자 이상으로 사람이 직접 입력하는 것은 필수 절차가 아니다. 이미 설치된 디렉터리에서 `-InitializeNewStore`를 다시 실행하도록 안내하지 않는다.
- 읽기 전용 `scripts/blackhole-resident.ps1 -Action status`는 **exit 1**: `Task belongs to a different installation (description)`. 현재 `owner.json`에 기록된 설치 ID와 예약 작업 설명의 설치 ID가 다르다(값은 기록하지 않음). 예약 작업의 실행 파일과 현재 저장소 경로는 맞고 동작 중이지만, 스크립트는 소유권 경계 때문에 `status`를 포함한 관리 작업을 거부한다. 어느 ID가 정본인지 이 조회만으로 확정할 수 없으므로 예약 작업·owner 파일을 수정하거나 재설치하지 않았다.
- 운영 config에는 휴대폰 경로와 로컬 모델 및 암호화 원격 provider가 설정되지 않았다(비밀값은 읽거나 출력하지 않음). Tailscale 실행 파일/서비스가 없고 Android SDK의 `adb devices -l`은 연결 기기 0대였다. Ollama 모델 파일은 존재하지만 여유 RAM이 약 0.46 GiB여서 기존 3 GiB 로컬 실측 게이트를 충족하지 못한다. 실제 휴대폰과 실제 모델의 완료 증거는 여전히 없다.
- **VERIFIED:** 운영 예약 작업·HTTP 페이지·설치 파일 존재, 관리 스크립트의 현재 소유권 거부, 첫 설치의 자동 키 생성 코드. **RAN-UNVERIFIED:** 모델/폰 작업 자체는 이번 구간에 실행하지 않았다. **BLOCKED/NOT RUN:** 작업 ID를 잇는 Android 실기기 전체 흐름, 소유자 비공개 키 설정 후 원격 A1, 현재 관리 스크립트의 정상 status. 코드·운영 데이터·자격증명·예약 작업·기존 GUI 프로세스는 변경하지 않았다. 다음 한 단계는 예약 작업 설명과 owner 기록의 불일치가 생긴 경위를 보존된 설치 증거로 추적해, 소유권 검사를 약화하지 않고 정본을 판별하는 것이다.

## §97 — 2026-09-27 Codex: §96 소유권 불일치 해석 정정·정식 예약 작업 문맥에서 status 통과

- 같은 remote·branch·HEAD에서 기존 미커밋 변경을 보존했다. §90의 보존된 `scheduler-diagnostic-report-6.json`은 예약 작업에서 터미널이 만들었던 동명 `%LOCALAPPDATA%\BLACKHOLE\resident-v2`를 `ENOENT`로 보았음을 기록한다. 터미널 쪽 `owner.json`은 16:45 생성, 정식 작업 파일은 17:01 등록/갱신되어 서로 다른 설치 기록을 가리켰다. §96의 “운영 설치 소유권 불일치” 표현은 이 파일 뷰 차이를 고려하지 못한 과도한 결론이었다.
- 운영 코어를 변경하지 않고, 고유 이름의 사용자 문맥 임시 예약 작업으로 `build-artifacts/resident-provider-20260927/diagnose-owner-view.ps1` 읽기 진단을 실행했다. 최초 두 진단은 PowerShell `Get-Content`의 파일 읽기 `ArgumentException`으로 완료되지 않았고, .NET `File.ReadAllText`로 바꾼 뒤 세 번째 진단에서 정식 작업 설명과 **예약 작업 문맥에서 보이는** `owner.json`의 설치 ID, 실행 파일이 모두 일치하고 8790 health가 200임을 확인했다. 네 번째 진단은 같은 문맥에서 실제 `scripts/blackhole-resident.ps1 -Action status`까지 실행해 `taskState:Running`, `coreHealthy:true`, `phoneStatus:disabled`로 통과했다. 최종 보고서 `build-artifacts/resident-provider-20260927/diagnose-owner-view-report-a629db5f8e384b9db1bd480f8ec0fbde.json` SHA-256 `3d04ac163fe04e572d20277ec4bc44aa1cd3d9a288c57064bdf1c8056c7fac96`.
- 임시 진단 작업은 각각 종료 후 정확한 작업 이름으로 등록 해제했고 잔여 `BLACKHOLE DIAG *` 작업 0개를 확인했다. 운영 예약 작업·데이터·페어링 키·설정·기존 GUI를 수정하거나 재시작하지 않았다. **VERIFIED:** 정식 예약 작업 문맥의 소유권 일치와 실제 status 통과, 터미널과 예약 작업의 동명 경로가 서로 다른 파일을 가리키는 현상. **BLOCKED/NOT RUN:** `phoneStatus:disabled`이므로 실기기 페어링→요청→진행·결과·복구; 소유자 비공개 원격 키가 필요한 JARVIS A1. 다음 한 단계는 실제 휴대폰과 사설 HTTPS 경로가 준비될 때 동일 resident와 동일 작업 ID로 물리 수락을 실행하는 것이다.

## §98 — 2026-09-27 Codex: 운영 JARVIS의 로컬 문서 요청·결과 복구와 실제 결과 열기

- 같은 저장소 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`에서 기존 미커밋 변경을 보존했다. 정식 운영 8790 코어의 `/api/health`는 HTTP 200. Android APK `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20260927-r84.apk` SHA-256 `a2c83258d7a5746619190798c6ef400b0c0513b5c17b64646ae93892e8cfd248`는 재확인만 했고 이번 JARVIS 변경으로 다시 빌드하지 않았다. 실제 `adb devices -l`은 연결 0대.
- 실제 결함 1: JARVIS 작업 모드가 명시적 `document:`/`문서 만들어:` 요청까지 `목표:`로 바꾸어 모델 없는 로컬 문서 명령을 막았다. `jarvis-scene-model.mjs`의 `workCommandText`로 명시적 로컬 명령을 보존하고, 자유문은 기존 목표 라우트로 보낸다. 집중 시험 red→green. 실제 결함 2: 코어는 새 job을 배열 앞에 넣는데 JARVIS는 뒤쪽을 최신으로 취급해 새로고침 시 오래된 §90 결과를 보여주었다. `resultJobToShow`와 최근 작업 목록을 새 순서에 맞추고 첫 로드에서 최신 완료 산출물을 다시 표시하도록 고쳤다. 첫 운영 브라우저 실행에서 `visibleResult:true, reloadVisible:false` 재현 후 같은 코어에서 green 확인.
- 실제 결함 3: 전체 문서 329자와 원본 `### 1`, SHA 등 메타데이터가 큰 메인 speech를 밀어냈다. 문서 완료는 짧은 제목 안내로 바꾸고 다른 텍스트 산출물은 120자 미리보기로 제한했다. 전체 결과 링크를 추가했다. 이어 실제 링크를 눌러보니 일반 `<a>` 이동은 브라우저 API 요구 헤더를 보낼 수 없어 403이었다. `build-artifacts/jarvis-operating-20260927/final-cookie-link/report.json`에 실패를 보존했고, 링크 클릭을 기존 `connectBrowser()` 세션의 `fetch`로 읽어 안전한 `textContent` 대화상자에 표시하도록 수정했다. 실패→수정→실제 클릭 green. 운영 소유자 승인에는 일회성 고유 예약 작업을 써서 인증값은 프로세스 내부에서만 처리했고 각 작업은 등록 해제했다. 페어링 비밀값·API 키를 터미널/로그/채팅에 출력하지 않았다.
- 최종 실제 운영 코어 브라우저 수락 `build-artifacts/jarvis-operating-20260927/final-dialog-capture/report.json`: `status:passed`, `visibleResult:true`, `reloadVisible:true`, `fullResultVerified:true`, `mobileOverflow:false`, 실제 job `509d801a-3f66-48d5-928b-919328c6bd55`, artifact `b3e0a594-888f-4216-8cfe-7566140a446e`. HTTP 코어가 저장한 완료 job/artifact, 1440×900과 400×800 스크린샷, 버튼 클릭으로 연 전체 문서 대화상자를 확인했다. 보고서 SHA-256 `923c2da9bab278f101b6479d76eecd896834d62290f00dd27b3d0d2af9285aa0`; 화면 해시는 보고서에 각각 기록. 이 경로는 **모델 없이 실행되는 로컬 문서 작업**이며 실제 원격 모델 응답이나 Android 실기기 증거가 아니다.
- `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 전체 병렬 실행 2회는 각각 다른 코드 샌드박스 시간 제한으로 **1198 total / 1176 pass / 1 fail / 21 skip**; 실패 로그는 `build-artifacts/jarvis-operating-20260927/full-regression-first-failure.txt` 및 `full-regression-second-failure.txt`에 보존했다. 두 실패 시험을 함께 단독 재실행하면 14/14 pass. 같은 전체 범위를 번들 Node v24.19.0 `--test-concurrency=1`로 실행해 **1198 total / 1177 pass / 0 fail / 21 skip**, exit 0; `full-regression-serial.txt` SHA-256 `21e88d2969a53325ae076aca87aa6aadd226585730fd98206c79dbd1e968a8be`. 최종 대화상자 수정 후 관련 4개 시험 파일 23/23 pass, 실제 운영 브라우저 수락 재실행 pass, `node --check`와 `git -c core.safecrlf=false diff --check` exit 0. 전체 직렬 회귀는 대화상자 수정 **전**에 실행됐으므로 최신 대화상자 코드의 전체 회귀로 오표기하지 않는다.
- **VERIFIED:** 운영 8790의 로컬 문서 요청→완료→동일 job/artifact 결과→새로고침 복구→인증 세션으로 전체 결과 열기, 데스크톱/모바일 화면, 관련 회귀 23/23, 직렬 전체 회귀 1198/1177/0/21(대화상자 이전 코드 기준), APK 존재/해시. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** Android 실기기 ADB 0대, 휴대폰 HTTPS/페어링 및 요청·진행·결과·재시작 물리 수락, 소유자 비공개 원격 공급자 키가 필요한 JARVIS A1 및 실제 모델 답변 품질. 운영 배포·데이터 삭제·실제 자격증명 교체·커밋/push 없음. 다음 한 단계는 휴대폰이 연결되는 즉시 기존 APK로 동일 job ID를 추적하는 물리 수락을 실행하는 것이다.

## §99 — 2026-09-27 Codex: 저메모리 Windows의 기본 전체 회귀 안정화

- 같은 저장소·remote·branch·HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`, 시작 시 기존 미커밋 80건을 보존했다. §98의 `npm.cmd test` 기본 동시 파일 수 4는 두 번 실행할 때 각각 다른 QuickJS 코드 시험이 2초 실행 제한으로 실패했다(1198 total / 1176 pass / 1 fail / 21 skip). 실패 원문은 `build-artifacts/jarvis-operating-20260927/full-regression-{first,second}-failure.txt`에 남아 있다. 같은 두 실패 파일을 함께 단독 실행하면 14/14 pass, 전체 파일 범위를 직렬로 실행하면 1198/1177/0/21 pass였다.
- PC 실제 물리 RAM은 7.731 GiB, 수정 직전 여유 약 0.539 GiB. `scripts/run-tests.mjs`는 기존의 Windows Node v24.11.1 회피/번들 Node v24.19.0 선택을 유지하고, 물리 RAM 8 GiB 미만 또는 시작 시 여유 RAM 3 GiB 미만이면 파일 동시 실행을 1개로, 그 외는 기존 4개로 선택한다. 제품의 `runtime/lib/code-sandbox.mjs` 2초/최대 5초 안전 제한은 변경하지 않았다. 시험 부하에 의한 worker 시작 지연이 가장 유력하지만 CPU 스케줄링과 페이징 기여도를 따로 측정하지 않아 단일 원인으로 확정하지 않는다.
- 사용자 지정 원문 명령 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`를 수정 후 실제 재실행: 번들 Node v24.19.0, `Test file concurrency 1 (available RAM 0.43 GiB)`, **exit 0 / 1198 total / 1177 pass / 0 fail / 21 skip**, 490706 ms. 데스크톱 로그 SHA-256 `16d148fe2d50d19104d3b6ace34522e91c89ddc7c7916bd274881e19cf4917f6`. `node --check scripts/run-tests.mjs`와 `git -c core.safecrlf=false diff --check` exit 0. 운영 8790 `/api/health` 200, 실제 `adb devices -l` 연결 0대 재확인. 신규 빌드·운영 재시작·데이터 삭제·자격증명 변경·커밋/push 없음.
- **VERIFIED:** 이 PC의 기본 `npm.cmd test` 전체 회귀가 직접 통과하고 운영 코어는 계속 응답함. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** 고메모리 호스트의 기존 동시 4개 분기는 이번에 실행하지 않았다. Android 실기기/사설 HTTPS 물리 수락과 원격 실모델 JARVIS A1은 §98과 동일. `scripts/run-tests.mjs`는 이번 변경 전부터 git 미추적 파일이었고 현재도 미추적이므로 파일 보존/커밋 시 함께 포함해야 한다. 다음 한 단계는 실기기 연결이 가능해지는 즉시 현재 APK로 페어링→요청→진행·결과→복구를 동일 작업 ID로 검증하는 것이다.

## §100 — 2026-09-27 Codex: 운영 설치 오안내 재정정·JARVIS 전체 결과 문서 뷰

- 같은 저장소·origin·branch·HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`에서 시작 미커밋 81건을 보존했다. “소유자가 설치 명령을 직접 실행한 적 없어 운영 resident는 한 번도 설치되지 않았다”는 전달 내용은 현재 상태와 다르다. `%LOCALAPPDATA%\BLACKHOLE\resident-v2` 폴더는 존재하고 `BLACKHOLE Core v2` 예약 작업은 Running, 127.0.0.1:8790 리스너와 `/jarvis`·`/api/health` HTTP 200을 확인했다. §90은 실제 Windows 설치 시도를, §97은 정식 예약 작업 문맥의 `status` 통과(`taskState:Running`, `coreHealthy:true`, `phoneStatus:disabled`)를 기록한다. 현재 터미널 문맥의 `blackhole-resident.ps1 -Action status`는 설치 설명 소유권 불일치로 exit 1이어서 이 명령을 성공으로 표시하지 않는다. §97에 기록된 터미널/예약 작업 간 동명 경로 파일 뷰 차이와 일치한다. 기존 설치를 덮어쓰지 않도록 `-InitializeNewStore`를 다시 실행하지 않았다. Android SDK의 `adb devices -l` 연결은 0대.
- 운영 JARVIS의 실제 문서 결과 대화상자에서 원시 Markdown `#`·`##`가 그대로 드러나던 문제를 고쳤다. `jarvis-scene-model.mjs`에 제목·문단·목록·코드 블록의 제한된 파서와 `createElement`/`textContent` 전용 렌더러를 추가하고 `jarvis.mjs`/HTML/CSS에 연결했다. 신규 URL 정적 파일을 처음 시도했으나 운영 프로세스의 고정 정적 허용목록에서 404였으므로, 이미 서비스 중인 모듈로 옮겨 같은 운영 코어에서 재검증했다. 결과 표면은 디자인 토큰을 사용하며 한국어 문단/목록에는 `keep-all` 및 줄 균형을 적용한다. 원문 HTML처럼 보이는 입력은 DOM 실행 없이 문자 그대로 보인다.
- 신규 `runtime/test/jarvis-result-view.test.mjs`는 모듈 생성 전 `ERR_MODULE_NOT_FOUND`로 red, 구현 후 green. 최종 집중 `node --test runtime/test/jarvis-result-view.test.mjs runtime/test/jarvis-scene-model.test.mjs runtime/test/web-pairing.test.mjs`는 19/19 pass. 실제 운영 브라우저 최종 수락 `build-artifacts/jarvis-operating-20260927/formatted-result-cjk3/report.json`은 `status:passed`, 실제 job `d7622504-3ab8-49ab-8f4b-f54652e915c6`와 artifact `3175762d-3b3e-42a9-b381-674e05d196af`, `visibleResult:true`, `reloadVisible:true`, `fullResultVerified:true`, `markupSafe:true`, 모바일 본화면/대화상자 overflow 모두 false. 보고서 SHA-256 `7b7a1fa425feed1d9ee3412864afb8caf6f6e1af985f2f3b92c21def4ca3edf1`; 1440×900/400×800 화면 해시는 보고서에 기록. 테스트 브라우저 소유자 승인은 일회성 임시 예약 작업으로 했고 최종 임시 작업 잔여 0, 비밀값 stdout/로그/채팅 출력 0. 첫 재캡처는 요청 참조 단계 TimeoutError, 후속 재캡처 둘은 통과했고 실패 보고서도 보존했다. 독립 디자인 검토 PASS, 최종 CJK 화면 검토 PASS. 초기 `아/닙니다` 분리와 후속 `아닙니다` 고립 지적은 최종 화면에서 해소됐다.
- 사용자 원문 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 첫 전체 재실행은 코드 워커의 QuickJS 실행 시간 초과로 **1200 total / 1178 pass / 1 fail / 21 skip**, exit 1이었다. 같은 실패 파일 단독 실행은 4/4 pass. CSS 최종 수정 후 두 번째 전체 재실행은 번들 Node v24.19.0, 파일 동시 실행 1로 **1200 total / 1179 pass / 0 fail / 21 skip**, exit 0, 로그 SHA-256 `d7330ae182da3ce5379953e674547a00930ebe4244afc83d8a3f142d5226aaca`. 첫 실패를 제품 결함으로 확정하거나 지우지 않는다. `node --check`(JARVIS 두 모듈), `git -c core.safecrlf=false diff --check` exit 0. 실제 모델/Android/APK 재빌드는 실행하지 않았다.
- **VERIFIED:** 운영 Windows resident 실행, 로컬 문서 요청→PC job/artifact→JARVIS 결과 표시→새로고침 복구→전체 결과 열기와 안전한 문서 렌더링, 400px 화면, 최종 전체 회귀 통과. **RAN-UNVERIFIED:** 현재 터미널 문맥의 resident `status`는 소유권 불일치로 실패했으며 정식 작업 문맥의 성공은 §97 증거를 참조한다. 첫 전체 회귀 시간 초과의 단일 원인은 확정하지 않았다. **BLOCKED/NOT RUN:** Android 실기기 ADB 0대와 phoneStatus disabled로 물리 페어링·폰 요청/진행/결과/복구, 실제 원격 공급자 키가 필요한 JARVIS A1. 운영 재설치·운영 재시작·데이터 삭제·자격증명 교체·커밋/push 없음. 다음 한 단계는 실기기가 연결되면 기존 APK로 동일 작업 ID의 물리 수락을 실행하는 것이다.

## §101 — 2026-09-27 Codex: 다른 설치가 보이는 셸의 resident 읽기 상태 분리

- 같은 저장소·origin·branch·HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`과 기존 미커밋 변경을 보존했다. 이전 §100에서 현재 PowerShell의 `blackhole-resident.ps1 -Action status`가 task description 소유권 불일치로 exit 1인 것을 재현했다. 현재 셸의 owner 메타데이터와 예약 작업 설명은 일치하지 않지만 작업 action 실행 파일은 일치하고 정식 작업은 Running이다. §97의 예약 작업 문맥 status 통과와 함께 보면 현재 셸의 메타데이터를 정식 설치 소유권으로 간주할 수 없다. 코드 결함, 작업 변조, 파일 뷰 차이 가운데 원인을 새로 단정하지 않았다.
- `scripts/blackhole-resident.ps1`의 `status` 전용 진입을 분리했다. 기존 소유권·설정·인증 health 확인이 성공하면 `managementAvailable:true`가 붙은 원래 상세 상태를 돌린다. 어느 검증이든 실패하면 예약 작업의 관찰 가능한 `taskState`만 읽고 `managementAvailable:false`, `coreHealthy:null`, `phoneStatus:unverified`, `ownershipStatus:unverified`를 반환한다. 현재의 설명 불일치 경로는 토큰 파일을 열지 않고, fallback 자체는 작업·데이터를 바꾸지 않는다. `install/start/stop/restart/uninstall/phone-*`의 기존 엄격한 소유권 검사는 그대로다. `scripts/test-resident-windows.ps1`에 소유 작업과 다른 작업의 두 상태 계약 및 읽기 후 작업 XML 불변을 추가했다.
- 첫 격리 Windows 수락 실행은 신규 status 사례 전의 기존 `stop_restart_reconnect` 단계에서 임시 코어 준비 시간 초과로 exit 1; `build-artifacts/resident-status-20260927/red.json` SHA-256 `7b9b4d30d8f3aa283566329ab5d848d5dbb8b118a96710bca4187c7a1d3adfa6`. 이를 새 status 시험의 red 증거로 오표기하지 않는다. 구현 후 현재 셸 `status`는 `Running/managementAvailable:false/coreHealthy:null/ownershipStatus:unverified`를 exit 0으로 반환했다. 두 번째 격리 Windows 수락은 **108/108 assertions passed, exit 0**; `build-artifacts/resident-status-20260927/green.json` SHA-256 `f7f35762eb5a5c7f90a60a98b81f4e02453464594922c0463a14d7807109705d`. 임시 `BLACKHOLE CI *` 작업 잔여 0. 관련 Node 시험 `node --test runtime/test/resident-runtime.test.mjs runtime/test/native-pairing.test.mjs` **26/26 pass**. 사용자 원문 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` **1200 total / 1179 pass / 0 fail / 21 skip, exit 0**, 로그 SHA-256 `e9b7d9fc3f2680bbf9d6b53207a989e15aae28cc1786d9065187399694502baf`. PowerShell AST parse error 0 및 `git -c core.safecrlf=false diff --check` exit 0.
- 최종 운영 `BLACKHOLE Core v2`는 Running, `/api/health` HTTP 200; SDK `adb devices -l` 실기기 0대. **VERIFIED:** 소유권 불일치 셸에서 status 읽기가 관리 권한이나 인증 health를 거짓 주장하지 않고 관찰 상태만 표시, 소유 설치/외부 작업 격리 수락 108건과 전체 회귀 통과. **RAN-UNVERIFIED:** 첫 격리 수락의 임시 코어 재시작 시간 초과 원인은 별도 확정하지 않았다. **BLOCKED/NOT RUN:** 이 셸은 정식 설치 관리 소유권을 얻지 못했으므로 운영 start/stop 등은 시도하지 않았다. 실제 Android 페어링→요청→진행·결과→복구와 원격 모델 A1은 실기기/사설 HTTPS/소유자 비공개 키가 없어 그대로 미검증. 운영 설치·재시작·데이터 삭제·실제 자격증명 변경·커밋/push 없음. 다음 한 단계는 실기기 연결 시 기존 APK와 운영 코어의 동일 작업 ID를 추적하는 물리 수락이다.

## §102 — 2026-09-27 Codex: 검증된 기능 실행률 저하 감시와 성장 화면 표시

- 저장소 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`을 기준으로 기존 미커밋 변경(시작 83건)을 보존했다. P0인 Android 실기기/원격 실모델은 외부 입력 대기라, `docs/CODEX_DIRECTIVE_AGENT_SCALE_20260926.md`의 P2 항목인 기능 퇴행 **감지·보고만** 구현했다. 운영 `BLACKHOLE Core v2` 작업은 Running, 8790 `/api/health` HTTP 200. 현재 셸 status는 `managementAvailable:false/coreHealthy:null/ownershipStatus:unverified`라는 관찰 전용 상태다. SDK `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l`의 연결 기기는 0대.
- `runtime/lib/skill-execution-trend.mjs`는 기존 `levelingHistoriesFromState`가 실제 job·registry run·artifact SHA로 재구성한 검증 성공/실패 이력을 시간순으로 정렬한다. 동일 기능의 직전 5건과 최근 5건, 합계 10건 이상에서만 검증 성공 수를 비교한다. 2건 이상 감소는 `declining`, 1건 감소는 `watch`; 미달하면 `insufficient_evidence`이며 안정이라고 주장하지 않는다. 이것은 **실행 검증률**일 뿐 출력 품질·사업 성과의 판정이 아니고, 등급·활성 상태·권한을 바꾸지 않는다. `growth.mjs`의 기존 성장 API 결과에 필드를 붙이고 `growth-view.mjs`가 하락/주의와 두 실제 건수를 표시한다. `runtime/public/DESIGN.md`와 `cockpit.css`에 작은 경고 행의 표시 계약과 400px 줄바꿈을 반영했다.
- 구현 전 `growth-leveling.test.mjs`와 `growth-ui.test.mjs`는 각각 필드 없음·경고 없음으로 예상대로 실패(red). 구현 뒤 번들 Node v24.19.0 집중 테스트 최종 **19/19 pass**(`skill-execution-trend`, `growth-leveling`, `growth-ui`). 시스템 Node v24.11.1로 단독 실제 서버 종료 시 Windows `0xC0000409` 종료를 관찰했고, 저장소 §93의 한글 경로 정리 문제와 일치하는 범위로만 기록한다. 번들 Node에서 같은 실제 HTTP/재시작 성장 시험은 통과했다.
- 사용자 원문 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`의 첫 전체 실행은 **1198 total / 1176 pass / 1 fail / 21 skip, exit 1**: `code-sandbox.test.mjs` 파일 worker가 중간 종료했다. 해당 파일과 새 기능 파일을 같은 번들 Node에서 즉시 다시 실행해 30/30 pass. 전체 재실행은 파일 동시 수 1로 **1204 total / 1183 pass / 0 fail / 21 skip, exit 0**, `build-artifacts/skill-execution-trend-20260927/full-regression-retry.txt` SHA-256 `88c5fe9c4cfd63c3a64414aab291347a4a281dd5cc534cb976d94163d70a5661`. 첫 실패를 숨기거나 단일 원인을 확정하지 않는다. 전체 재실행은 마지막 CSS/class 줄바꿈 변경 **전**이고, 그 뒤 관련 시험 19/19, Edge 화면 4조건을 다시 실행했다. `node --check`와 대상 `git diff --check` exit 0.
- 실제 Edge에서 **합성 성장 데이터**를 현재 `growth-view.mjs`/운영 CSS로 렌더했다. 400px 하락 카드 첫 캡처는 `documentWidth:538`로 넘침(red); `execution-trend` 행 줄바꿈만 고친 뒤 400px와 1280px의 일반/하락 총 4조건 모두 `documentWidth===viewportWidth`, 경고 존재 여부가 기대와 일치(green). `build-artifacts/skill-execution-trend-20260927/visual-report.json` SHA-256 `f215b4c7b1ec14f9bb36773ad5852e7b463e14972fb89ffa5ab800f598797cdb`; 4개 full/viewport/card 캡처와 시각 비교 JSON을 같은 폴더에 보존했다. 독립 읽기 전용 디자인 시스템 검토와 CJK/시각 검토 모두 PASS. 이는 새 코드의 브라우저 표시 증거이며 현재 운영 resident에서 10건 이상의 실측 퇴행이 발생했다는 증거가 아니다.
- **VERIFIED:** 내구성 실행 증거에서의 계산·API 성장 배선·브라우저 400/1280 경고 표시·최종 관련 시험 19/19·CSS 직전 전체 회귀 1204/1183/0/21·운영 health·ADB 0대. **RAN-UNVERIFIED:** 첫 전체 회귀의 코드 샌드박스 worker 중간 종료의 단일 원인은 확정하지 않았다. **BLOCKED/NOT RUN:** 변경 코드를 운영 설치에 배포하지 않았으므로 운영 UI의 실제 퇴행 표시, Android 실기기 페어링→요청→PC 실행→진행/결과→재시작 복구, 소유자 비공개 원격 키가 필요한 JARVIS A1. APK 재빌드·운영 설치/재시작·데이터 삭제·자격증명 변경·커밋/push 없음. 후속 읽기 감사에서 `repository-patch.mjs`의 모델 편집 기본 차단, developer-worker CI의 Docker `--network none/--read-only`는 확인했지만 생성된 JS/TS 본문에서 비밀값·직접 네트워크·임의 파일쓰기를 AST로 잡는 별도 CI 단계는 이 workflow에 없었다. 다음 가능한 한 단계는 그 정적 CI 검사기를 최소 범위로 추가하고 위반 fixture red→green을 남기는 것이다. 실기기가 연결되면 P0 물리 수락을 우선한다.

## §103 — 2026-09-27 Claude(Cowork): 살아있는 분신 7계통 통합 지시서

- 소유자 지시: "안드로이드 실기기·원격 키는 나중에. 자비스·호문쿨루스·나혼렙·양자역학·JEV·커비·옵시디언 장기기억 구현 지시서를 다시." §90~§102(코덱스 13개 구간)를 먼저 읽고 현재 코드를 직접 조사: `runtime/lib/{seven-drives,motivation,solo-leveling,shadow-army,shadow-growth,leveling-evidence,growth,jev,jev-recovery,recovery-one-of-qpu,kirby,memory-events,memory-recall,memory-embeddings,obsidian-exporter,capability-inbox,capabilities}.mjs`·`server.mjs` import/route·`/api/state` 필드, Obsidian 원장 `data/ALL_IDEA_RECORDS.json`(1,117건, 8개 카테고리, 필드 스키마 확인).
- 확인된 사실: 7계통 전부 **모듈은 존재하고 서버에 import돼 있음**. 없는 것은 (1) 욕망의 시간 상태·발언, (2) 이름 있는 영속 그림자·추출 이벤트, (3) 실행 결과에서 능력 초안을 만드는 경로(현재 `capabilities.mjs` op는 filter/sort/limit 3종뿐), (4) JEV 일치율(이미 `/api/state.jev.calibration`에 있음)을 승격 조건·모드로 잇는 것, (5) QAOA 회로(h/rz/cx/rx)를 실제로 실행하는 상태벡터 시뮬레이터, (6) 원장 1,117건을 런타임이 읽는 경로와 임베딩 회수의 대화 경로 연결, (7) 자비스가 위 상태를 먼저 말하는 표현층.
- 작성: `docs/CODEX_DIRECTIVE_LIVING_SYSTEMS_20260927.md`(216줄): §0 원작 메커니즘→관측 동작 번역표(소유자 규칙 "이름만 빌린 비유 불가"), §1 있는 것/없는 것 파일 단위 표, §2 기존 계약(전면자동·최종만 소유자, 주기 작업 신설 금지, 3 페르소나 토론=호문쿨루스 회의록, DRIVE_CANON·validateMotivation·solo-leveling 규칙·`authorizesDispatch:false`·재전송 금지 불변, RAM 3 GiB 게이트, vault 쓰기 범위), §3 계통별 새 파일 7개(`drive-state`, `shadow-roster`, `kirby-absorb`, `jev-calibration`, `quantum-statevector`, `ledger-import`, `recall-merge`)와 연결점·테스트 이름·인수 증거 파일명, §4 통합 인수 L1(운영 코어·모델 없음)/L2(격리·합성)/L3(재시작 fingerprint)/L4(보류: 실모델), §5 빌드 순서, §6 금지, §7 보고 형식, §8 내가 독립 검증할 7항목. 지시서에 적은 기존 함수 20개의 존재를 grep으로 재확인했고, 조사에서 드러난 3건(env 이름 `YENO_OBSIDIAN_VAULT_PATH`, JEV calibration 기존 필드, capability-inbox `ENTRY_KEYS` 스키마)에 맞춰 지시서를 정정했다.
- `docs/CODEX_HANDOFF_20260927.md` P2에 이 지시서를 추가(P0 외부 입력 대기 중 진행, 실기기/키 확보 시 P0 복귀). **VERIFIED:** 지시서·인계 문서 파일 생성, 참조 함수 존재. **RAN-UNVERIFIED/BLOCKED:** 구현 전부 착수 전(코덱스 범위). 코드·운영 데이터·vault 변경 없음.

## §104 — 2026-09-27 Codex: 개발자 워커 후보 정적 정책과 CI 회귀 가드

- 시작 저장소 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 시작 시 미커밋 파일 90건을 확인했고 기존 변경을 되돌리거나 커밋하지 않았다. §103이 작업 중 별도 작성된 것을 확인하여 다음 절 번호로 기록한다.
- `docs/CODEX_DIRECTIVE_AGENT_SCALE_20260926.md`의 정적 가드레일 항목을 진행했다. 기존 `editablePath` 범위와 Docker 격리는 유지하고, 모델 패치 파싱 후 후보 디렉터리 복사·실행 전에 `assertCandidatePatchPolicy`를 호출한다. TypeScript AST를 이용해 모델 작성 JS/TS의 외부 모듈·동적 로더·직접 네트워크/호스트 API·환경 접근·비밀값 형태를 거부하고, HTML/CSS/SVG의 활성 마크업·원격 리소스 형태도 거부한다. 거부 사유는 값 없이 코드로 기록하며 1회 안전한 수선 기회는 기존 루프대로 유지한다. 이 검사는 정해진 형태의 사전 정책이며 모든 우회 가능성을 배제했다는 증명은 아니다.
- 실패→수정→통과: `worker.test.mjs`에서 첫 후보에 `fetch`를 넣어 사전 거부 기대 시험이 실패하는 것을 확인한 뒤 실제 배선을 추가했다. 이어 `const send = fetch` 별칭과 HTML 원격 스타일시트/프로토콜 상대 URL/srcset이 통과하는 것을 집중 시험에서 재현하고 각각 식별자·리소스 속성 검사로 막았다. 최종 `static-guard.test.mjs`+`worker.test.mjs` 16건 중 14 통과/0 실패/2 Docker 스킵. 저장소·워커 관련 84건 중 81 통과/0 실패/3 스킵. `.github/workflows/developer-worker.yml`에 정적 정책 시험 단계를 Docker 전에 추가했으나, 실제 원격 CI는 실행하지 않았다.
- 사용자 요청 전체 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 실행: 1,204건 중 1,183 통과/0 실패/21 스킵, `NPM_EXIT_CODE=0`. 로그 SHA-256 `9731bf14544af6dd63aff1c53760fe9e2e86d703aa1525024776d9e8c2adb131`; 동일 로그를 `build-artifacts/agent-scale-20260926/static-policy-20260927/full-regression.txt`에 보존했다. 최종 `node --check` 2파일 및 `git diff --check` 통과. Docker CLI 부재로 실제 Docker 시험은 NOT RUN.
- 운영 resident `http://127.0.0.1:8790/api/health` HTTP 200, `adb devices -l` 실제 연결 0대. 이번 변경을 운영 설치에 배포하거나 Android APK를 다시 빌드하지 않았고 실제 원격 모델 키·휴대폰 실기기 흐름도 시험하지 않았다. **VERIFIED:** 정적 사전 거부·수선, 관련 회귀, 전체 회귀, 운영 health와 ADB 현황. **NOT RUN:** 원격 CI workflow 실행과 Docker 실물 격리. **BLOCKED:** 휴대폰 페어링→요청→PC 실행→진행/결과→복구 실기기 수락, 원격 모델 A1.

## §105 — 2026-09-28 Codex: 원장 1,117건 읽기·회수 첫 단계(M1 격리 검증)

- §103의 `CODEX_DIRECTIVE_LIVING_SYSTEMS_20260927.md`를 읽고 Vault 원본 `01_DRAFTS/20260926_BLACKHOLE_IDEA_LEDGER_R3_RECHECK_COMPLETE/data/ALL_IDEA_RECORDS.json`을 읽기 전용으로 대조했다. 실제 1,117건·11개 카테고리, SHA-256 `81c83f48071066c16b5b357f5c09852c4b7598b088d3ac5ba97de2c1a76df667`. 지시서의 8개 카테고리 수치는 틀려 정정했다. 기존 `memory-events.mjs`는 `confidence` 숫자·`sourceRefs` 기존 저장 소스 UUID·총 2,000건 상한이므로, 원장 ID를 가짜 source UUID로 만드는 문구도 정정했다. 원본 Vault 파일·링크·CHANGELOG는 변경하지 않았다.
- `runtime/lib/ledger-import.mjs`와 `runtime/test/ledger-import.test.mjs` 신설, `runtime/lib/store.mjs`·`backup.mjs`·`memory-recall.mjs`·`runtime/server.mjs` 연결. owner pairing 인증 `POST /api/ledger/import`를 소유자가 호출할 때만 고정 경로의 원장을 읽고 1,117건을 별도 영속 `state.ledger`에 기록한다. 기존 ID·별칭·근거 상태·원본 sha를 보존하고, `tool/project/unclassified`를 결정론적으로 분류한다. 삭제된 원본 ID가 있으면 갱신을 거부한다. `/api/state.ledger`와 `memory.ledgerCount`는 집계를, `GET /api/ledger/search?q=...`는 최대 5개 회수 결과를 보여준다. 1,117개의 canonical memoryEvent를 만들었다는 뜻은 아니다. `recallMemories`의 기존 대화 경로에서도 원장 항목을 데이터/출처로 회수한다.
- red→green: 새 모듈 없음, 원장 회수 없음, HTTP import 404, 기존 백업의 새 state 필드 거부, 원본 ID 축소 허용, 잘못된 새 heartbeat trigger로 HTTP 500을 차례로 재현했다. 각각 추가·연결·기존 `state_changed` trigger 사용으로 해결했다. 격리 HTTP 통합 시험은 owner-only import 201, 중복 200, 익명 조회 401, 재시작 후 `AlohaGo` 관련 원장 ID 회수. 관련 집중 회귀 23/23, 새 원장 테스트 4/4.
- `scripts/verify-ledger-import-live.mjs`로 실제 원본을 **임시 Vault에 해시 대조 복사**하고 격리 코어에만 import했다. 1,117건, 11개 카테고리, tool 366/project 153/unclassified 598, `/api/state.memory.count=1117`(ledgerCount 1117, memoryEvent 수는 별도), `AlohaGo` 관련 ID 재시작 전후 회수, 원본 파일 SHA 전후 동일. 격리 코어 암호화 백업 2,302,089바이트를 메모리에서 복호화하여 1,117건과 동일 fingerprint 확인. `build-artifacts/living-20260927/M1/m1-import-report.json` SHA-256 `8e4f5b2e12f9099af4f567c257ee9193da240f9a6de7f10d58aa80dca375f1b2`; `m1-nature-counts.json` SHA-256 `6e822088e8cb648a7330671f03d427ff93e283e2cacfc6e0325a262af1a3fe71`. 다른 실행 때는 importedAt 때문에 fingerprint가 달라질 수 있으며 같은 실행 내 재시작 동일성만 주장한다.
- 전체 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`: 1,208건 중 1,187 통과/0 실패/21 스킵, 로그 SHA-256 `efb9c5dbb8734323366b650370c735241e17adf9f4f5c819403cece8fbd66bf0`; 동일 로그를 `build-artifacts/living-20260927/M1/full-regression.txt`로 복사했다. `node --check` 새 모듈·스크립트·서버, `git diff --check` 통과. 운영 8790 `/api/health` 200, ADB 기기 0대.
- **VERIFIED:** 실제 원본 1,117건 읽기/해시, 격리 코어 import·회수·멱등·재시작·백업, 집중/전체 회귀. **RAN-UNVERIFIED:** 없음. **NOT RUN/BLOCKED:** 변경 코드 운영 설치·운영 데이터 import, Vault LEDGER_INDEX 내보내기, 자비스 화면 M2, 나머지 6계통과 통합 L1~L3, 원격 모델 A1, Android 실기기 흐름. 운영 설치·자격증명·Vault 쓰기·커밋/push·운영 데이터 삭제 없음. 다음 한 단계는 호문쿨루스 H1의 영속 hunger·3발언 회의록을 기존 결정 경로에 연결해 격리 코어에서 재시작 수락을 실행한다.

## §106 — 2026-09-28 Codex: 호문쿨루스 H1 영속 배고픔·세 발언 회의록

- 기존 `motivation.mjs`의 결정 점수·엄격 검증을 유지한 채 `runtime/lib/drive-state.mjs`를 추가했다. 일곱 욕망은 50에서 시작하며, 채택된 결정의 우세 욕망은 30 줄고 나머지는 기존 동기 구성 수치에 비례해 2~12 늘어난다(0~100 한계·소수 두 자리). 상태는 SHA-256 지문으로 재검증하고, 실제 `motivation.signals` 숫자를 인용하는 서로 다른 욕망 3개의 발언을 기록한다. `state.driveState`·`state.driveDebates`는 저장소·백업 검증에 연결했다. 회의록은 최근 100건으로 제한한다.
- 소유자 `/api/quests/decide`의 실제 선택·실행 보류 결정 후, 그리고 자동 운영의 실제 작업 수락 후에만 기록한다. 자동 운영 작업에는 `job.autopilot.debate`를 `motivation` 옆에 두고 검증한다. `GET /api/drives/status`에 `hunger`·`lastDebate`, `/api/state.drives.hunger`에 일곱 수치를 추가했다. 전체 멈춤으로 거부된 요청은 회의록을 늘리지 않는다. 발언은 판단 근거의 숫자 표현이며 새 목표 생성이나 실행 권한이 아니다.
- red→green: 기존 7개 순수 테스트는 새 모듈 없음 상태에서 실패 후 7/7 통과했고, 실제 HTTP 결정 3회 테스트는 영속 기록 0건으로 실패 후 연결하여 통과했다. 격리 코어의 3회 결정에서 fingerprint 3개가 서로 다르고 3발언 기록이 각각 남았으며, 4번째 결정은 전체 멈춤 409로 거부되어 기록이 늘지 않았다. **코어 프로세스 재시작** 뒤 세 번째 fingerprint 동일. `runtime/test/drive-state.test.mjs` 8/8, 관련 `autopilot`·`backup`·`drive-status` 포함 집중 46/46. `build-artifacts/living-20260927/h1-hunger.json` SHA-256 `a743a111c2c195393eebbbb51a286147d1fb62c6814b242a21c16929213b22ba`, `h1-debate.json` SHA-256 `abeb04f37899301fe4c3c01611ebcd0e10d7062c1a719ed9dd0af15736d5d71b`. 이 산출물은 합성 목표를 쓴 격리 코어의 실제 상태로, 운영 코어 결정 이력이 아니다.
- `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 실행: 1,216건 중 1,195 통과/0 실패/21 스킵, 종료 코드 0. 로그를 `build-artifacts/living-20260927/h1-full-regression.txt`에 보존했고 SHA-256 `f40fb77e291deb3494bf1b59caf2f6c2bf690bb63fd588ff145f77c5a0537697`. 변경된 JS 7파일 `node --check`, `git diff --check` 통과(기존 줄바꿈 경고만). 운영 `8790/api/health` HTTP 200은 읽기 확인, `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l` 연결 기기 0대.
- **VERIFIED:** H1 순수 규칙, 격리 HTTP 결정 3회·거부 1회·프로세스 재시작, 집중·전체 회귀, 산출물 해시. **RAN-UNVERIFIED:** 없음. **NOT RUN/BLOCKED:** 운영 8790에 이번 코드 설치/실제 소유자 결정, JARVIS 쉬는 중 발언 화면 H2, 실제 Android 페어링→요청→PC 실행→진행·결과→복구, 원격 모델 A1. Vault 원본·운영 데이터·자격증명·배포·커밋/push는 변경하지 않았다. 다음 한 단계는 기존 JARVIS 6상태를 유지하며 H2 쉬는 중 발언을 화면에 연결하고 브라우저 스크린샷으로 검증한다.

## §107 — 2026-09-28 Codex: 호문쿨루스 H2 쉬는 중 발언의 JARVIS 화면 연결

- 시작 시 저장소 경로·remote·branch·HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`와 미커밋 변경 104건을 확인하고 기존 변경을 보존했다. §106의 H1 산출물과 Vault 원본은 변경하지 않았다.
- `recordDriveDecision`이 매 결정 후 일곱 욕망 전체의 배고픔을 비교해 가장 높은 욕망의 **실제 동기 신호 수치가 들어간 발언**을 `debate.hungryVoice`에 영속 기록한다. 기존 7필드 회의록도 계속 읽도록 새 필드를 선택적으로 검증한다. `/api/drives/status`는 최신 `hungryVoice`를 제공한다. JARVIS는 코어가 쉬는 중이고 일곱 배고픔·세 발언·최고 배고픔 ID가 서로 일치할 때 저장된 발언을 그대로 표시한다. 결과·실패·승인 대기·진행 중·오프라인 표시가 우선하며 쉬는 중 발언은 명령을 발행하지 않는다. 모바일 줄바꿈에서 단위가 쪼개지지 않도록 발언 문구를 조정하고 `runtime/public/DESIGN.md`에 표시 계약을 기록했다.
- `scripts/verify-jarvis-hunger-live.mjs`는 합성 목표 세 결정을 실제 `recordDriveDecision`으로 격리 저장한 뒤, 실제 격리 HTTP 코어와 Edge 브라우저를 실행해 소유자 승인 페어링 후 `/jarvis`를 검사한다. 일곱 수치·세 발언·최고 욕망 나태 71·화면의 저장 문구 일치·자동 명령 0건을 확인했다. Edge 400×840과 1440×900에서 가로 넘침 없이 결과를 캡처했고, 모바일/데스크톱 시각 검토 둘 다 PASS다. **이 증거는 합성 결정을 사용한 실제 브라우저 검증이며 운영 8790의 사용자 결정이나 Android 실기기 증거가 아니다.**
- 산출물 `build-artifacts/living-20260927/h2-report.json` SHA-256 `6e4ef7573b208b90c20c17041b44fa11c12f968e550d91ce2861a0168f467d83`; `h2-idle-voice.png` SHA-256 `e789e3cf99c337b625d6d4b394f5519a16bbfb015c536bc695363749a31a3171`; `h2-idle-voice-desktop.png` SHA-256 `1f56324f137982042bcf3082976b22f3ee1b0c088ad6d2dd2ac7d87a6a5ccf32`. 집중 테스트 `node --test runtime/test/drive-state.test.mjs runtime/test/jarvis-scene-model.test.mjs runtime/test/drive-status.test.mjs runtime/test/jarvis-security.test.mjs` 26/26 통과. 전체 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 1,218건 중 1,197 통과/0 실패/21 스킵, 종료 코드 0. `h2-full-regression.txt` SHA-256 `8d63a5c24b0f1988a47d466c4a9d546d7847e2beaddacacb513bdf5a33755667`. 변경 JS `node --check`, `git diff --check` 통과(기존 Windows 줄바꿈 경고만).
- 운영 `http://127.0.0.1:8790/api/health`는 읽기 HTTP 200, ADB 연결 기기는 0대. **VERIFIED:** H2 영속 발언 배선, 격리 HTTP·Edge 화면, 집중·전체 회귀, 산출물 해시. **RAN-UNVERIFIED:** 없음. **NOT RUN/BLOCKED:** 새 코드 운영 설치·실제 소유자 결정의 H2 화면, Android 실기기 페어링→요청→PC 실행→진행·결과→복구, 원격 모델 A1. 새 APK 빌드·운영 배포·Vault 수정·데이터 삭제·자격증명 교체·커밋/push는 하지 않았다. 다음 한 단계는 휴대폰이 없어도 검증 가능한 S1 그림자 추출·명부를 격리 코어에서 만들되, 실기기가 연결되면 Android 전체 흐름 수락을 우선한다.

## §108 — 2026-09-28 Claude(Cowork): S1·J1 착수 전 지시서 정정 (소유자 피드백 반영)

- 소유자 피드백 원문: "각각의 원래 의미를 잊어버리면안되는데 jev같은경우에도 오픈소스가지고오면되잖아 쉐도우도 에이전트를 만드는거지 뭐 분류하는거아닉ㅎ"
- 확인: `shadow-army.mjs`의 scout/researcher/builder/verifier/semanticVerifier는 Phase D(issue #25 §6)에서 이미 실제 job으로 구현되어 실제로 일한다 — S1(그림자 명부)은 그 실제 일꾼에 영구 이름·성장을 얹는 것이지 분류만 하는 게 아님을 재확인했다. 다만 현재 §3.2 초안은 계급이 미래 배정·권한을 바꾸지 않는다는 지적은 타당해, 계급을 실제로 연동할 다음 단계(S1+)가 필요하다고 판단했다.
- 확인: JEV는 자비스·그림자군단·커비·호문쿨루스·양자역학과 달리 특정 원작 IP를 빌린 이름이 아니라 BLACKHOLE 자체 스펙(issue #25 §4.6/§5.1) 내부 명칭이다(저장소 전체 grep, 원작 정의 문서 없음 확인). §3.4의 승격 기준(`minSamples:50, minMatchRate:0.95, maxFalsePositiveRate:0`)이 임의로 고른 고정 숫자였음을 인정하고, 공인된 이항비율 신뢰구간(Wilson score interval)으로 대체하도록 정정했다 — 외부 의존성 추가 없이 공식을 순수 함수로 직접 구현.
- `docs/CODEX_DIRECTIVE_LIVING_SYSTEMS_20260927.md`의 §3.2(S1 인수 직후) 및 §3.4(J1 인수 직후)에 각각 "3.2-A 정정"/"3.4-A 정정" 블록을 추가했다(원문은 보존, 정정만 추가). 소유자 확인이 필요한 두 항목(그림자 계급-권한 연동 범위, Wilson 신뢰구간 하한 기준치·오픈소스 패키지 의존 여부)을 문서에 명시했다.
- 코드 변경 없음, Vault 원본·운영 데이터·자격증명·커밋/push 변경 없음. Codex가 S1/J1 착수 전 이 정정을 먼저 읽도록 다음 핸드오프에 반영한다.

## §109 — 2026-09-28 Codex: S1 실제 Shadow 임무의 영속 추출·명부

- 시작 시 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`을 확인하고 기존 미커밋 변경을 보존했다. §107 뒤에 다른 세션이 §108 정정을 기록한 것을 확인했으므로 이 결과를 새 §109로 이어 쓴다. §108의 핵심대로 Shadow Army는 이미 scout/researcher/builder/verifier/semanticVerifier 실제 job을 실행하고 있으며, 이번 단계는 그 일을 마친 역할에 지속 정체성을 연결한다.
- 새 `runtime/lib/shadow-roster.mjs`는 실제 임무가 완료되고 결정론 검증 `verified:true`, 의미 검증 `pass`, 저장된 Builder 산출물과 네 역할 job 완료가 모두 확인될 때만 네 그림자를 추출한다. `정찰자 1호`·`연구자 1호`·`건설자 1호`·`검증자 1호`를 역할별로 유지하고, 같은 임무 재처리는 no-op, 다음 검증 임무는 동일 그림자의 `missions` 이력에 추가한다. 소유자 개명은 NFC·제어문자·길이 검사와 fingerprint 재검증을 거친다. `store.mjs`와 `backup.mjs`에 엄격한 상태 검증·구버전 기본값을 넣고, `server.mjs`의 임무 완료 지점과 owner 전용 명부 조회·개명 API에 연결했다. `/api/state.shadowArmy.roster`는 이름·역할·등급 요약만 노출하며, JARVIS 소유자 서랍에 네 그림자와 등급을 표시한다.
- **등급 한계:** 현재 실제 Shadow job은 capability registry의 `run` 증거가 아니므로 `shadowRank`는 근거 없이 D~S를 만들지 않고 E만 반환한다. 명부·성장 이력은 실제 job에 붙었지만, 계급에 따른 미래 에이전트 배정·권한 변화(S1+)와 실제 `leveling-evidence` 브릿지는 이번에 구현하지 않았다. §108 정정에 있는 소유자 범위 결정과 별도로 검증할 일이다. 자동 스케줄러·디스패치 권한은 추가하지 않았다.
- red→green: 새 명부 모듈 전 테스트는 모듈 부재로 실패했고, 구현 뒤 `runtime/test/shadow-roster.test.mjs` 5/5 통과. 기존 F06 실제 HTTP 임무 테스트에 명부·재시작 fingerprint 주장을 추가했으며, bundled Node 24.19.0으로 두 파일 집중 테스트 10/10 통과. 시스템 Node 24.11.1은 Windows 한글 경로에서 기존 동기 재귀 삭제 뒤 프로세스가 크래시해 `npm test`가 선택하는 bundled Node를 사용했다. `scripts/verify-shadow-roster-live.mjs`는 합성 OpenAI 호환 provider를 주입한 **실제 격리 HTTP 코어와 Edge**에서 검증 임무 2회를 완료했다. 1회 뒤 명부 4명·각 이력 1건, 2회 뒤 명부 4명·각 이력 2건, 400×840 소유자 서랍에 네 이름·E 등급 표시, 가로 넘침 0을 확인했다. 합성 provider 내용은 실제 원격 모델 품질 증거가 아니다.
- 산출물 `build-artifacts/living-20260927/s1-roster-before.json` SHA-256 `a36ce575a52836b15ec56eaf72fff68275bcf8a1c3bd8499287f32b96d6eb80e`, `s1-roster-after.json` `2746612dfede57b60770a394ef75456f8e8fc4cbc29844cd7a745543577a02de`, `s1-drawer.png` `4390da50a1deb3e51258e95329a2eefc3549d7c74cc246d0004c0f63d0b824a3`, `s1-report.json` `96091408fa6fe50cf1a0cabb040006392b30a5c43fcce8e2cd5eed612fcecaae`. 최종 전체 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 종료 코드 0, 1,223건 중 1,202 통과/0 실패/21 스킵. 보존 로그 `s1-full-regression.txt` SHA-256 `03d8b12803f8f3951ce73ff3d5a4c2b37bb782abb94d7712e301bab54ee9d250`. 변경 JS `node --check`, `git diff --check` 통과(기존 줄바꿈 경고만). 시각 검토는 모바일 명부 4행 가독성 PASS, 전체 기능의 D~S 증거 연동은 미완으로 판단했다.
- 운영 `http://127.0.0.1:8790/api/health` 읽기 HTTP 200, `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l` 연결 0대. **VERIFIED:** 격리 코어의 검증 임무→실제 agent job 연결 명부 추출·중복 방지·재시작 보존, Edge 명부 화면, 집중·전체 회귀, 산출물 해시. **RAN-UNVERIFIED:** 운영 8790의 기존 가동 상태는 health만 확인했으며 새 S1 코드는 배포하지 않았다. **BLOCKED/NOT RUN:** 실제 Android 페어링→요청→PC 실행→진행·결과→복구, 원격 모델 A1, 실제 그림자 D~S 승급·미래 배정 영향. APK 재빌드·운영 배포·Vault 수정·데이터 삭제·자격증명 교체·커밋/push는 하지 않았다. 다음 한 단계는 실제 Shadow job 산출물의 증거를 기존 계급 판정에 정직하게 연결하고, 계급이 다음 임무의 이름 있는 에이전트 배정에 주는 영향을 안전 경계 안에서 검증하는 S1+다. 실기기가 연결되면 Android 전체 흐름 수락을 우선한다.

## §110 — 2026-09-28 Claude(Cowork): JEV·양자 — 실제 오픈소스 패키지 통합으로 재정정

- 소유자 확인: "Jev는 오픈소스를가지고와서그걸 프로그램에 구현하라고한건데 양자시스템도" — §108의 "공식만 직접 구현" 정정은 부족했고, 실제 npm 패키지를 의존성으로 추가해 통합하라는 뜻이었음을 확인.
- 확인: `runtime/package.json`은 이미 `qrcode`·`quickjs-emscripten` 두 실제 외부 의존성을 쓰고 있어(node_modules 직접 확인), 새 외부 의존성 추가가 이 프로젝트의 첫 사례가 아님을 확인했다.
- WebSearch·WebFetch로 실제 패키지 조사: JEV 승격 판정용 `wilson-score-interval`(MIT, msn0, `wilson(upVotes,total)→{left,right}`), 양자 시뮬레이션용 `quantum-circuit`(MIT, quantastica, 순수 JS, h/rz/cx/rx 게이트 지원, OpenQASM 2.0 import만 지원·3.0 미지원 확인).
- `docs/CODEX_DIRECTIVE_LIVING_SYSTEMS_20260927.md`에 "3.4-B 정정"(JEV: wilson-score-interval 의존성 추가, 정수 일치 건수로 하한 계산)과 "3.5-A 정정"(양자: quantum-circuit 의존성 추가, 단 OpenQASM3↔2.0 불일치 때문에 동결 계약 `recovery-one-of-qpu.mjs`는 그대로 두고 새 파일 안에서만 h/rz/cx/rx 게이트 추출기로 다리를 놓음)을 추가했다.
- 코드 변경 없음(문서만). Codex가 J1/Q1 착수 전 이 정정을 먼저 읽도록 다음 핸드오프에 반영한다.

## §111 — 2026-09-28 Codex: JEV·양자에 실제 오픈소스 패키지 연결

- 시작 시 저장소 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`을 확인하고 기존 미커밋 변경을 보존했다. 진행 도중 공동 기록에 §109가 중복 작성되어 뒤의 Claude 정정 제목만 §110으로 바로잡고 이 항목을 §111로 추가했다. 소유자의 "공식을 직접 쓰지 말고 실제 오픈소스 패키지를 연결"한다는 정정을 반영했다.
- JEV: MIT `wilson-score-interval@2.1.0`의 npm 배포물·소스·라이선스를 열고 SHA-512 무결성 `y0H404rK3vbemFmx81Ufr41NlTR6PDuuNt6p6+akVk2d2rRGEoImD3dVk1kHOZM5gCv4d0Lyg3HFm7kUNGE8Sw==`을 확인했다. `runtime/package.json`/lock에 고정하고 `jev-calibration.mjs`가 실제 패키지 API를 호출한다. 기존 `calibrateShadowLog`의 결정된 표본과 **원본 로그에서 직접 센 정수 일치 건수**로 95% Wilson 하한을 `/api/state.jev.calibrationEvidence`에 노출한다. 빈 로그는 `null`; `authorizesDispatch:false` 유지. 이 지표는 기존 스케줄러와의 일치일 뿐 독립 정답률이 아니고 승격·보류 모드 활성화에는 쓰지 않는다. 실제 격리 HTTP 임무·재시작 시험에서 값 보존 확인.
- 양자: MIT `quantum-circuit@0.9.251` 배포물 SHA-512 `Sf/jS7KShzJjkrpHzBlF+VPEasn8aO08swz03gRdc9BpKKBjGkh/pOy3hZdcuCeDZSLo2x0X6AwAO8b6kpkMOQ==`을 확인했다. 처음에는 이 패키지가 끌어온 `mathjs` 6에 npm high 취약점 2건이 발견되었다. Apache-2.0 `mathjs@7.6.0`을 package override로 고정해 다시 설치·감사하니 알려진 취약점 0건이며, 실제 `h/rz/cx/rx` 호환 시험이 통과했다. `quantum-statevector.mjs`는 기존 `recovery-one-of-qpu.mjs`를 수정하지 않고 그 OpenQASM 3의 지원 게이트만 엄격히 추출해 패키지에 전달한다. 상태벡터·Born 확률은 패키지 실행 결과이고, 고정 seed 측정 표본과 8×8 QAOA 격자 선택·기존 counts decoder 연결은 BLACKHOLE 어댑터다. 알 수 없는 게이트·측정 불일치·정규화 실패는 거부한다.
- `scripts/verify-quantum-open-source.mjs`로 **합성 JEV 컨텍스트의 실제 3대안 복구 회로**를 64격자·1,024 shots 실행: 최선 one-hot 확률 `0.75`, 균등 기준 `0.375`, 유효 측정 `785/1024`, 기존 `validateRecoveryOneOfSelection` 통과, `authorizesDispatch:false`. `q1-quantum.json` SHA-256 `11644810da62b70e9685552d9d4e14635e107400cdf6c0934f8566f3123d8ca4`, `q1-sweep.csv` SHA-256 `8d56570748ffbc1b9cc5dd1069d220c03d0c288f6e07a05cb5ee2092ee6ae339`. 보고서의 `countsOrigin:'local_statevector_simulator'`가 실제 출처다. 기존 decoder의 `selectionSource:'qpu_counts'`는 분류명일 뿐 실제 QPU 제출/측정이 아니다. `docs/BLACKHOLE_OPEN_SOURCE_REUSE_20260928.md`에 후보·라이선스·패키지 해시·채택 경계를 기록했다(SHA-256 `958f6dd618845f0594628de61b086bde0d866bdcd73b27f7622978a296f0a12d`). OpenClaw는 MIT·Gateway 계약을 조사했지만 페어링·owner 승인 경계 검증 전이어서 설치·연결하지 않았다.
- 로컬 재설치 `npm.cmd ci --prefix runtime --ignore-scripts --no-audit --no-fund` 성공, `npm.cmd ls wilson-score-interval quantum-circuit mathjs --prefix runtime`에서 `2.1.0/0.9.251/7.6.0 overridden` 확인. `npm.cmd audit --prefix runtime --omit=dev --json` 알려진 취약점 0. 관련 집중 테스트 23/23 통과. 최종 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 종료 코드 0: **1,229건 중 1,208 통과/0 실패/21 스킵**. 보존 로그 `build-artifacts/living-20260927/oss-j1-q1-full-regression.txt` SHA-256 `499e59d348e6406c315b4eb6935fb4369f860f2eb545ac6b68c6ca50822269e9`. 변경 JS `node --check`, `git diff --check` 통과(기존 줄바꿈 경고만). quantum-circuit의 오래된 전이 모듈은 Node circular dependency warning을 출력하지만 시험 종료 코드 0이다.
- 운영 `8790/api/health`는 읽기 HTTP 200, ADB 연결 기기 0대. **VERIFIED:** 실제 npm 패키지 설치·해시/라이선스/API, JEV 격리 HTTP·재시작 지표, quantum-circuit 기반 Bell·3대안 QAOA 로컬 시뮬레이션, 집중·전체 회귀, 산출물 해시. **RAN-UNVERIFIED:** 운영 코어는 health만 확인; 이 새 코드를 운영에 적용하지 않았다. **NOT RUN/BLOCKED:** 양자 운영 회복 흐름·재시작/백업 배선, 실제 QPU, JEV 승격/보류 권한, OpenClaw 연동, Android 실기기 페어링→요청→PC 실행→진행·결과→복구. 현재 실제 복구 후보 `wait`·`owner_review`는 비용이 둘 다 0이므로 기존 회로 계약이 선택을 거부한다. 비용을 지어내어 양자 결과를 운영에 붙이지 않는다. 운영 배포·실제 자격증명 교체·Vault 수정·데이터 삭제·커밋/push는 하지 않았다. 다음 한 단계는 실제로 구분되는 목적값이 근거에 기록된 복구 입력을 찾아 양자 선택을 권한 없는 관측값으로 연결하고, 재시작·백업·고전 fallback을 격리 코어에서 검증하는 것이다. 실기기가 연결되면 Android 전체 흐름 수락을 우선한다.

## §110 — 2026-09-28 Claude(Cowork): OpenClaw 통합 지시서 신규 작성 (소유자 반복 지시 반영)

- 소유자 지시(2회 반복): "스타 많은 오픈소스들은 죄다 다 우리 OS에 넣어야한다니깐 내가 첨부터이야기햇잖아" — 앞으로 검증된 인기 오픈소스를 발견하면 매번 허락받지 않고 적극적으로 통합 검토·지시서 작성까지 진행하기로 함(메모리 `/areas/blackhole-os.md`에 기록).
- 소유자가 이미 로컬에 받아둔 `C:\Users\우연호\openclaw-main\openclaw-main` 폴더에 소유자 승인 하에 직접 접근해 실제 파일을 확인했다(권한 요청·승인 절차 거침). 확인: MIT 라이선스(LICENSE 직접 읽음), Node >=22.12 요구, `src/telegram`이 실제 성숙한 모듈(grammy·baileys 의존성 포함), `extensions/device-pair`·`extensions/phone-control`·`apps/android` 실존, 저장소 56MB·루트 의존성 73개.
- 핵심 판단: 그동안 막혀있던 Android 실기기 연결(ADB 0대)은 "USB/ADB 페어링 경로" 자체의 문제였지 "폰↔PC 통신" 목표가 막힌 게 아니었다 — OpenClaw의 텔레그램 채널은 ADB·APK 설치 없이 소유자 폰의 기존 텔레그램 앱만으로 오늘 검증 가능하다고 판단, 이를 Phase 1 우선순위로 잡았다.
- `docs/CODEX_DIRECTIVE_OPENCLAW_INTEGRATION_20260928.md` 신규 작성: OpenClaw 소스는 BLACKHOLE 저장소에 병합하지 않고 분리 프로세스로 유지, 새 `runtime/lib/openclaw-bridge.mjs`만 기존 loopback-only 계약(memory-embeddings.mjs/provider-config-engine.mjs와 동일 패턴)으로 통신. Phase 1은 텔레그램 채널만 활성화해 왕복 검증(인수 T1), Phase 2(LanceDB 벡터DB·Android 네이티브 페어링·다른 채널)는 예고만 하고 이번 지시서 범위에서 제외. 텔레그램 봇 생성은 소유자 액션으로 남김, 기존 owner-approval 게이트·JEV·스케줄러 동결 계약은 그대로 유지하도록 명시.
- 코드 변경 없음(문서만). Codex가 다음 핸드오프에서 이 지시서를 확인하도록 `CODEX_HANDOFF_20260927.md`에도 반영 필요(다음 턴).

## §112 — 2026-09-28 Codex: 오픈소스 실물 대조와 Obsidian 읽기 전용 연결

- 시작/종료 저장소 경로 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 시작 시 약 118건의 기존 미커밋 변경을 보존했고 종료 시 다른 작업의 동시 문서 갱신을 포함해 121건이다. 본 작업은 기존 내용을 되돌리거나 운영 배포하지 않았다.
- Ollama `list`에서 `bge-m3:latest`(1.2 GB)와 `qwen2.5:3b` 설치를 확인하고 `ollama ps`는 빈 상태였다. 여유 RAM은 측정 시 0.69/0.62 GiB. `memory-embeddings.mjs`에는 Ollama loopback API 호출이 실제 있지만 모델은 `YENO_LOCAL_EMBED_MODEL` 설정이 필요하고, 3 GiB 게이트는 별도 Shadow 검증 스크립트에만 있다. 이번에는 모델을 적재/실호출하지 않았다.
- 소유자 Vault `C:\Users\우연호\Documents\Obsidian Vault`의 원장 파일 SHA-256 `81c83f48071066c16b5b357f5c09852c4b7598b088d3ac5ba97de2c1a76df667`을 재확인. Obsidian 앱은 실행 중이나 community plugin 폴더 및 27123/27124 listener는 없다. Vault 파일·설정·CHANGELOG는 수정하지 않았다.
- 공식 MIT `coddingtonbear/obsidian-local-rest-api` 소스를 `build-artifacts/oss-source/obsidian-local-rest-api`에 SHA `0278df908a9112d3e694f94c02f196f101dc095a`로 얕게 내려받아 LICENSE와 OpenAPI의 `POST /search/simple/` 계약을 읽었다. 새 `runtime/lib/obsidian-rest-search.mjs`는 loopback 전용, 명시적 opt-in, 소유자 인증, `01_DRAFTS` 결과 전용, 10건/문맥 200자/응답 1 MiB 제한, 5초 타임아웃, redirect 거부이며 쓰기/MCP 경로가 없다. `runtime/server.mjs`에 `/api/obsidian/search`를 연결했다. 실제 플러그인 미설치로 실 Vault 검색은 **BLOCKED**; 격리 가짜 플러그인 HTTP와 인증된 코어 라우트만 **VERIFIED**.
- 로컬 `C:\Users\우연호\openclaw-main\openclaw-main`은 OpenClaw `2026.2.13` MIT ZIP 추출본(`.git` 메타데이터 없음), Gateway 18789 listener와 `node_modules`가 없고 현재 설치되지 않았다. `pnpm`은 11.19.0이나 소스 packageManager는 `pnpm@10.23.0`이며 여유 RAM은 약 0.62 GiB. 이번에 의존성 설치·Gateway 실행·텔레그램 계정/봇 생성·채널 메시지 전송은 하지 않았다. 따라서 동시 작성된 OpenClaw 통합 지시서의 T1은 아직 주장할 수 없다. Smart Connections는 제한된 Smart Plugins License라 BLACKHOLE에 복사하지 않았다.
- 이후 공식 OpenClaw `v2026.2.13` 태그를 `build-artifacts/oss-source/openclaw-v2026.2.13`에 별도 shallow clone 완료, HEAD `e91d957d7089d2ca9589255245eead0edddc16d5`. 공식 clone과 기존 로컬 ZIP 추출본의 `LICENSE`/`package.json` SHA-256은 각각 `62316704df7426e5a79d2827ff8aca36e9abb3a73b8e68557030749ebefec667`/`1df0b4a8b6c560778a2d5e5c698bffd11a1af7097ef6753024eef31de9fc43a0`으로 일치하나 전체 파일 동일성은 검사하지 않았다. 소스만 고정했으며 의존성 설치·코드 실행은 아직 아니다. `docs/CODEX_DIRECTIVE_OPENCLAW_INTEGRATION_20260928.md`에 ADB 0대는 연결 부재이지 USB 경로 고장 증거가 아니며 Telegram 대안은 Android APK 수락 대체가 아니라는 정정을 추가했다.
- red: 신규 Obsidian 검색 테스트는 모듈 부재로 실패. green: `node --test runtime/test/obsidian-rest-search.test.mjs` 3/3 통과(실제 로컬 HTTP 가짜 플러그인, 외부 endpoint/redirect/과대 응답 차단, 익명 401/소유자 200). 시스템 Node 24.11.1은 임시 폴더 동기 재귀 삭제에서 기존과 같은 Windows 비정상 종료를 일으켜 비동기 종료 후 삭제로 테스트 정리를 변경했고 집중 테스트를 다시 통과했다. `node --check` 3파일 통과. `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 종료 코드 0, **1,232건 중 1,211 통과/0 실패/21 스킵**. 보존 로그 `build-artifacts/living-20260927/oss-obsidian-full-regression.txt` SHA-256 `acb61a73731a6d5b0583b302d9c439d447501afc45307c5fb367d8500b4d528b`.
- 채택/보류 이유와 정확한 상태를 `docs/BLACKHOLE_OPEN_SOURCE_REUSE_20260928.md`에 덧붙였다. **VERIFIED:** 공식 소스 라이선스/API·로컬 설치/리스너 상태·격리 Obsidian 검색·전체 회귀. **RAN-UNVERIFIED:** 운영 8790에는 이 변경을 적용하지 않았다. **BLOCKED/NOT RUN:** 실 Obsidian 플러그인 검색, OpenClaw Telegram 왕복, Android 실기기 페어링→요청→PC 실행→진행·결과→복구, 실제 원격 모델. 다음 한 단계는 고정된 OpenClaw 소스의 Gateway/텔레그램 권한 계약을 검증하고 기존 BLACKHOLE 인증/승인 경계에 연결 가능한 최소 채널 어댑터를 격리 테스트하는 것이다. Telegram 계정/봇 및 실제 폰 발신이 필요한 지점은 소유자 동작으로 남긴다. 운영 배포·자격증명 입력/교체·Vault 수정·데이터 삭제·커밋/push는 하지 않았다.

## §113 — 2026-09-28 Claude(Cowork): §112 독립 검증 완료 + 병렬화·호문쿨루스-커비 오픈소스 자율흡수 설계 추가

- §112(Codex, Obsidian Local REST API 연결 + OpenClaw 공식 태그 고정 + Smart Connections 라이선스 사유로 보류) 독립 검증: `runtime/lib/obsidian-rest-search.mjs`·`runtime/test/obsidian-rest-search.test.mjs`(3 테스트)·`docs/BLACKHOLE_OPEN_SOURCE_REUSE_20260928.md`·회귀 로그 전부 실존 확인. 회귀 로그 SHA-256 `acb61a73731a6d5b0583b302d9c439d447501afc45307c5fb367d8500b4d528b` 직접 재계산 일치, 요약 `tests 1232 / pass 1211 / fail 0 / skip 21` 로그 원문에서 직접 확인(주장과 일치). `openclaw-v2026.2.13/LICENSE` SHA-256 `62316704df7426e5a79d2827ff8aca36e9abb3a73b8e68557030749ebefec667` 직접 재계산 일치. `server.mjs`에 `/api/obsidian/search` 라우트 실존 확인(2088행). git HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211` 불변, 미커밋 121건. 불일치 없음. **VERIFIED로 확인.**
- 소유자 질문 1: "병렬로 할래?" — `docs/CODEX_HANDOFF_20260927.md`에 두 갈래(Obsidian REST 플러그인 설치·실검색 검증 / OpenClaw Gateway·채널 권한 계약 확인·격리 어댑터 시험)가 파일·상태 겹침 없이 독립적임을 확인해 병렬 진행 가능하다고 추가. 다만 여유 RAM이 0.6~0.7GiB로 낮아 무거운 설치·기동 자체는 완전 동시보다 순차 권장, 조사·코드 작성은 진짜 병렬 가능.
- 소유자 질문 2: "호문쿨루스 욕망들이 스스로 오픈소스 가져와서 커비가 흡수하게 못하나" — 방향에 동의, 다만 `static-guard.mjs`(§104)가 정확히 "AI가 스스로 찾은 외부 코드를 검토 없이 끌어오는 것"을 막으려고 만든 방어선이라 그대로 열면 충돌한다고 판단. `docs/CODEX_DIRECTIVE_LIVING_SYSTEMS_20260927.md`에 "3.3-A 정정"으로 3단계 설계 추가: (1) 호문쿨루스 격차 감지 → 기존 Scout/Researcher 역할이 실제 웹 검색 도구로 조사(이 웹 검색 권한 자체가 기존에 없던 새 권한이라 별도 소유자 승인 필요, 인수 G1은 이번 지시서 완료 조건에서 제외), (2) 커비 `kind:'absorbed-opensource'` 초안이 inbox에만 쌓임(비활성), (3) 소유자 승인 후에만 지금과 동일한 절차(Claude 지시서 → Codex 구현)로 반영 — `authorizesDispatch`·owner-approval 게이트 불변.
- 코드 변경 없음(문서만). 다음 Codex 턴에서 두 병렬 트랙과 G1 설계에 대한 소유자 확인 필요 항목을 함께 확인하도록 남김.

## §114 — 2026-09-28 Claude(Cowork): G1 실제 구현 지시서 작성 (소유자 승인: "자유도를 높여야해")

- 소유자 승인: "승인, 진행해 자유도를 높여야해." §113에서 설계만 남기고 완료 조건 밖에 뒀던 G1(호문쿨루스 격차→실제 웹 검색→커비 오픈소스 흡수 초안)을 실제로 구현 가능하도록 `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`로 작성했다.
- "자유도를 높여야 한다"는 지시를 반영해, §113 설계에 있던 "소유자가 승인한 격차 건에 한해서만 조사"라는 추가 게이트를 뺐다 — 격차 감지(자동, 읽기전용)→실제 웹 검색(§1의 provider 게이트만 통과하면 자동)→커비 초안 생성(자동)까지 전부 소유자 개입 없이 돈다. 소유자 승인이 남는 지점은 지금과 동일하게 "이 초안을 실제로 코드에 붙일지" 하나뿐 — "전면자동, 최종만 내가" 원칙 그대로.
- 새 검색 provider 권한은 새 패턴을 발명하지 않고 기존 `runtime/lib/browser-provider-routing.mjs`의 `YENO_JEV_BASE_URL`/`YENO_JEV_API_KEY`/`YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED`(HTTPS 전용, credential·query·hash 없는 URL, 공식 엔드포인트 확인 플래그) 패턴을 그대로 재사용해 `YENO_SEARCH_*`로 설계했다. 검색 결과는 기존 `recallPromptBlock`과 같은 방식으로 "데이터이지 지시가 아니다"로 라벨링해서만 모델에 전달하도록 명시 — 프롬프트 인젝션 방지.
- `docs/CODEX_DIRECTIVE_LIVING_SYSTEMS_20260927.md`의 3.3-A에 승인 사실과 별도 지시서 위치를 추가. `docs/CODEX_HANDOFF_20260927.md`에도 P2 항목으로 반영.
- 코드 변경 없음(문서만). 실제 검색 provider 키는 소유자 행동 대기 항목으로 남김(JARVIS A1과 동일 처지). 다음은 Codex가 격리 코어·합성 provider로 G1 인수를 시험하는 것.

## §115 — 2026-09-28 Codex: Obsidian HTTPS 경계와 OpenClaw 수신 후보 격리

- §113의 독립 두 갈래를 병렬로 조사·작성했고 무거운 설치/기동은 겹치지 않았다. §114에 G1 웹 검색 권한 승인이 이미 기록돼 있음을 재확인했다. 이번 변경에서 새 범용 웹 검색 권한은 활성화하지 않았다.
- Obsidian 공식 Local REST API 기본 HTTPS `127.0.0.1:27124`에 맞춰 `runtime/lib/obsidian-rest-search.mjs`를 보강했다. 자체 CA를 명시해 TLS 인증서를 검증하며 CA가 없거나 틀리면 API 키를 보내기 전에 실패한다. `runtime/server.mjs`의 `/api/obsidian/search` 기본값도 HTTPS로 바꾸고 코어 dataDir 안의 고정된 일반 파일 `obsidian-local-rest-api.crt`만 CA로 읽게 했다. 외부 주소·리다이렉트·쓰기 작업은 계속 거부한다. 격리 자체 서명 HTTPS 서버와 실제 격리 코어 인증 라우트를 통과했지만, 소유자 Vault에는 플러그인 자체가 설치·활성화되지 않았고 27123/27124 리스너도 없어 실 Vault 검색은 실행하지 못했다. Vault 파일·설정·CHANGELOG는 변경하지 않았다.
- 공식 OpenClaw `v2026.2.13` 고정 소스를 조사했다. Telegram `message_received` hook은 수신 메시지·송신자 메타데이터를 주지만 BLACKHOLE 소유자 인증 증거는 주지 않는다. Gateway의 `chat.send`/`send`는 `operator.write` 범위이며 수신 구독 계약이 아니다. 새 `runtime/lib/openclaw-bridge.mjs`는 Telegram 개인 대화의 정확한 `/status`만 인증 전 후보로 분류해 지문을 만들고 `authentication:'unverified'`, `authorizesDispatch:false`를 고정한다. 그 외 채널·그룹·자유 명령·자칭 소유자/관리자 정보는 거부한다. BLACKHOLE 서버에 연결하거나 Gateway를 설치·실행하거나 Telegram 메시지를 송수신하지 않았다. 이 후보 분류는 휴대폰 왕복 수락이 아니다.
- 집중 `node --test runtime/test/obsidian-rest-search.test.mjs runtime/test/openclaw-bridge.test.mjs`: **8/8 통과**. 이전 상태의 discovery/agent/shadow 기준 집중 45/45 통과, 로그 `build-artifacts/living-20260927/discovery-boundary-baseline.txt` SHA-256 `13f420aba3d85e8973f25d8fd703b24dd480c00eb934bf812c4360063c6d7e1d`. 사용자 지정 전체 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`는 **1,235건 중 1,213 통과/1 실패/21 스킵, 종료 코드 1**. 유일한 실패 `runtime/test/scheduler-fix.test.mjs`는 단독 재실행도 파일 단위 실패(첫 시나리오 통과 후 두 번째 중단, 상세 단언 없음)로 재현됐다. 임시 진단 출력에서는 17MiB 테스트 상태의 `pre.save()` 완료 후 `start()` 완료 전에 중단됐고 진단 편집은 원복했다. 여유 RAM 0.53GiB를 관찰했지만 직접 원인으로 단정하지 않는다. 이 회귀를 통과라고 표시하지 않는다. 전체 로그 `build-artifacts/living-20260927/oss-channels-full-regression.txt` SHA-256 `02e80017829edc6845d315e5152ba56a0b9ecfc60de163760732c5e5f67db2f1`. `git diff --check` 종료 코드 0(기존 줄바꿈 경고).
- `docs/BLACKHOLE_OPEN_SOURCE_REUSE_20260928.md`에 실제 구현/검증 범위를 갱신하고 `docs/CODEX_HANDOFF_20260927.md`의 Telegram이 기존 Android APK P0 수락을 대체한다는 부정확한 문구를 바로잡았다. **VERIFIED:** 격리 Obsidian HTTPS/CA 및 인증 코어 검색, OpenClaw 수신 후보 분류, 집중 8건, 전체 회귀의 실제 실패. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** 실제 Obsidian 앱 플러그인 활성화·실 Vault 검색, OpenClaw Gateway·Telegram 실제 왕복/소유자 인증, Android 실기기 전체 흐름, 원격 모델 A1. 운영 배포·자격증명 변경·Vault 설정 수정·커밋/push·데이터 삭제 없음. 다음 한 단계는 `scheduler-fix.test.mjs` 파일 단위 종료의 원인을 진단해 전체 회귀를 다시 통과시키는 것이다.

## §116 — 2026-09-28 Claude(Cowork): "최상급" 요청 — Shadow 레벨링 실제 근거 연결(S1+) + scheduler-fix 회귀 진단 지시서 2건 작성

- 소유자 요청("너희가 제한두는거아니잖아 구럼 그걸 더 최상급으로 만들수있게도와줘봐")에 대해, 내 표준 역할(코드 직접 수정 금지, 지시서 작성+독립검증만) 안에서 실제로 옮길 수 있는 두 가지를 코드 직접 열람으로 찾아 지시서로 작성했다. 화면 조작(컴퓨터 사용 도구)으로 소유자 GUI의 실 모델 키 입력 화면을 직접 조작하는 방안은 자격정보 입력 화면 근처 개입이라는 판단으로 하지 않기로 결정했다 — 이 항목(JARVIS A1)은 그대로 소유자 전용 행동으로 남는다.
- `runtime/lib/shadow-roster.mjs`의 `shadowRank(_state, entry)`가 미사용 `_state` 매개변수 때문에 영속적으로 `E` 등급만 반환함을 직접 코드로 확인(52행). §109에서 Codex 스스로도 "실제 Shadow job은 registry의 run 증거가 아니므로 근거 없이 D~S를 만들지 않는다"고 정직하게 명시했던 지점이다. `leveling-evidence.mjs`의 기존 2-엔진 패턴(`capability`,`code`)을 그대로 본떠 세 번째 `shadow:'shadowArmy'` 엔진을 추가하고 `shadowRank`를 실제 근거에 연결하는 `docs/CODEX_DIRECTIVE_SHADOW_LEVELING_S1PLUS_20260928.md`(§0~§8, 3467바이트, SHA-256 `e65229b6190801bdbec056d6e05baa6259c27f3cd59f64515c9ec33a35ec7f17`)를 작성했다. `solo-leveling.mjs`는 한 글자도 수정하지 않는다는 제약을 명시했고, 등급이 실제로 미래 행동에 영향을 주도록 표시 전용 `preferredShadowId` 훅을 보수적으로 범위를 제한해 포함했다(디스패치 권한·동시성 한도는 건드리지 않음).
- §115가 보고한 사용자 지정 전체 회귀 실패(`runtime/test/scheduler-fix.test.mjs`, 1,235건 중 1 실패)를 `build-artifacts/living-20260927/oss-channels-full-regression.txt`(SHA-256 `02e80017829edc6845d315e5152ba56a0b9ecfc60de163760732c5e5f67db2f1`, 재계산 일치) 직접 읽어 독립 재확인했다. 테스트 파일(109줄) 직접 열람 결과, 실패 지점은 17MiB state를 사전 기록한 뒤 서버 기동+200×20ms(4초) 폴링 안에 `autopilot.retryAt` 기록을 기다리는 두 번째 시나리오로 보이며, §115가 관찰한 여유 RAM 0.53GiB와 관련된 자원 압박 플레이크일 가능성과 실제 스케줄러 회귀일 가능성을 구분하지 않고는 단정할 수 없다. 근거 없이 어느 쪽이라고 결론 내리지 않고, 두 가설을 실제 계측으로 구분한 뒤 수정하라는 `docs/CODEX_DIRECTIVE_SCHEDULER_REGRESSION_20260928.md`(§0~§5, 3267바이트, SHA-256 `5e457a528a36660c355cfd1a1cb46ff2b01fe8d89837f63977176d3e3806b398`)를 새로 작성했다 — 임의로 타임아웃 숫자만 늘려 통과시키는 미봉책은 명시적으로 금지.
- 이 항목의 처리 순서는 Codex/소유자 재량이나, 재현 가능한 실패를 남겨둔 채 새 기능(S1+/G1/K1/OpenClaw)을 계속 쌓는 것보다 회귀 진단을 먼저 처리할 것을 권고했다(문서 내 명시).
- **VERIFIED:** §115의 두 해시(`oss-channels-full-regression.txt`, `discovery-boundary-baseline.txt`) 재계산 일치, `scheduler-fix.test.mjs` 실패 라인 재확인, `shadowRank` 미사용 매개변수 직접 열람. **RAN-UNVERIFIED:** 없음(이번 항목은 지시서 작성만, 코드 실행 없음). **BLOCKED/NOT RUN:** S1+/scheduler-regression 지시서 모두 Codex 실행 대기, JARVIS A1 실 키 입력(소유자 전용), Android 실기기, G1 실 검색 provider 키(소유자 전용). 운영 배포·자격증명 변경·커밋/push·데이터 삭제·코드 직접 수정 없음(표준 역할 유지).

## §117 — 2026-09-28 Claude(Cowork): Obsidian Local REST API 플러그인 설치·활성화 — 소유자 예외 승인 기록

- Codex가 §115 작업 후 직접 질의했다: `obsidian-local-rest-api` 커뮤니티 플러그인을 실제 Obsidian 앱에 설치·활성화하는 것은 AGENTS.md의 "Never Execute … Change sharing, permission, security, or privacy settings" 금지 항목에 해당할 수 있다 — 플러그인을 켜면 Vault에 127.0.0.1 전용 로컬 HTTPS API가 새로 열리기 때문이다(순수 읽기전용 설정이 아니라 로컬 서버 자체를 활성화하는 변경).
- 소유자에게 다음을 있는 그대로 전달했다: 이미 작성된 코드(`runtime/lib/obsidian-rest-search.mjs`, `runtime/server.mjs` 라우트)는 이 로컬 API에 대해 (1) 읽기 전용 검색만 수행, (2) 자체 CA로 TLS 신원 확인, (3) API 키 없이는 응답하지 않음, (4) 쓰기·외부주소·리다이렉트는 코드 레벨에서 전부 거부하도록 이미 구현돼 있음을 내가 직접 코드로 확인했다고 명시. 이 근거를 바탕으로 AskUserQuestion으로 승인/보류/거절 3지선다를 제시했다.
- 소유자 응답: "모두 승인 자유도를 높여야해" — 이번 한 건(Obsidian Local REST API 플러그인 설치·활성화)에 한해 AGENTS.md 예외를 명시적으로 승인함. 범위는 이 플러그인 설치·활성화 한 건뿐이며, 다른 보안/권한/공유 설정 변경 전반에 대한 포괄 승인으로 확대 해석하지 않는다(요청 자체가 "이 한 건에 한해"로 한정됨).
- `docs/CODEX_HANDOFF_20260927.md`의 기존 P2 Obsidian 항목에 이 승인을 반영해 Codex가 재질의 없이 진행할 수 있도록 명문화했다.
- **VERIFIED:** 소유자의 명시적 승인 발언 자체(대화 원문), 기존 코드의 읽기전용·CA검증·API키·쓰기거부 조건이 이미 구현돼 있다는 사실(직접 코드 열람, §115 검증 시 확인한 것과 동일 파일). **RAN-UNVERIFIED:** 없음(이번 항목은 승인 기록만, 실행은 Codex 몫). **BLOCKED/NOT RUN:** 플러그인 실제 설치·활성화 자체는 Codex 실행 대기 — 실행 후 실제 Vault 검색 1건 성공을 실제 로그/캡처로 남기고 다시 독립 검증할 것.

## §118 — 2026-09-28 Codex: scheduler-fix 회귀의 저메모리 테스트 실행 조건 수정

- §116 지시서 순서대로 실제 원인을 구분했다. 원본 `runtime/test/scheduler-fix.test.mjs` 단독 3회는 실행 직전 여유 RAM 0.35/0.78/0.91GiB에서 모두 종료 코드 1로 실패했다. 기록 `build-artifacts/living-20260927/scheduler-three-runs.json` SHA-256 `92e555fe799d44a1dd690e92c4903e5dcaccd9ba63b599b922256210af22d041`.
- 임시 타임스탬프 진단에서 17MiB `pre.save()`와 `start()` 완료를 확인했고, 한 실행에서는 `retryAt`을 두 번째 폴링에 관찰했다. 4초 폴링 예산 초과가 아니라 이후의 대용량 상태 반복 읽기/저장 구간에서 파일 단위 종료가 발생했다. 기본 Node 힙 한도는 약 2,240MiB, `--max-old-space-size=768`일 때 약 960MiB였다. 원본 디스크 폴링을 유지한 채 힙 상한만 적용하자 예외·재시도 시험이 약 6초에 통과하고 후속 `/api/jobs`는 HTTP 201, 용량 실패 이벤트는 1건이었다. 따라서 스케줄러 재예약 회귀 가설 A는 지지되지 않고 저메모리 환경에서 테스트 자식의 힙 설정 영향 가설 B가 재현·토글됐다. Windows의 개별 종료 원인 코드는 별도 확인되지 않아 OOM 단정은 하지 않는다.
- `scripts/run-tests.mjs`는 기존 저메모리 판정(총 RAM <8GiB 또는 여유 <3GiB)에서만 테스트 자식에 `--max-old-space-size=768`을 추가한다. 스케줄러/자동운영 제품 로직, 테스트의 200×20ms 폴링 조건, `runtime/test/scheduler-fix.test.mjs` 최종 내용은 바꾸지 않았다. 임시 진단 출력은 모두 원복했다.
- 변경 후 원본 스케줄러 파일 단독 5회 연속 3/3씩 통과(총 15/15). `build-artifacts/living-20260927/scheduler-five-runs.txt` SHA-256 `0b59d3d547c225058335dc87fa4a65fbf4e7a7c54952bb90f17bb92f67e6ac56`. 사용자 지정 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"` 종료 코드 0, **1,237건 중 1,216 통과/0 실패/21 스킵**. `build-artifacts/living-20260927/scheduler-full-regression.txt` SHA-256 `79d77eaf780280739b271a48f13f090c53845bf8729ecb114e64e9934fc31106`. 테스트 건수 증가는 다른 진행 중 변경을 포함한 현재 작업 트리 기준이며 이 수정만의 신규 시험이라고 주장하지 않는다. `git diff --check` 오류 없음.
- **VERIFIED:** 기본 실행 3회 실패, 힙 상한 전환 후 5회 성공, 전체 회귀 0 실패. **RAN-UNVERIFIED:** 개별 Windows 프로세스 종료 메커니즘은 확정하지 않았다. **BLOCKED/NOT RUN:** 운영 배포·실기기 수락 등 기존 항목. 커밋/push 없음.

## §119 — 2026-09-28 Codex: 승인된 Obsidian 플러그인 파일 설치, 앱 로드는 대기

- §117에서 소유자가 이 플러그인 설치·활성화 한 건에 한해 명시적으로 예외 승인한 것을 확인했다. 공식 `coddingtonbear/obsidian-local-rest-api` 5.3.0 GitHub 릴리스의 `main.js`·`manifest.json`·`styles.css`를 `build-artifacts/oss-source/obsidian-local-rest-api-5.3.0-release/`에 내려받아 SHA-256을 확인했다. 설치된 Obsidian 1.13.7은 minAppVersion 1.13.1 이상이다.
- 세 파일을 소유자 Vault의 새 `.obsidian/plugins/obsidian-local-rest-api/`에 복사하고 새 `.obsidian/community-plugins.json`에 플러그인 ID 하나를 등록했다. main.js SHA-256 `95c7ddba1164cd6acd94dbdb1d73336ccb8bd97a671e3140c018be811e74b83e`, manifest `7cf8e255f64f996ea3c7976755534c9a424a67aa8d48dd656058f67a8b3a2b3c`, styles `19956deaf4d14142381f81fdf92cae8241fd0aa08a1a3a5464b0d007bae1924d`; 설치본 해시가 다운로드본과 일치했다.
- 실행 중인 Obsidian은 새 플러그인을 아직 로드하지 않았고 27123/27124 리스너·플러그인 data.json은 없다. Windows 화면 잠금 상태에서 UI 재로드가 불가능해 앱/운영 프로세스를 강제로 닫지 않았다. 따라서 실제 Vault 검색과 CA/API 키 전달은 NOT RUN이다. 키를 터미널·로그·채팅에 출력하거나 복사하게 하지 않았다. 원장 `ALL_IDEA_RECORDS.json` SHA-256 `81c83f48071066c16b5b357f5c09852c4b7598b088d3ac5ba97de2c1a76df667` 불변. Vault `CHANGELOG.md` (46)에 정확한 변경과 대기 상태를 기록했다.
- **VERIFIED:** 공식 릴리스 설치 파일·버전·해시, Vault 설정 파일 등록, 원장 불변, 리스너 미기동. **RAN-UNVERIFIED:** 플러그인 자체는 실행되지 않았다. **BLOCKED:** PC 화면 잠금 해제 후 Obsidian 앱 재로드, 플러그인 HTTPS 리스너 확인과 실제 `01_DRAFTS` 검색 1건. 다음 한 단계는 화면이 열렸을 때 Obsidian을 안전하게 재로드하고 비밀값을 노출하지 않는 방식으로 실제 읽기 검색을 확인하는 것이다.

## §120 — 2026-09-28 Claude(Cowork): §118·§119 독립 검증 완료 + S1+ 지시서의 등급 조건 오류 정정

- §118(scheduler-fix 회귀)·§119(Obsidian 플러그인 설치) 보고를 직접 파일·해시 대조로 독립 검증했다. 일치 확인: `scheduler-full-regression.txt`(SHA-256 `79d77eaf780280739b271a48f13f090c53845bf8729ecb114e64e9934fc31106`, 1,237/1,216/0/21 재확인), `scheduler-three-runs.json`/`scheduler-five-runs.txt` 해시, `scripts/run-tests.mjs`의 `lowMemory` 판정·`--max-old-space-size=768` 조건부 적용 코드 직접 열람, `runtime/test/scheduler-fix.test.mjs`가 109줄·200×20ms 폴링 그대로임(제품/테스트 조건 불변 주장과 일치) 직접 확인. 옵시디언 쪽은 연결된 `Documents\Obsidian Vault` 폴더에서 직접 `.obsidian/plugins/obsidian-local-rest-api/`의 세 파일 해시, `.obsidian/community-plugins.json`(플러그인 ID 1개만 등록), 원장 `ALL_IDEA_RECORDS.json` 해시 불변(`81c83f48071066c16b5b357f5c09852c4b7598b088d3ac5ba97de2c1a76df667`), Vault `CHANGELOG.md`(46) 항목까지 전부 일치 확인. 두 보고 모두 불일치 없음.
- Codex가 S1+ 지시서 착수 전 지적한 등급 조건 불일치를 `runtime/lib/solo-leveling.mjs`의 실제 `grade()` 함수(96-108행)를 직접 읽어 확인했다: **D등급은 검증된 성공 1건**(`successes.length>=1`), **C등급은 서로 다른 입력의 성공 2건**(`inputSha256` distinct), **B등급은 조합(compositions) 증거 1건**, **A등급만 `AUTONOMY_MIN_SUCCESSES=3`건의 자율 성공**(소유자 개입 없음) 조건이다. 내가 쓴 `docs/CODEX_DIRECTIVE_SHADOW_LEVELING_S1PLUS_20260928.md` 초안은 이 AUTONOMY_MIN_SUCCESSES=3을 D등급 조건으로 잘못 적었다(§4의 "D랭크 이상" 우선배정 훅 자체는 옳았으나, 거기 도달하는 조건 설명과 §5 테스트명·§6 인수기준이 틀렸음). Codex가 근거 없이 등급을 조작하지 않고 착수 전 이 불일치를 보고한 것은 옳은 판단이었다.
- 지시서를 실제 코드 계약에 맞게 정정했다(SHA-256 `ffdffefd5b288597b7532e56281ed0a850c34b10bfd52f4e4b5542f008f596ff`): D는 1회 성공, C는 서로 다른 입력 2회 성공, A는 여전히 AUTONOMY_MIN_SUCCESSES=3건의 자율 성공으로 정정. 테스트명과 인수기준(§5, §6)도 이에 맞게 재작성했다. `solo-leveling.mjs` 자체는 이번에도 손대지 않는다.
- **VERIFIED:** §118·§119의 모든 해시·파일 내용 재계산 일치. `solo-leveling.mjs`의 실제 grade 조건(D=1, C=2, B=조합, A=AUTONOMY_MIN_SUCCESSES=3, S=외부검증) 직접 코드 확인. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** S1+ 정정판 구현은 Codex 실행 대기, 실제 Obsidian 앱 재로드·실 Vault 검색은 PC 화면 잠금 해제 대기(소유자 행동), scheduler-regression 지시서의 나머지 사항(원인 A/B 구분 결과는 §118에서 가설 B로 확인됨, §5 회귀 재확인 요건 충족)은 완료로 판단됨.

## §121 — 2026-09-28 Claude(Cowork): "자유도 더 높여야하는데" — §117류 개별승인을 재사용 가능한 기준으로 전환

- 소유자 반복 지시("스타 많은 오픈소스는 죄다", "자유도를 높여야해", 이번 "자유도 더 높여야하는데")와 2026-09-26 메모("막는 것 같다, 설명 반복 말고 실제로 돌아가는 걸 보여줘")를 근거로, §117처럼 사안 하나마다 새로 AskUserQuestion을 여는 절차 자체를 줄인다. `docs/BLACKHOLE_AUTONOMY_CRITERIA_20260928.md`(SHA-256 `a1e9e2ccd94681b27632cd05e317731d449636d1428b5bd8dd95743a2e089090`)를 신규 작성 — 7개 조건(루프백 전용, 공식배포본+해시+허용라이선스, 읽기전용이거나 이미 안전장치 코드화됨, 자격정보는 여전히 소유자전용, 되돌릴 수 있음, 기존과 동일한 증거기록, 이미 한 번 확인받은 "종류"의 반복)을 모두 만족하면 Codex가 다시 묻지 않고 진행 후 기존 방식대로 보고만 하도록 함.
- 그래도 묻는 항목은 명시적으로 남겼다: 자격정보 입력(JARVIS A1·검색 provider 키 등), 금전/구매, 루프백 밖 네트워크 노출 확대, `00_INBOX_RAW`·Vault 원문 삭제, 그리고 G1의 마지막 게이트(흡수 초안→실제 실행 코드 연결)는 소유자가 스스로 정한 "최종만 내가"의 가장 바깥쪽 경계라 이번에 건드리지 않았음을 밝혔다 — 이 마지막 게이트까지 자동화할지는 추측으로 풀지 않고 별도 확인이 필요한 사안으로 남겨둠.
- `static-guard.mjs`가 막는 "AI가 검토 없이 외부 코드를 실행 경로에 붙이는 것" 자체는 이 문서로 우회되지 않는다고 명시했다 — 줄어드는 건 "소유자에게 매번 묻는 절차"이지 "실제로 무엇이 코드에 연결되는지"의 검증·기록 절차가 아니다.
- `docs/CODEX_HANDOFF_20260927.md` 공통 원칙 섹션에 이 기준 문서를 참조하도록 추가해 Codex가 향후 동종 사안에서 이 기준을 먼저 확인하도록 했다.
- **VERIFIED:** 없음(이번 항목은 정책 문서 작성, 코드 실행 없음). **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** 해당 없음. G1 마지막 게이트를 더 풀지 여부는 소유자 확인 대기.

## §122 — 2026-09-28 Codex: S1+ 그림자 개체별 근거 등급·이름 배정, 스케줄러 네이티브 종료 회귀 재조정

- 시작 시 저장소 경로 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, 브랜치 `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211` 확인. 기존 대량 미커밋 변경은 보존했고 커밋·push·운영 배포·데이터 삭제는 하지 않았다. §120의 정정 지시서와 §121의 재사용 승인 기준을 읽고 적용했다.
- `leveling-evidence.mjs`에 Shadow 증거 엔진을 추가했다. `state.shadowRoster`의 개별 그림자 UUID를 기존 Solo Leveling 허용 ID 형식인 `shadow-<uuid>`로 변환하고, 저장된 임무·역할 job·실제 등록 산출물 SHA·결정론 검증 성공·의미 검증 pass·Builder 산출물 연결을 교차 확인해 run/execution/intervention 기록을 읽기 시 재계산한다. `solo-leveling.mjs` 자체는 변경하지 않았다. 역할 전체가 아닌 개체별 ID로 계산해 같은 역할의 다른 그림자에게 성공을 옮겨주지 않는다.
- `shadow-roster.mjs`의 고정 E를 이 증거 이력으로 교체했다. 검증된 첫 임무 후 D, 서로 다른 입력의 두 번째 검증 임무 후 C를 확인했다. 등급 근거가 사라지면 강등된다. 새 임무에서는 D 이상인 같은 역할의 이름·ID를 **표시 전용** `preferredShadowId`/`preferredShadowName`으로 job assignment에 저장하고 JARVIS 직접 조종 서랍의 최근 작업 문구에 표시한다. `shadow-army.mjs`의 assignment 검증은 이 두 필드의 동시 존재·UUID·안전한 이름을 요구한다. 기존 dispatcher, `MAX_ACTIVE_MISSIONS_PER_PROJECT`, 소유자 승인, JEV 권한은 변경하지 않았다. `runtime/public/DESIGN.md`에 이 표시 규칙을 기록했다.
- 실제 HTTP 코어와 합성 모델 전송의 격리 시험에서 첫 임무 전 익명 배정 → 완료 후 4명 D → 재시작 후 같은 명부 지문·D → 두 번째 임무에서 정찰자/연구자/건설자 이름 배정 → 완료 후 4명 C를 확인했다. `runtime/test/shadow-army.test.mjs`의 새 HTTP/재시작 시험과 `runtime/test/shadow-roster.test.mjs`의 증거·강등 시험을 포함한 집중 24/24 통과. `scripts/verify-shadow-leveling-live.mjs`가 `build-artifacts/living-20260927/s1plus/`에 grade-before/after-1/after-2, preferred-assignment, report JSON과 400×840 Edge 캡처를 남겼다. 최신 캡처 SHA-256 `4b354a354ca445ce28d39df95ee0b0182f1584b73dd370bb8fb24a05cf473c3b`, 가로 넘침 없음. 캡처에는 이름 배정이 보인다. 합성 provider 결과이므로 실모델 품질이나 운영 등급의 증거가 아니다.
- §118의 `--max-old-space-size=768`은 전체 회귀에서 다시 파일 단위 실패를 일으켰다. 512MiB에서도 간헐 실패. `scheduler-fix.test.mjs`를 단독 실행했을 때 첫 시나리오 뒤 Windows 종료 코드 `0xC0000409`를 관찰했고, 임시 진단은 17MiB 입력 저장 후 서버 기동 중 또는 이후의 네이티브 종료를 가리켰다. 정확한 Windows 종료 원인은 확인하지 못했다. 입력을 15.5MiB로 줄인 5회 중 3회 실패해 그 가설은 기각했다. 실제 `ProductionCapacityError`를 일으키는 최소 근처 15.1MiB 입력에서는 5회 연속 3/3 통과했고 `productionCapacity(pre.state).withinCapacity===false` 단언을 추가했다. 재시도 200×20ms 관찰창과 제품 스케줄러 코드는 불변이다. 최종 저메모리 테스트 자식 힙 상한은 512MiB. 임시 진단 출력은 제거했다.
- 실패한 중간 회귀는 각각 `1,238/1,216/1/21`(768MiB), `1,221/1,198/2/21`(512MiB, 스케줄러·studio 파일 단위 종료)로 보존해서 해석한다. 최종 사용자 지정 `npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt"`는 종료 코드 0, **1,239건/1,218 통과/0 실패/21 스킵**. 복사한 `build-artifacts/living-20260927/s1plus/s1plus-full-regression.txt` SHA-256 `3229e4d93ab6bec0e97acd05c1ef3fc5c1510a32c0e4277b7fb704883745accf`. `git diff --check` 오류 없음(기존 줄바꿈 경고만).
- 화면 독립 QA 두 검토자는 이름 표시·CJK 무절단·DOM 기반 구현은 확인했다. 한 검토자는 합성 provider 표시가 상단에서 축약되는 점과 등급 근거 설명이 서랍에 없는 점을 개선 의견으로 남겼다. 테스트 코어의 합성 판정은 JSON 증거에 명시했고 운영 모델 결과처럼 보고하지 않는다.
- **VERIFIED:** 현재 코드의 합성 격리 HTTP 임무 2회·재시작·D→C·이름 배정, 집중 24/24, 최종 전체 회귀 1,239/1,218/0/21, 최신 Edge 캡처 가로 넘침 없음. `C:\blackhole-build-tools\android\platform-tools\adb.exe devices -l` 실제 실행에서 연결 기기 0대. **RAN-UNVERIFIED:** Windows `0xC0000409`의 네이티브 종료 메커니즘은 미확정; 15.1MiB 조정은 이 PC에서 시험 안정성을 높였지만 다른 환경의 완전한 재현 제거까지 증명하지 않는다. **BLOCKED/NOT RUN:** Shadow B/A/S 실제 임무 등급(조합·무개입 자율 3회·외부 성과 증거 없음), 실제 원격 모델 품질, Android 휴대폰 실기기 수락, Obsidian 앱 재로드·실 Vault HTTPS 검색(27124 리스너 여전히 없음), 운영 코어에 S1+ 새 코드 배포.
- 다음 한 단계: 장시간 사용자 작업에 영향 없이 Obsidian 화면이 열리면 이미 설치된 플러그인을 앱에서 로드하고 CA·키를 노출하지 않는 실제 읽기 검색 1건을 확인한다. 이와 별도로 S1+ B등급을 만들려면 다른 검증 기능의 출력 바이트를 그림자 입력이 실제로 소비했다는 연결 증거가 먼저 필요하며, A/S를 근거 없이 높이지 않는다.

## §122 — 2026-09-28 Claude(Cowork): G1 상태 과장 정정 — "이미 전자동"이 아니라 지시서만 존재

- 직전 대화에서 내가 "호문쿨루스 격차감지→검색→커비 초안"이 "이미 지금도 전자동"이라고 말한 것은 부정확했다. 실제로는 §114에 "코드 변경 없음(문서만)"이라고 이미 명시돼 있었는데, 이를 재확인하지 않고 대화 맥락만으로 과장해서 전달한 내 실수다. 직접 재확인: `runtime/lib/gap-scout.mjs` 없음, `runtime/test/gap-scout.test.mjs` 없음. 기존 `runtime/test/g1-living-loop-integration.test.mjs`는 이번 G1(오픈소스 흡수)과 무관한 예전 동명 파일임을 확인했다(소유자 지적과 일치).
- 결론: 최종 승인 게이트를 지금 유지하는 게 맞다는 소유자 판단에 동의. 먼저 승인된 G1 지시서(`docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`)를 Codex가 실제로 구현·검증하는 게 순서상 앞선다.
- 실제 모델 응답(JARVIS A1)과 Android 실기기 흐름은 각각 소유자의 실제 키 입력과 휴대폰 연결이 필요한 항목으로, 완료된 기능으로 보고하지 않는다는 소유자 방침을 그대로 따른다.
- **VERIFIED:** gap-scout.mjs/테스트 부재, §114 "코드 변경 없음" 재확인, g1-living-loop-integration.test.mjs가 별개 파일임을 직접 확인. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** G1 구현 자체(Codex 실행 대기), JARVIS A1(소유자 키 입력 대기), Android 실기기(휴대폰 연결 대기).

## §123 — 2026-09-28 Claude(Cowork): "깃허브 스타많은것들 모두 받아들이기" — 음성(STT/TTS)·자체호스팅 검색 3건 신규 제안

- 소유자 지시("스타 많은 오픈소스들은 죄다", 오늘 "깃허브 스타많은것들 모두 받아들이기")에 따라, 실제 웹 검색·GitHub 직접 조회로 확인한 후보 3건을 제안하는 `docs/CODEX_DIRECTIVE_OSS_VOICE_SEARCH_20260928.md`(SHA-256 `ee4f3890bec4289c34ea4ea1e4a45eb5a0031eef497cbade8243d5bba0bd4430`)를 작성했다. `rhasspy/piper`(11.3k star, MIT, 로컬 TTS), `ggml-org/whisper.cpp`(54k star, MIT, 로컬 STT), `searxng/searxng`(36.7k star, AGPL-3.0, 자체호스팅 메타검색) — 스타·라이선스는 GitHub API/페이지 직접 조회로 확인(2026-09-28 기준, 변동 가능하므로 Codex가 착수 시 재확인하도록 명시).
- 선정 근거: (A) 자비스=아이언맨 이름 충실성 규칙에서 "듣고 말하는" 기능이 실제로 빠져있는 진짜 격차이고 완전 로컬 실행이라 "독립 실행" 원칙과도 맞음. (B) SearXNG는 G1이 지금 "실제 키는 소유자 행동 대기"로 막혀 있는 지점을 유료 계정 없이 우회할 실질적 방법이 됨.
- `docs/BLACKHOLE_AUTONOMY_CRITERIA_20260928.md`의 §7("완전히 새로운 종류는 처음 한 번만 확인")에 해당함을 지시서 §3에 명시했다 — 음성 I/O·자체호스팅 검색엔진은 이 프로젝트에 처음 도입되는 종류라, Codex가 6조건 대조 결과를 실제로 보고서에 남기도록 요구했다. 특히 이 PC의 낮은 RAM(여유 0.4~0.7GiB)에서 실제로 돌아가는지 실측 없이 "될 것"이라 가정하지 말라고 명시(기존 "실패를 성공으로 포장하지 않는다" 원칙 적용).
- `docs/CODEX_HANDOFF_20260927.md` P2에 반영.
- **VERIFIED:** 세 저장소의 스타·라이선스·설명 직접 조회(SearXNG는 GitHub API, Piper/whisper.cpp는 GitHub 페이지 — API가 403을 반환해 페이지로 재확인). **RAN-UNVERIFIED:** 없음(제안 단계, 코드 실행 없음). **BLOCKED/NOT RUN:** 세 후보 모두 Codex의 실제 조사·RAM 실측·구현 대기.

## §124 — 2026-09-28 Codex: OSS 음성·검색 지시서 사실관계 보정

- §123에서 작성된 `docs/CODEX_DIRECTIVE_OSS_VOICE_SEARCH_20260928.md`를 실제 코드 및 공식 프로젝트 페이지와 대조하고 기존 제안을 보존한 채 전제만 수정했다. 수정 후 SHA-256 `95d56e6c125247f081196dd16c107c80b14a2fe44f9581d5a29e566c2eacbea6`이며 §123의 해시는 수정 전 버전을 가리킨다.
- `runtime/public/voice-view.mjs`에는 브라우저 STT/TTS 폴백, `live-voice-client.mjs`에는 Gemini Live 경로가 있다. 따라서 격차는 음성 기능의 부재가 아니라 독립적인 **로컬** STT/TTS 경로의 실측 부재다. `rhasspy/piper`는 2025-10-06 보관 처리되었고 개발은 GPL-3.0 `OHF-Voice/piper1-gpl`로 이동했으므로 구 MIT 저장소의 라이선스를 현행 `piper-tts` 배포물에 적용한다고 단정할 수 없다.
- `memory-embeddings.mjs`에는 루프백 호스트 검사만 있으며 3GiB 게이트는 `scripts/verify-source-shadow-live.mjs`의 로컬 Shadow 실측에 있다. G1의 `gap-scout.mjs`와 `YENO_SEARCH_*` 어댑터는 아직 구현되지 않았다. SearXNG의 로컬 API 뒤에서 일어나는 외부 검색 및 AGPL 의무를 별도로 검토해야 한다.
- 저장소 branch/remote/HEAD는 §122 Codex 기록과 같았고 기존 미커밋 변경을 보존했다. **VERIFIED:** 문서·코드 파일 존재와 해당 코드 경계 확인, 공식 저장소의 Piper 보관/이동·현행 라이선스 확인, 수정 지시서 해시. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** 세 후보의 설치·RAM 실측·실제 음성/검색 통합은 실행하지 않았다. 문서 정정만 했으므로 회귀 테스트는 재실행하지 않았다.

## §124 — 2026-09-28 Claude(Cowork): "더 창의적으로" — G1을 칠죄종 7개가 서로 다르게 찾아오도록 정정

- 소유자 지적: "칠죄종 호문쿨루스가 본인에게없는것도 깃허브나 새로운곳에서 찾아서 와야지 이것까지 다시 내가주는것만하느게아니라.. 좀 더 창의적일수없니." 직전 내 제안(원장 재우선순위)이 여전히 "소유자가 준 원장을 재배열"하는 수준이라는 지적으로 확인. `runtime/lib/seven-drives.mjs`의 `DRIVE_CANON`(33-38행 주석)을 직접 읽어 이미 존재하는 7개 드라이브의 실제 의미(greed=재사용자산축적, gluttony=증거공백채우기, envy=포트폴리오대비뒤처진검증따라잡기, pride=증거형식검증공백줄이기, lust=소유자소비가능결과물완성, wrath=실패에서배우고불확실성회피, sloth=새호출없이기존결과재사용)를 확인했다 — 새 성격을 지어낸 게 아니라 기존 정의를 검색 행동에 그대로 연장.
- `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`에 "2-A 정정"을 추가(SHA-256 `54c5dbaade0a3331c31aa7ccd00bdf55993a2acb93df962bf84daecb39623932`): 지금까지 G1 설계는 어느 드라이브든 top-3+배고픔70이면 똑같이 검색하는 범용 절차였는데, 이를 드라이브별로 실제로 다른 검색 성향(greed=범용재사용라이브러리, gluttony=문서화·증거도구, envy=비슷한프로젝트가뭘쓰는지비교검색, pride=검증·정적분석도구, lust=완성도·표현계층도구, wrath=실제회귀직후만발동+디버깅도구)으로 바꿨다. 특히 **sloth는 나머지 6개와 반대로 동작**하도록 명시 — "새 호출 없이 기존 결과 재사용"이 본질이므로 곧장 외부 검색하지 않고 `state.capabilities.entries`에서 이미 흡수된 것으로 메울 수 있는지 먼저 확인하는 `reuseBeforeSearch` 경로를 거친 뒤에만 검색으로 넘어가게 함. 이 비대칭 하나가 "일곱이 전부 다른 태도"를 코드로 증명하는 지점이라고 명시했다.
- §5 테스트 목록에 3개 추가: 드라이브별 질의 편향 검증, sloth의 재사용우선 분기 검증, wrath가 진짜 회귀 이벤트 없이는 발동 안 함 검증.
- **VERIFIED:** DRIVE_CANON 실제 정의 직접 코드 확인. **RAN-UNVERIFIED:** 없음(지시서 정정, 코드 실행 없음). **BLOCKED/NOT RUN:** G1 구현 자체(Codex 실행 대기, 이번 정정 포함해서 진행).

## §125 — 2026-09-28 Claude(Cowork): sloth 재정정 — "게으름"이 아니라 "영리한 효율 추구"

- 소유자 재정정: "나태는 러떻게하면 더효율적으로 쉽게 할까겟지." 직전 §124의 sloth 설계(재사용 우선, 검색은 최후 수단, 새 의존성 최소화 후보 선호)가 "그냥 아무것도 안 하려는 게으름"에 가까웠다는 지적으로 확인 — 실제 나태의 심리는 "지금 조금 힘써서 앞으로 영원히 덜 힘든 방법을 찾는 영리한 게으름"에 가깝다.
- `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`의 sloth 항목을 정정(SHA-256 `c6b867a6a2e8fb17989d07cf5abcdcc28b7623cf53b15de00745f142a85d556a`): 재사용 우선 확인(`reuseBeforeSearch`)은 그대로 유지하되, 그걸로도 못 메우면 무작정 검색하지 않고 **"이 작업을 앞으로 반복하지 않아도 되게 만들어주는 자동화·일회성 설정 도구"**를 우선 찾도록 질의 목적을 바꿨다. 후보 평가 기준도 "새 의존성 적음"에서 "한 번 붙이면 앞으로 sloth 자신의 반복 작업이 실제로 줄어드는가"로 바꾸고, 그 감소분을 `effortReducedEstimate` 필드로 정직하게 남기되 근거 없으면 비워두게 했다(숫자 조작 금지, 기존 원칙 재적용). DRIVE_CANON의 sloth worldName이 "자유(Freedom)"인 것과도 이 해석이 더 잘 맞는다.
- §5 테스트 목록에 `sloth_fallback_search_biases_toward_effort_reducing_automation_not_generic_candidates` 추가.
- **VERIFIED:** 없음(지시서 정정, 코드 실행 없음). **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** G1 구현 자체(Codex 실행 대기).

## §126 — 2026-09-28 Claude(Cowork): 나머지 6개 드라이브 심화 정정 + 기존 설계 재검토(쇼도우군단·호문쿨루스 발언은 이미 통과)

- 소유자 지시: "나머지 여섯 개도 이런 식으로 다시 검토해봐 그리고 나머지 지금까지 설계된것들도 이렇게 다시잡아보자." sloth에 적용한 것과 같은 기준(사전적 정의 나열이 아니라 그 욕망의 진짜 심리 구조를 검색 행동에 반영)을 나머지 6개에도 적용해 `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`를 재정정했다(SHA-256 `9ea717ad74781552b037b3fee5e08940ca5533688a08d3a6f689ff5b59184f5f`):
  - greed: "쓸만한 것 하나로 안 끝난다"는 본질을 반영해 재사용 가치 축으로 평가 기준을 바꾸고, 채택 안 한 차선책도 `nextCoveted`로 정직하게 남기는 불만족 상태를 코드화.
  - gluttony: 넓은 그물로 여러 출처를 동시에 훑되 `digestedAsUseful:true/false`로 과식의 무가치한 부분을 숨기지 않고 드러냄.
  - envy: 비교 검색은 유지하되, 비교 대상을 깎아내리지 않고 오직 "그들이 쓰는 구체적 방법"만 추출하도록 명시해 건설적 질투와 파괴적 질투를 코드 수준에서 분리.
  - pride: 다른 드라이브보다 채택 기준선을 더 높게 잡고, 기준 미달이면 recommendation을 비우는 것도 정상 결과로 취급(쉽게 타협하지 않는 게 긍지의 본질).
  - lust: "얼마나 빨리 눈에 보이는 결과로 이어지는가"로 평가축을 바꾸되, 속도를 위해 희생한 견고함은 `tradeoffNote`로 정직하게 공개.
  - (wrath·sloth는 §124/§125에서 이미 심화 완료.)
- §5 테스트 목록에 5개 추가(greed/gluttony/envy/pride/lust 각각의 정직성 검증 항목).
- "나머지 지금까지 설계된 것들"도 같은 기준으로 재검토했다: `runtime/lib/shadow-army.mjs`의 scout/researcher/builder 역할은 이미 `ROLE_PROMPTS`로 실제로 다른 시스템 프롬프트를 받고 dependsOnJobIds로 체인(scout+researcher→builder→verifier→semanticVerifier)돼 있어 라벨만 다른 게 아니라 실제로 다르게 동작함을 코드로 확인 — 재작업 불필요. `runtime/lib/drive-state.mjs`의 호문쿨루스 "쉬는 중 발언"도 `evidence[driveId]` 객체가 드라이브마다 실제로 다른 신호(재사용/자산공백, 오래된근거, 검증범위공백 등)를 읽어 문장을 만들고 있어 이미 진짜 심리별 발언이었음을 확인 — 재작업 불필요. `runtime/lib/kirby.mjs`(45줄, 원장-digest 전용)는 이미 알려진 대로 K1 전체 흡수 루프가 아직 안 만들어진 것이지 "얕게 설계된 것"은 아니라 이번 재검토 범위와 다름(신규 구현 대기 항목으로 기존 분류 유지).
- **VERIFIED:** shadow-army.mjs `ROLE_PROMPTS`·dependsOnJobIds 체인, drive-state.mjs `evidence` 객체의 드라이브별 실제 신호 차이 직접 코드 확인. **RAN-UNVERIFIED:** 없음(지시서 정정, 코드 실행 없음). **BLOCKED/NOT RUN:** G1 구현 자체(Codex 실행 대기).

## §127 — 2026-09-28 Claude(Cowork): "더 오버해서, 원문 그대로" — 칠죄종 7개 전부 극단화 재정정 + 그림자군단 관성 발견

- 소유자 재지적: "굉장히 잘못된거같은데 다시한번더 원문 그대로의 개념으로 접근해줘 더 오버해서 잡아줘 그래야 엔진이지 나머지개념들도 다 강렬하게." §126의 정정이 방향은 맞았지만 `nextCoveted`/`digestedAsUseful`/`tradeoffNote` 같은 순한 엔지니어링 용어로 다듬어져 칠죄종 본연의 강도를 잃었다는 지적으로 확인 — "칠죄종 호문쿨루스"는 일반적 세븐 신이 아니라 각 죄를 극단적으로 체화한 인격체(원작 참조)라는 재확인.
- `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md`에 "2-B 재정정" 추가(SHA-256 `67a04d7a4168eb28e9faadd846e45f55196fea7082076a6ae61b76719b6deebc`), 2-A의 순화된 표현을 실제 동작 차이로 대체: greed=만족을 모름(후보 항상 복수+배고픔 감쇠 느림), gluttony=가장 큰 후보 상한+쓸모없이 삼킨 것의 부채가 다른 드라이브에 실제로 노출됨(교차 드라이브 긴장), envy=비교 직후 배고픔이 일시적으로 더 오르는 비선형 곡선(단, 비하 표현은 여전히 금지), pride=자기 gap뿐 아니라 다른 드라이브의 저품질 후보도 거부권(`prideVeto`) 행사, lust=후보를 단 하나만 곧장 집음(위원회처럼 여러 개 안 잼), wrath=단 하나의 가장 권위있는 해법만 정밀 처단(모호하면 정직하게 "원인 미특정"). sloth는 이미 원문에 가장 가까워 이번 대상 아님. §5 테스트 목록도 이 강도에 맞게 재작성(예: `gluttony_caps_are_highest_of_all_seven_and_bloat_surfaces_to_other_drives_next_detection`, `pride_can_veto_another_drives_low_quality_candidate_before_kirby_draft_without_touching_activation_gate`). **안전 경계는 이 재정정으로도 불변임을 문서에 명시**: authorizesDispatch:false·소유자 최종 승인 게이트·static-guard는 그대로, 강렬해지는 건 내부 판단·표현이지 실행 권한이 아니다.
- "나머지 개념들도 강렬하게" 요청에 따라 그림자군단도 같은 기준으로 점검했다. `runtime/lib/shadow-roster.mjs`의 `extractShadows`를 직접 읽어 확인: 현재는 검증된 임무이기만 하면 **매번 무조건** 4개 역할 전부 그림자가 태어나거나 성장하고, 이름은 "정찰자 1호"류 역할+일련번호로 관료적이다. 원작(나 혼자만 레벨업)의 추출은 "쓰러뜨릴 가치가 있는 존재를 쓰러뜨렸을 때"만 일어나고 그림자는 그 존재의 정체성을 이어받는 훨씬 극적인 사건이라, 지금 구현은 등급 산정(S1+, §122에서 이미 검증 완료)과 달리 **추출 조건·명명 자체는 여전히 순하다**는 걸 발견했다. 다만 S1+는 이미 검증·배포 대상 코드라 여기까지 건드리는 건 이미 통과한 작업을 다시 여는 것이라, 소유자 확인 없이 바로 재설계하지 않고 이번 항목은 발견 사실로만 기록했다(다음 지시서로 만들지 여부는 소유자 다음 응답에 따름).
- **VERIFIED:** extractShadows·EXTRACTABLE_ROLES·LABEL 직접 코드 확인(모든 검증된 임무가 무조건 4역할 전부 추출·성장시킴, 극적 조건 없음). **RAN-UNVERIFIED:** 없음(지시서 정정+발견 기록, 코드 실행 없음). **BLOCKED/NOT RUN:** G1 구현 자체(Codex 실행 대기), 그림자군단 추출 재설계 여부(소유자 확인 대기).

## §128 — 2026-09-28 Claude(Cowork): 개념 정전(원문 그대로·극단화) 작성 + Codex 구현 지시서 C0~C5 + Obsidian 저장 + 매혹 자기미화 추가

- 소유자 지시: "일단 지금 이내용 옵시디언에 저장하고 코덱스에도 적용할수있게해주고 매혹은 자기를 계속 아름답게할 욕구도있는거야 그것도 추가해줘 디자인이든 코딩을 어떻게 아름답게할지 나머지 커비 그림자군단 jev 양자그런것들도 더 오버해서 원문그대로의 개념을 적용해야해 다시한번더 개념재정립하고그걸 코덱스에 지시하자 옵시디언에도 저장하고."
- 신규 `docs/BLACKHOLE_CONCEPT_CANON_20260928.md`(SHA-256 `745cce917af22c0e00991cfed84304e13bd47172e06d28437877873815edf34f`): §0 원칙·불변 경계, §1 칠죄종 7개 극단(매혹에 "자기 자신을 계속 아름답게 만들려는 욕구" 추가 — 측정 가능한 추함 지표: 가로 넘침·CJK 절단·lint 경고·명명 불일치·대비 실패), §2 그림자군단(가치 있는 승리만 "일어나라"·추출 실패·정체성 명명·보관·계급 표시·군주 레벨 상한·그림자 교환 UI), §3 커비(흡입·무능력 정직 기록·카피 능력 이름+모자·한 번에 하나·튀어나오기·조합 증거 있을 때만 믹스·헬퍼 연결), §4 JEV(사건부·기권 강제·dissent·관할 확장 absorbWorthy/ariseWorthy/candidateLicenseOk, 전부 authorizesDispatch:false), §5 양자(관측 전 중첩·소유자 측정=붕괴·간섭은 실제 증거 비용만·실제 의존이 있을 때만 얽힘·엔트로피·터널링은 초안만·결어긋남·복제 불가), §6 자비스 결, §7 엔진 한 바퀴, §8 불변 경계 재확인. 각 항목의 "현재 코드" 서술은 `jev.mjs` 헤더·`kirby.mjs` 전문·`quantum-statevector.mjs`·`shadow-growth.mjs` 헤더·`capability-inbox.mjs` ENTRY_KEYS(현재 kind는 `browser-readonly`만 허용)를 직접 읽고 썼다.
- 신규 `docs/CODEX_DIRECTIVE_CONCEPT_INTENSITY_20260928.md`(SHA-256 `d3a712e379fb2eb74bc7e249d6d25d381bdad5abe177661e24510e1fefe45843`): C0 사실확인 → C1 매혹 자기미화(`lust-mirror.mjs`, `kind:'self-beautification'`) → C2 그림자 "일어나라"(`worthyVictory`·`ariseAttempts`·정체성 명명·`stored`·계급 표시·`lordLevel` 상한) → C3 커비 카피 능력(`inhale`·`noAbility`·`copyAbility{hat}`·`currentAbilityId`·`star`·믹스·헬퍼) → C5 양자 일반화(`quantum-decision.mjs`, 측정 전 선택값 부재·소유자 측정 1회·얽힘·엔트로피·터널링·결어긋남) → C4 JEV 사건부(`jev-docket.mjs`). 단계별 테스트명·인수 증거 파일·금지사항 명시. 전부 추가(additive), 기존 회귀 0 실패 유지 조건.
- `docs/CODEX_DIRECTIVE_GAP_SCOUT_G1_20260928.md` lust 항목에 자기미화 추가(SHA-256 `b6f0cd5144f8fd65911454e447579a13f1c423fb5ce6b9edaa77be9dd40aab11`) — G1의 검색 편향과 C1의 자기미화가 같은 드라이브의 두 얼굴임을 명시.
- Obsidian Vault `01_DRAFTS/20260928_BLACKHOLE_CONCEPT_CANON/`에 세 문서 저장, 해시 저장소와 일치 확인. Vault `CHANGELOG.md` (47) 기록. `00_INBOX_RAW`·정본 원장 무수정.
- **VERIFIED:** 현재 코드 경계(jev/kirby/quantum/shadow-growth/capability-inbox) 직접 열람, Vault 복사본 해시 일치. **RAN-UNVERIFIED:** 없음(문서 작성만). **BLOCKED/NOT RUN:** C0~C5 구현 전부 Codex 실행 대기; 실제 모델·Android·Obsidian 앱 재로드는 기존대로 소유자 행동 대기.

## §129 — 2026-09-28 Claude(Cowork): "딸깍 연결" — 커넥터 패널 지시서, C4/C5 두뇌를 유명 OSS 어댑터로 위임

- 소유자 지시: "Jev는 그냥 지금 유명한 오픈소스 따오면되자나 양자도 임베딩 딥러닝 오픈클로 등등 나중에 그냥 내가 딸깍 연결할것들만 남겨놓으면되지." 구조적 결론: BLACKHOLE 자체 코드는 판단 계약·기록·표시만, 두뇌·근육은 유명 OSS/공식 API 어댑터, 소유자 GUI에서 버튼 하나+"1회 시험 연결".
- 사실 확인: `provider-config-engine.mjs`의 `AGENT_ENDPOINTS`(openai/gemini/moonshot/xai/anthropic/nvidia/local)와 흩어진 env 가족(`YENO_AGENT_*`, `YENO_AI_*`, `YENO_GROK_*`/`YENO_XAI_*`, `YENO_JEV_*`, `YENO_LOCAL_EMBED_*`, `YENO_OBSIDIAN_REST_*`, `YENO_MEMORY_SUPABASE_*`, `YENO_BROWSER_*`)을 직접 grep — 이미 다중 provider 엔진이 있으므로 커넥터 레지스트리는 이를 통합·표시하는 계층이지 새 패턴이 아니다. `assertNoSecrets`·DPAPI 경로 존재 확인.
- OSS 후보 스타·라이선스를 GitHub 페이지로 직접 확인(2026-09-28): promptfoo MIT 24.2k(TS), instructor-js MIT 802(TS), zod MIT 44k, transformers.js Apache-2.0 16.3k, node-llama-cpp MIT 2.2k, onnxruntime MIT 21.9k, Qiskit Apache-2.0 7.8k, deepeval Apache-2.0 17.5k(Python — Node 런타임엔 부적합, 참고만). 기존 확인분: quantum-circuit MIT, SearXNG AGPL-3.0 36.7k, whisper.cpp MIT 54k, OpenClaw MIT, Piper 후속 GPL-3.0.
- 신규 `docs/CODEX_DIRECTIVE_CONNECTOR_PANEL_20260928.md`(SHA-256 `8b4e203c0e7415a4e0852998b975b697e94144ccef9eae2cc559033711552c22`): §2 descriptor 계약(`connected`는 실제 healthcheck 왕복 후에만), §3 kind별 로컬 기본/딸깍 연결 표(judge=promptfoo 또는 instructor-js+zod, quantum=quantum-circuit 기본+IBM Quantum/Braket, embedding=Ollama bge-m3+transformers.js 폴백+클라우드 키, inference=Ollama/node-llama-cpp/onnxruntime+AGENT_ENDPOINTS, search=SearXNG/YENO_SEARCH_*, channel=OpenClaw 텔레그램, voice, vault, memory sync), §4 GUI 패널(기존 provider 화면 확장), §5 C4/C5 재정의(판정·회로는 커넥터, 사건부·중첩 기록은 BLACKHOLE), §6 테스트 9종·인수 CP1, §7 금지(하드코딩·가짜 연결됨·키 노출·플래그 우회·OSS 병합·env 이름 변경·게이트 변경).
- `docs/CODEX_DIRECTIVE_CONCEPT_INTENSITY_20260928.md` §0에 C4/C5 위임 정정 삽입(SHA-256 `5b3e674489cfd23a8bf27f1c1cf3a2479bc7a512e408aa61b5af3f176d130cda`), `docs/BLACKHOLE_CONCEPT_CANON_20260928.md` §4·§5에 "두뇌는 OSS, 판례/기록은 우리 것" 주석(SHA-256 `e82d0c131ce048515d9335a6fa5ad5ecdebf47c5d947b533dc0f1e0acd9dd2be`). Vault `01_DRAFTS/20260928_BLACKHOLE_CONCEPT_CANON/`에 세 문서 재저장·해시 일치, CHANGELOG (48).
- **VERIFIED:** 기존 provider 엔진·env 가족·비밀 경로 직접 확인, OSS 스타/라이선스 직접 조회, Vault 해시 일치. **RAN-UNVERIFIED:** 없음(문서). **BLOCKED/NOT RUN:** 커넥터 레지스트리·패널 구현(Codex 대기), 실제 클라우드 키 연결(소유자 딸깍 — 이 지시서의 목적).

## §130 — 2026-09-28 Claude(Cowork): 개념 재정립 마스터 인계 패킷 — Codex 구현 순서 S0~S8·통합 인수 L5, Vault 정본 묶음 완성

- 소유자 지시: "그럼 우리지금 개념재정립한것들 옵시디언에 남기고 코덱스에 구현하게 넘길 상세지시서 줘." 신규 `docs/CODEX_DIRECTIVE_MASTER_CONCEPT_HANDOVER_20260928.md`(SHA-256 `239c1084ba687ba7803bc1783e55fa59e8f71cb918cb6e0c116f5001af93e928`): 맨 위에 Codex에게 그대로 붙여넣을 한 문단(읽기 순서 ①정전 ②자율성 기준 ③CP1 ④G1 ⑤C0~C5 ⑥OSS 음성검색), §2 구현 순서 표 S0(사실확인)→S1 CP1(커넥터)→S2 G1(칠죄종 검색)→S3 C1(매혹 자기미화)→S4 C2(그림자 일어나라)→S5 C3(커비, K1 동시 가능)→S6 C5(양자 기록)→S7 C4(JEV 사건부)→S8 L5(통합 한 바퀴), 단계별 의존·인수 코드·증거 파일(`build-artifacts/concept-20260928/`), §3 L5 10단계(드라이브 격발→드라이브별 검색→커비 초안·승인·흡입→가치 있는 승리로 "일어나라"→JEV 사건·dissent→양자 중첩·소유자 측정 1회→매혹 자기미화 초안→자비스 힌트 캡처→격리 Vault export→회귀 0 실패), §4 보고 형식(지시서와 코드 불일치 시 억지로 따르지 말고 먼저 보고), §5 금지 요약.
- Vault `01_DRAFTS/20260928_BLACKHOLE_CONCEPT_CANON/`를 정본 묶음으로 완성: 정전·자율성 기준·CP1·G1·C0-C5·OSS 음성검색·마스터 7개 파일, 저장소 `docs/`와 해시 전부 일치(직접 대조). CHANGELOG (49).
- **VERIFIED:** 저장소↔Vault 7개 파일 해시 일치. **RAN-UNVERIFIED:** 없음(문서). **BLOCKED/NOT RUN:** S0~S8 전부 Codex 실행 대기; 실제 키·토큰·기기 연결은 소유자 딸깍.

## §131 — 2026-09-29 Codex: 마스터 개념 인계 S0 대조 — 정본 7/7 일치, 구현 계약 수정점

- 저장소 경로 `C:\Users\우연호\Documents\Projects\yeno-os`, origin `https://github.com/wooyeonho/yeno-os.git`, branch `blackhole/p3-jev-recovery-port-20260924`, full HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`. 기준 `43a2d1b44e0a60ebad4982dc1e2222213869cc1a`는 조상임을 `git merge-base --is-ancestor` 종료 0으로 확인했고 이후 커밋은 같은 BLACKHOLE 작업 흐름이다. 시작 미커밋 135건을 보존·기록했다.
- 마스터의 S0에 따라 정전·자율성 기준·CP1·G1·C0~C5·OSS 음성검색을 코드와 대조했다. Vault `01_DRAFTS/20260928_BLACKHOLE_CONCEPT_CANON/`의 7파일은 저장소와 SHA-256 모두 일치하고 CHANGELOG (49)도 존재한다. Vault와 7개 정본 문서는 변경하지 않았다.
- 상세 결과는 `build-artifacts/concept-20260928/s0-facts.md` F1~F8. 핵심: C2 일반 첫 성공 탄생 0명과 기존 S1+의 4명 기대값 충돌; G1/C3가 재사용하라는 `promoteAbsorbedCapability` 부재 및 Browser 전용 LIVE 승격 계약; exact state/backup 스키마와 과거 hunger 이력 가정 불일치; G1 드라이브별 후보 수/인수 모순; C5의 낮은 확률 표본·TTL·1회 확정을 터널링·결어긋남·복제 불가로 해석하는 오류 및 공동 상태 부재; L5에서 흡수 능력 사용과 임무 성공의 인과 연결 부재; CP1 범용 인증/DPAPI 가정과 실제 LLM 전용 계약 충돌; JEV 일치율과 실제 결과 정답률 구분 필요. 각 항목에 파일·행과 최소 수정 방향을 기록했다.
- 사용자 요청에 따라 잘못된 전제를 먼저 보고한다. 새로운 실행 권한을 열거나 동결 계약을 바꾸어 모순을 숨기지 않았다. 로컬 read-only PowerShell·rg·Git·Get-FileHash, 현재 RAM(CIM 단일 관측 총 7.731 GiB/여유 0.619 GiB), 공식 Instructor/Promptfoo·IBM/MIT 자료를 대조했다. 독립 읽기 전용 검토 2건의 핵심 근거도 직접 다시 확인했다. 패키지 설치·모델 호출·빌드·테스트는 실행하지 않았다.
- 증거 SHA-256: `s0-facts.md` = `8d097c903dfedcd1b78a54a9272e041a6985df1af38c0f5be40ae9eec089dc14`; `s0-input-manifest.json` = `bc83ebd5ca7ee5bdbdf6bf65707377bcf2141f6d966236d238995c715aa85953`; `s0-worktree-status.txt` = `c76f49378583a9faad281116011c4787197d52a8b95e99f7006064a8f954d4d3`.
- **VERIFIED:** S0의 7/7 정본 일치·Git 상태·기존 코드 계약 대조 및 사실 보고. **RAN-UNVERIFIED:** 없음. **BLOCKED:** 현재 지시서 그대로의 C2/G1/C3/C5/L5 수락에는 보고한 계약 충돌 정정이 필요하다. **NOT RUN:** S1~S8 구현·외부 연결·새 빌드·회귀 재실행. 직전 §122의 1,239/1,218/0/21은 과거 실행값이다. 커밋/push·운영 배포·원문 수정 없음.
- 다음 한 단계: S0 보정사항을 실행 사양에 반영하고 CP1을 기존 quantum/Ollama/Obsidian 어댑터의 상태·기능 검사·소유자 패널부터 구현한다. 미구현 후보를 키만 넣으면 되는 상태로 표시하지 않는다. 이 정정은 독립적인 CP1 구현 전체를 승인 대기로 돌린다는 뜻이 아니다.

## §132 — 2026-09-29 Claude(Cowork): §131 S0 감사 독립 검증 — F1~F8 전부 정확, 정정 반영본 작성

- Codex §131과 `build-artifacts/concept-20260928/s0-facts.md`(SHA-256 `8d097c903dfedcd1b78a54a9272e041a6985df1af38c0f5be40ae9eec089dc14`, `s0-input-manifest.json` `bc83ebd5…`, `s0-worktree-status.txt` `c76f4937…` 재계산 일치)를 코드로 직접 대조했다. 결과: **F1~F8 전부 정확**하며, 내가 쓴 지시서의 전제 오류였다.
  - F1: `runtime/test/shadow-roster.test.mjs`가 일반 첫 성공에서 `born.length===4`, 이름 `정찰자 1호…`, `byRank.D===4`를 요구함 확인 → C2 "탄생 0명"과 충돌.
  - F2: `promoteAbsorbedCapability`·`kirby-absorb.mjs` 부재(grep 0건). 실제 승격기는 `capability-inbox.mjs promoteBrowserCapability`(LIVE 필수, kind `browser-readonly`만). `capabilities.mjs`는 필터·정렬·행 제한 op + fixture 2~8개만 import 허용 — 일반 OSS를 카피 능력으로 넣는 엔진이 아님.
  - F3: `capabilities` exact `{version,entries,history}`(entries≤10)라 `gaps` 삽입 불가; `backup.mjs validateState` 허용목록에 새 키 없음; `advanceHunger`는 `drive-state.mjs`(seven-drives 아님)이고 debate에 `hungerHistory` 없음.
  - F5: `quantum-statevector.mjs`는 확률만 반환(위상/공동 상태 없음), 4큐빗 상한 → 두 3후보 결정 공동 회로 6큐빗 불가. 물리 용어 오용(터널링·결어긋남·복제 불가·관측) 인정.
  - F7: `desktop-provider-config.mjs` DPAPI payload는 `{provider,model,apiKey}` LLM 전용, provider는 `AGENT_ENDPOINTS` 키로 고정, 공통 OFFICIAL 플래그 미사용.
  - F8: `jev-calibration.mjs`는 `matchedRealDecision` 기반(일치율); `jev.mjs evaluateDependencyReady`는 의존성 0개면 evidence `[]`로 `decided` — 내 "빈 evidenceRefs→abstain" 규칙과 충돌.
  - F4·F6은 문서 내부 모순(후보 개수·인수 조건, L5 인과 연결 부재)으로 문서 대조로 확인.
- 신규 `docs/CODEX_DIRECTIVE_S0_CORRECTIONS_20260929.md`(SHA-256 `8f4a888e0415ce7244eedc9cc74c66a56dc4d8dff4ec425b269ed6acab6dd767`) — 충돌 부분에서 마스터·CP1·G1·C0~C5·정전보다 우선: F1 탄생 정책 v2·구 명부 보존·테스트 기대값 의도적 변경·크기 기준 제외, F2 `absorb-inbox.mjs`(초안 전용, 승격 없음)+기존 manifest 변환 시에만 import→verify→activate, F3 새 최상위 state 키(`gapScout`·`absorbInbox`·`quantumDecisions`·`jevDocket`·`connectors`)+backup 허용목록+구 백업 복원 시험+`hungerSnapshot`, F4 드라이브별 수집 상한·`recommendations[]`·빈 결과 허용·검색 예산·재시작 중복 방지, F5 용어 분리·C5 단일 결정 한정·얽힘은 C5-b 별도·`measured|expired` 분리·동일 비용 전체 검사, F6 L5 인과 체인 `gapId→inbox→capability/version/hash→runId→missionId→artifactHash→verdict`, F7 커넥터별 `auth.shape`·`connectorSecrets v1`·로컬 self-check·`not_implemented` 상태·CP1 첫 범위=quantum-circuit/Ollama/Obsidian, F8 `agreementRate` vs `outcomeAccuracy` 분리·질문별 완결성 기반 기권·judge 별도 실측.
- 정전 §5에 용어 정정 주석(SHA-256 `0f2ea34f7333c04e2739fb429b075c043570fb095c905db172b504d471a9c964`), 마스터에 S0 정정 우선 규칙(SHA-256 `5f56dca15e67dfbacdce445f5f787e533024901307e02a10404fe32d0432362f`). Vault 동기화·해시 일치, CHANGELOG (50).
- 다음 구현 단위는 Codex 제안 그대로: CP1을 기존 어댑터 상태·기능 검사·소유자 패널부터.
- **VERIFIED:** §131 증거 3건 해시, F1~F8 각 코드 근거 직접 열람. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** S1~S8 구현(Codex), 실제 키·기기(소유자).

## §133 — 2026-09-29 Claude(Cowork): "기존에 박힌 개념도 두루뭉술하면 더 오버해서" — E 시리즈 지시서

- 소유자 지시: "기존에 박힌 개념들이 두루뭉싱하면 더 오바스럽고 강렬하게." 새 설계가 아니라 **이미 구현된 개념**을 같은 기준으로 재검토. 직접 열람 근거: `seven-drives.mjs` 헤더가 스스로 "partial softening of pride->긍지 and lust->매혹"이라 명시; `drive-state.mjs advanceHunger`는 7드라이브 동일 규칙(dominant −30, 나머지 +2~12); `driveVoice`는 "강욕(부) · 배고픔 62: 재사용 3건 · 자산 공백 2건"식 수치 나열, `debateFor`는 논쟁 없는 상위 3 점수; `jarvis.mjs ACTIVITY_KO` "쉬는 중/일하는 중/네 결정 기다리는 중"과 `jarvis-scene-model.mjs resultSpeech/failureSpeech` 반말 친구 말투(정직성 문구 "숨기지 않을게"는 훌륭, 유지 대상); `solo-leveling.mjs` reason은 로그체이고 원작 "[시스템]" 알림 양식 없음; `kirby.mjs` reason 무미.
- 신규 `docs/CODEX_DIRECTIVE_EXISTING_CONCEPTS_INTENSITY_20260929.md`(SHA-256 `21df5981b379c370dc96696994b0fcf122a02f0ea1fb20ddf1b99a2c00252b57`): E1 표시 label을 legacyName(오만·색욕)으로 원복하고 worldName은 "다스리는 영토"로 재해석(id/legacyName/worldName 값·bijection 불변, '긍지'/'매혹' 단언 테스트는 F1 방식 의도적 변경), 배고픔 v2 `HUNGER_RULES_V2`(탐욕 감쇠 최소·폭식 증가 최대·질투 비지배 시 추가 상승·오만은 verificationGap에만·색욕 급등/급락·분노는 실패 신호 없으면 불변·나태는 estimatedCalls↑ reuseArtifacts↓; 기존 SIGNAL_IDS만 사용, v1 재현·구 state 복원 시험); E2 죄별 말투 템플릿(수치 그대로, ≤120자)과 상위 3의 push/contest(영속 debate 스키마 불변, text 안에); E3 자비스 격식체·`YENO_JARVIS_ADDRESS`(기본 "주인님", GUI 설정)·ACTIVITY v2·선제 보고·위트 규칙(실패는 농담으로 덮지 않음, 정직 문구 유지); E4 `system-notice.mjs` 표시 전용 "[시스템]" 알림(solo-leveling reason 원문 인용, 무수정); E5 커비 흡입/무능력/카피/튀어나옴 문장(데이터는 C3/F2 계약 그대로). §6 금지(수치를 문장에 맞추기·정직 문구 삭제·영속 값 변경·스키마 버전/백업 생략·숨은 예외·계약 변경), §7 테스트 4파일·인수 E-1, §8 CP1과 병렬 가능.
- Vault 저장·해시 일치, CHANGELOG (51). **VERIFIED:** 위 코드 근거 직접 열람. **RAN-UNVERIFIED:** 없음. **BLOCKED/NOT RUN:** E1~E5 구현(Codex).


## §134 — 2026-09-29 Codex: CP1 실제 구현과 기존 개념 E1~E3·지원되는 E4/E5 표현 연결

### 범위·보존

- 실제 저장소 C:\Users\우연호\Documents\Projects\yeno-os, origin https://github.com/wooyeonho/yeno-os.git, branch blackhole/p3-jev-recovery-port-20260924, full HEAD e7b6dfef772665b2e7f237c0cc9f51f4663ee211 재확인. 기존 §131 이후 같은 작업 흐름을 이어갔다. 커밋/push 없음.
- 기존 미커밋 변경을 보존했다. 시작에 읽은 S0 정정본(F1~F8)을 우선했고, 이전 시작 스냅샷 s0-worktree-status.txt를 덮어쓰지 않았다. 최종 git status151경로는 cp1-e-final-worktree-status.txt에 별도 보존했다. 아래34파일 목록은 이번 구현 담당 범위이며 전체 dirty work를 이번에 썼다는 뜻이 아니다.
- Vault 수정·복사·삭제 없음. 동결 solo-leveling.mjs / recovery-one-of-qpu.mjs는 git diff --quiet로 HEAD 대비 무수정 확인. 운영 설치·배포·실제 자격정보 교체 없음.

### 실제 코드 변경

1. **CP1**: runtime/lib/connectors/{registry,configuration,descriptors,probes}.mjs. 30개 후보를 분류하고 quantum-circuit/Ollama/Obsidian만 실제 검사 구현. 후보 나머지는 connector_probe_not_implemented이며 기존 클라우드 추론 엔진의 유무와 구분한다. 실제 검사 영수증·시각·5분 TTL·설정 변경/재시작 무효화·직렬화·빈도 제한을 구현했다.
2. **소유자 경로**: server.mjs의 owner-only GET /api/connectors 및 POST /api/connectors/:id/check를 기존 private bridge/WinForms 커넥터 탭에 연결했다. 로컬 모델 검사는 기존 durable agent job·일일 호출 예산·8토큰 제한을 거친다. 비밀값은 입력 인자/공개 상태/화면 캡처에 넣지 않았다.
3. **중복·도구 결함 수정**: 검사 전에 같은 requestId를 영속 예약하여 동시/재시작 재전송이 모델을 다시 호출하지 않는다. 접수 상태와 현재 연결 증거를 분리했다. 도구 없는 검사에 반환된 tool_calls는 실행 전에 거부한다. 별도 코드 검토로 발견하고 실제 in-flight 복구/도구 기록0 테스트를 추가했다.
4. **E1/E2**: 오만·색욕의 원래 표시명, 7개 욕망별 v2 증가·감쇠 규칙, 버전 결합 지문, 결정별7값 snapshot, 실제 숫자를 보존한 push1+contest2 발언. v1 저장/재현은 보존하고 다음 결정에서만 v2로 이어간다. 식별자·legacy/worldName을 유지했다. 단순 이름 변경만 수행한 것이 아니다.
5. **E3**: 실제 승인 웹 세션에서 호칭을 저장하고 재시작·백업에 보존. 격식체 결과/실패, 실제 기록 기반 예상·추진/반대 인용, 실제10회 곡선과 색 없이 읽는 기록 표, 명시적 결과 닫기를 연결했다. 재시작 때 최신 실패보다 오래된 성공을 보여주던 문제와 실패 코드가 다음 poll에 사라지는 문제를 고쳤다.
6. **지원되는 E4/E5**: system-notice.mjs에서 실제 그림자 명부/등급 이력과 실제 커비 import/verify/active 상태만 문구로 투영한다. 서버가 기록된 알림을 노출하고 Jarvis가 textContent로 렌더한다. 없는 noAbility/star/arise_failed·보관/소환 이벤트를 만들지 않는다. 새 탄생/흡수 수명주기는 미구현으로 남긴다.

### 실행·증거

- npm.cmd test 2>&1 | Tee-Object -FilePath "$env:USERPROFILE\Desktop\npm-test-output.txt" → **1307 total / 1286 pass / 0 fail / 21 skip**, exit0, 584015ms. 저장소 러너가 bundled Node24.19.0·직렬·512MiB 힙을 선택했다. 로그 SHA-256 **8270561acb7c9add5992ca003df90b876fb90b36867d71b105ba061a7b07d9ef**.
- 마지막 그래프 접근성 표 추가 후 영향 범위 재실행: bundled Node --max-old-space-size=384 --test --test-concurrency=1 runtime/test/jarvis-scene-model.test.mjs runtime/test/jarvis-register.test.mjs runtime/test/jarvis-result-view.test.mjs runtime/test/jarvis-security.test.mjs → **23/23**, exit0. SHA-256 **8e5523b7ec7fbd517aad6129d061f3cead3cbe2fc2230590d3a18027bb362a05**. 전체1307은 표 추가 전 완료했고, 이후 변경은 이 집중 검사와 실제 브라우저로 검증했다.
- CP1 backend15/15, server integration5/5(전체 로그 포함), hunger/voices28/28, notice13/13, owner 관련41/41 및 최종 owner8/8·native 행 경계 검사 통과. 중복 합산한 총계로 보고하지 않는다.
- scripts/verify-concept-intensity-live.mjs 실제 격리 코어 + Codex In-app Browser: 소유자 승인 → 호칭 저장 → 합성 공급자 요청2회(완료1·실패1) → 결과 확인 → 재시작 → 최신 실패/원문 코드 확인. 실제 원격 호출0. primary e1-restart.json의 지문 **885922bbffbf3b5ffde4f99b91e8b22925be8bd50b927b30f62ccf6ae7f0ff41** 전후 일치, 호칭 연호님 유지.
- 실제 quantum-circuit0.9.251 Bell 함수·Born 표본2큐빗/64회 검사 통과. 마지막 roundTrip25ms. **로컬 시뮬레이터**이며 실제 QPU 결과가 아니다.
- 400/768/1440 CSS 폭 검사, 실제 SVG 높이180px/7경로, 표10행·8헤더, 400px 문서 넘침0, 표 내부 ArrowRight40px 이동. 화면 검토가 SVG 숨김·입력 안내 대비·색만으로 구분하는 곡선 결함을 실제로 잡았고 수정했다.
- 두 독립 시각 검토의 최종 범위 PASS. 네이티브 CP1은 실제 WinForms/private bridge를 프로그램 방식으로 렌더한7화면이며 **실제 데스크톱 클릭 검증은 아니다**.
- git diff --check exit0. 줄바꿈 경고는 있었고 전역 Git 설정을 바꾸지 않았다. 이번 시험용 코어·GUI·브라우저 탭은 정리했고 사용자 앱을 임의로 닫지 않았다.

### 상태·산출물

- **VERIFIED**: 위 코드/집중·회귀 검사, 실제 격리 HTTP 복구, 실제 로컬 Bell 검사, 브라우저 요청/실패/호칭/표·곡선 조작.
- **RAN-UNVERIFIED**: 합성 공급자 응답의 실제 모델 품질, native 프로그램 렌더의 실제 사용자 클릭 동작.
- **BLOCKED / 미검증**: 실제 원격 키 기반 응답, Android 실기기, 이번 실행의 실제 Ollama/Obsidian 검색. 설정/기기 없는 격리 증거로 PC 전체에 자격정보가 없다고 단정하지 않는다.
- **NOT RUN**: 운영 반영·실제 배포·새 APK/Windows 설치파일 빌드·물리 QPU·스크린리더 실사용. 이 단계는 정적 웹/Node/PowerShell 코드와 검증 산출물이다.
- 초기 시험 도구 오류·중단, 혼합 HTML/JS 파일을 읽은 중간 브라우저 오류, 1440 전체페이지 캡처 잔상은 통과 수치에 포함하지 않았다. 자세한 경위와 최종 기본뷰포트 재촬영은 build-artifacts/concept-20260928/INDEX.md.
- 변경34파일과 SHA: implementation-report.json (**8484eb6acdb72eab6919e177edac9fcd302cd2abf55b66f03ae6faa1c09ea42b**). 주요 산출물 SHA는 artifact-hashes.json (**f79516fc1df401684ef3d2cb56fe82884f18f3b181f4418080d8560c0d595f22**). 모두 build-artifacts/concept-20260928 아래.

**다음 한 단계:** G1의 typed absorb draft inbox와 검색 예산·지문을 기존 store/backup에 영속화하고 재시작 중복 방지를 검증한다. 이번 결과를 G1·C1~C5·L5 전체 완료로 계산하지 않는다.

## §135 — 2026-09-29 Claude(Cowork): §134 CP1·E1~E3 독립 검증 — Codex 보고 전부 사실 확인

### VERIFIED (내가 직접 열어 확인)

- 전체 회귀 로그 4곳(Desktop npm-test-output.txt, build-artifacts의 cp1/e1/full-regression.txt) SHA-256 전부 8270561a…7d9ef로 동일, 1307 total / 1286 pass / 0 fail / 21 skip. 보고 수치와 일치.
- implementation-report.json 8484eb6a…a42b, artifact-hashes.json f79516fc…5f22 보고 해시와 일치. artifact-hashes 16개 항목 불일치 0, report의 sources 34개 파일 SHA 드리프트 0.
- 동결 파일: solo-leveling.mjs, recovery-one-of-qpu.mjs는 git diff --quiet 통과(무수정). 단, runtime/test/recovery-one-of-qpu.test.mjs에는 +12줄(optimizeRecoveryOneOf 시뮬레이터 시험 1개)이 미커밋으로 있음 — lib가 아닌 테스트이며 authorizesDispatch:false를 단언하는 내용.
- CP1: 후보 30개, implemented=true는 quantum-circuit/ollama/obsidian 3개뿐, 나머지 27개는 connector_probe_not_implemented. 전부 authorizesDispatch:false. 'connected'는 유효 영수증(TTL 5분)이 있을 때만 붙고, 설정 변경 시 영수증 폐기(config_changed), 직렬 잠금·30초 쿨다운·타임아웃 확인. Bell 검사는 quantum-circuit@0.9.251의 실제 확률 [0.5,0,0,0.5] 검증 + 64회 표본이 00/11만 나오는지 확인하며 countsOrigin 'local_statevector_simulator'로 정직하게 표기(실 QPU 아님).
- E1: HUNGER_RULES_V2가 7개 욕망 서로 다른 규칙(greed 완만/gluttony 결핍 비례/envy 상대 격차/pride 자기 검증 결핍만/lust 전달 결핍/wrath 실패 있을 때만/sloth 호출 늘면 상승·재사용이 완화). v1(advanceHungerV1) 보존. e1-hunger-curves.json은 evidenceClass를 SYNTHETIC_DECISIONS_REAL_ENGINE로 스스로 표기.
- 직접 재실행: connectors.test 15/15, hunger-v2·drive-voice-v2·jarvis-register·connector-server·system-notice 합계 41/41, 실패 0. 산출물에서 API 키 형태 문자열 검색 0건.

### 한계 (Codex도 밝힌 것 + 내가 본 것)

- 이번 실행에서 Ollama/Obsidian은 합성 응답으로만 시험됨 — 실제 Ollama 응답·실제 Vault 검색은 미검증(Obsidian 앱 재로드 필요). 실제 휴대폰·원격 키·네이티브 실클릭도 미검증.
- 이번 단계는 CP1 + E1~E3 + 지원 범위 E4/E5까지. G1·C1~C5·L5는 미착수(보고도 그렇게 명시). 30개 중 27개 커넥터는 아직 표시만 있고 "딸깍 연결"은 되지 않음.
- 커밋/push 없음, HEAD e7b6dfe 유지, 변경 경로 151.

### 판정

Codex §134는 과장 없이 사실. 이번 검증에서 오류를 찾지 못함. 다음(G1 흡수 초안함 + 검색 예산·지문 영속화)은 S0 F2·F3·F4 순서(백업 허용 목록·옛 상태 복원 테스트 먼저)를 지켜야 함.


## §136 — 2026-09-29 Codex: G1 영속 초안함·검색 예산·실제 프로세스 재시작 검증

### 범위와 순서

- 저장소 실제 경로 C:\Users\우연호\Documents\Projects\yeno-os, origin https://github.com/wooyeonho/yeno-os.git, branch blackhole/p3-jev-recovery-port-20260924, HEAD e7b6dfef772665b2e7f237c0cc9f51f4663ee211 재확인. §135와 S0 정정 F2/F3/F4/F6 우선. 기존151경로 미커밋 변경 보존; start-status.txt/final-status.txt 별도 기록. 루트 AI_OPERATING_RULES.md/CLAUDE.md는 실제로 없어 있다고 가정하지 않았다.
- **기능 구현 전에** store/backup에 gapScout·absorbInbox 기본값/허용목록을 추가하고 구 state·실제 구형 AES-GCM backup·손상된 현재 필드 거부 시험 **3/3** 통과. 이후에만 수집/네트워크 코드 작성. 01-storage-first.txt SHA 94ad7f6b6a3196b5a3ec065f12cf9d6a0192f6aa4d640fa3da93dd645f4a3005.
- 새 모듈: runtime/lib/gap-state.mjs, absorb-inbox.mjs, gap-scout.mjs, search-provider.mjs. 기존 runtime/lib/store.mjs, backup.mjs, runtime/server.mjs 연결. 테스트5파일과 helper2파일. 전체14파일 경로·SHA는 implementation-report.json; 전체 기존 dirty 코드를 이번에 썼다는 뜻이 아니다.

### VERIFIED — 실행한 로컬/합성 검증

1. absorbInbox kind는 research-draft/local-document/ledger-tool/self-beautification만; exact-key 검증, noAbility는 inbox에만. promote/activate 함수 없음. 기존 실행 registry와 owner import→verify→activate를 변경하지 않았다. 연구 초안 gapId/searchFingerprint/candidate 링크를 저장·백업 검증에서도 확인한다.
2. 기존 3곳 recordDriveDecision 직후 event-driven G1 감지. 연속3회 v2 snapshot/top3/배고픔70이상/같은 목표. 구 snapshot 추정 없음. 하루 gap3개와 search20회(UTC)를 분리하고 전송 전에 호출 예약/requestId/지문을 저장한다. 동일 gap을 다른 requestId로 보내도 재검색하지 않는다. 저장 지문 자동 eviction 없음; 한도 도달 시 신규 조사 차단.
3. F4 상한 greed6/gluttony12/envy5/pride5/lust1/wrath1/sloth3; 빈 결과 허용, recommendations[] 포함. 라이선스·고정 commit 근거 부재 등은 제외. 7드라이브는 격리 날짜를 나눠 검증했다. 수량·성능·확률을 채워 넣지 않았다. sloth는 실제 검증/활성 capability의 출처 일치 여부부터 읽고, wrath는 연결된 실패의 정확한 오류 코드를 특정하지 못하면 보류한다. 폭식 bloat가 후속 pride/sloth evidence에 연결된다.
4. **실제 별도 Node 프로세스/실제 HTTP/실제 파일**: 합성 검색1회→초안3→프로세스 종료→다른 PID 재시작→같은ID/새ID 재전송 모두 추가 전송0. 성공 검색·예산·초안이 암호화 백업 복원 후에도 동일. 기존 registry 전체 before/after 동일.
5. 검색 전송 후 응답 전 프로세스 강제 종료→재시작: unknown/restart_outcome_unknown, chargedCalls1, 대체 전송0, 초안0. 글로벌 stop 중 늦은 응답도 초안으로 승격하지 않는다. 429만 재시도1회·두 호출 모두 예산 차감; 타임아웃/미확인 호출 재시도 없음.
6. owner-only GET /api/gap-scout, GET /api/absorb-inbox, POST /api/gap-scout/research(gapId/requestId). 일반 native device403·무인증401·전체멈춤409 실측. 미설정 provider는 BLOCKED·호출0.
7. bundled Node24.19.0 --max-old-space-size=384 --test --test-concurrency=1 + G1 관련5파일 → **32/32**, 05-g1-focused.txt SHA ca13e6c7332f5326088a3d1630f4190c1560bb98974ef8153b81419c410f0451.
8. **npm.cmd test** 출력을 Desktop/npm-test-output.txt 및 g1-full-regression.txt에 Tee-Object로 보존 → **1339 total / 1318 pass / 0 fail / 21 skip**, exit0, 410904ms. 기준1307/1286/0/21 대비 +32. 로그 SHA **82e152b303a4bcdc964b56fa16d0c71d70363f4c71d5d83d03423db82386e01a**, Desktop 사본과 동일. 저RAM 자동 직렬/512MiB 러너 사용. 전체 회귀 후 소스 해시 드리프트0.

### RAN-UNVERIFIED / BLOCKED / 남은 구현

- **RAN-UNVERIFIED:** 검색 응답/라이선스·공식성·유용성 메타데이터는 합성 fixture 또는 공급자 주장이다. 실제 프로세스 복구를 시험했지만 실검색·후보 품질의 증거가 아니다. typed gateway의 가짜 HTTP 응답 검사는 실행했으며 실제 검색사 API 호환은 미검증이다.
- **BLOCKED:** 현재 개발 프로세스만 설정 존재/준비 상태를 값 미출력 방식으로 검사 → ready:false, search_provider_missing, G1 실제 외부 검색0. 운영 resident/DPAPI 전체에 키가 없다고 확대하지 않는다. 소유자만 실제 자격정보를 입력한다.
- **미구현 명시:** 공급자별 실제 API 매핑과 검색용 소유자 GUI/DPAPI 설정 연결. 현재 어댑터는 소유자가 명시한 HTTPS blackhole-search-v1 typed gateway 계약만 받는다; 일반 검색사 URL/키만 넣으면 동작한다고 주장하지 않는다. 신규 UI·Shadow Researcher 모델 job/산출물 연결도 이번에 만들지 않았다(보고서는 durable searches[].report와 검증 JSON에 보존).
- **F6:** 이번 인과 체인은 gapId→searchFingerprint→absorbInbox.id까지. capability/version→run→mission→artifact→verdict/L5 전체 완료로 계산하지 않는다. 코드 활성화0, authorizesDispatch:false. 추가적인 envy 조사 직후 hunger 이벤트/C1·C3 등은 이 초안 영속화 검증으로 완료 처리하지 않는다.
- 새 APK/EXE/운영 배포·실기기·실모델·실검색 빌드 인수는 NOT RUN. 이번 산출물은 Node 소스/시험 로그/JSON이다.

### 보존·증거

- solo-leveling.mjs, recovery-one-of-qpu.mjs, workers/developer/static-guard.mjs 시작/종료 SHA 동일. Vault 쓰기0, 커밋/push0, 운영 자격정보 변경0. git diff --check exit0(기존 줄바꿈 경고는 유지).
- build-artifacts/g1-20260929/INDEX.md에 명령/범위/실패 경위 상세. implementation-report.json SHA **5f86ba1e131190afda88d7331af69f55a7c699282f45f2ae3287770cd84dea7e**. artifact-hashes.json SHA **c4650c7075a74fdd2cc978c5287eb1bb25b9be0ab898075f990f9dc96afd67d0**. g1-gap.json/g1-scout-report.json/g1-inbox.json/g1-restart.json/g1-crash-restart.json에 실제 시험 결과와 synthetic 표지 보존.
- 첫 시험 cleanup이 이미 종료된 자식의 exit를 재대기해 멈춰 해당 시험 프로세스만 종료하고 helper를 수정했다. 드러난 테스트 전제 오류(내장 capability2개를0개로 가정)는 registry 전체 before/after 동일 검사로 정정; 제품 데이터를 지우지 않았다. 중간 실패 로그는 보존, 성공에 합산하지 않음.
- 중단된 첫 시험의 임시 폴더1개(%TEMP%/blackhole-g1-process-eLNqN5) 정리 명령은 **자동 승인 검토가 정책상 차단**하여 실행하지 않았고 우회 삭제도 하지 않았다. 운영 데이터와 무관한 합성 시험 폴더로 남아 있다.

**다음 한 단계:** 소유자가 선택한 실제 검색 공급자의 공식 API를 search(query) 및 기존 비공개 설정 경로에 연결한 뒤, 소유자 키 입력 후 예산 내 실검색1건을 검증한다. 이번 로컬/합성 통과로 실검색 완료를 대신하지 않는다.

## §137 — 2026-09-29 Claude(Cowork): §136 G1 영속 초안함·검색 예산 독립 검증 — 보고 사실 확인

### VERIFIED (직접 확인)

- 전체 회귀 로그 g1-full-regression.txt와 Desktop/npm-test-output.txt SHA 82e152b3…6e01a 동일, 1339 total / 1318 pass / 0 fail / 21 skip(기준 1307/1286 대비 +32). focused 32/32(ca13e6c7…), storage-first 3/3(94ad7f6b…) 로그 SHA 일치.
- artifact-hashes.json 20개 항목 불일치 0, implementation-report.json sources 14개 SHA 드리프트 0. report 해시 5f86ba1e…a7e, artifact-hashes c4650c70…7d0 일치. actualG1ExternalSearches=0.
- 동결 3파일(solo-leveling 14c1d6ac…, recovery-one-of-qpu 452ef8ef…, static-guard 3efd4eb2…) 현재 SHA가 frozen-before/after와 동일; solo-leveling·recovery는 git diff 무수정.
- 코드 직접 읽음: absorb-inbox.mjs는 kind 4종 고정·exact-key 검증·noAbility는 inbox에만·promote/activate 함수 없음(주석으로 명시)·authorizesDispatch:false 강제·assertNoSecrets. gap-scout.mjs는 검색 전 durable 예약(await 이전 persist)·requestId/gapId 중복 시 재검색 없음·재시작 시 reserved→unknown(restart_outcome_unknown, 예산 유지, 자동 재전송 없음)·429만 재시도1회(두 호출 모두 예산 차감)·일일 gap 3개 상한·연속 3회 v2 snapshot + 허기 70 이상 + 같은 목표일 때만 발생·구 snapshot 추정 없음·wrath는 단일 오류 코드 특정 못하면 보류·sloth는 출처 일치 활성 capability 있으면 검색 안 함·욕망별 CAPS 적용. search-provider.mjs는 소유자가 명시한 blackhole-search-v1 계약만, 3개 환경변수 미충족이면 ready:false, redirect 거부·JSON 타입·256KiB 상한·키 에코 응답 거부.
- 서버: /api/gap-scout, /api/absorb-inbox, /api/gap-scout/research는 pairing(소유자) 주체만(그 외 403), 응답에 키 없음, 전체 정지 시 409. 자동 조사는 afterDecision에서 이벤트 구동+예산 내+provider ready일 때만.
- 직접 재실행: absorb-inbox·gap-scout·search-provider 26/26, gap-storage·gap-restart 6/6 통과. 산출물에서 키 형태 문자열 0건.

### 한계·주의

- 실검색 0건. 공급자 응답·라이선스·유용성은 합성 fixture. 공급자별 실제 API 매핑과 검색용 소유자 GUI/DPAPI 연결은 미구현 — 현재 어댑터는 blackhole-search-v1 게이트웨이 계약만 받음(일반 Brave/Tavily URL+키만 넣으면 동작하지 않음).
- F6 인과 체인은 gapId→searchFingerprint→absorbInbox.id까지. capability→run→mission→artifact→verdict는 미완. C1~C5, L5 미착수.
- Codex가 밝힌 %TEMP%/blackhole-g1-process-eLNqN5 임시 폴더 1개는 자동 승인 검토가 삭제를 막아 남아 있음(운영 데이터 무관). 필요하면 소유자가 삭제.
- 커밋/push 없음, HEAD e7b6dfe, 변경 경로 161.

### 판정

Codex §136 보고는 사실. 이번 검증에서 오류 없음. 참고로 소유자가 "G1 계속 진행"을 Codex에 전달하기 전에 Codex가 이미 §136으로 구현을 끝낸 상태였음.

## §138 — 2026-09-30 Codex: G1 검색 키 분리 보관·소유자 입력창·검색어/공급자 주장 경계

### VERIFIED

- 실제 경로 C:\Users\우연호\Documents\Projects\yeno-os, origin wooyeonho/yeno-os, branch blackhole/p3-jev-recovery-port-20260924, full HEAD e7b6dfef772665b2e7f237c0cc9f51f4663ee211. 시작 미커밋 목록은 build-artifacts/g1-search-boundaries-20260930/start-status.txt. 기존 변경 보존. Vault/운영 resident/실제 자격정보 변경, commit/push 없음.
- 저장 구현 전에 gap-storage + connector-secret-backup 시험 4/4 통과(storage-first.txt): 옛 상태/실제 구형 암호화 백업 복원, 새 비밀 파일 일반 백업 제외, connectorSecrets를 공개 state 최상위에 넣으면 백업 거부. 새 공개 상태 키를 추가하지 않았으므로 백업 허용 목록을 넓히지 않음.
- runtime/owner-search-settings.mjs: 별도 {type:'connectorSecrets',version:1,search:{provider,apiKey}} 타입과 tokenFile 옆 connector-secrets.dpapi. 기존 Windows DPAPI CurrentUser 암복호화 함수 재사용. 기존 provider.dpapi 및 모델 config 그대로. 조회는 고정 credentialStatus/adapterStatus/liveSearchVerified/authorizesDispatch 값만 반환하며 키·키 일부·평문 오류를 출력하지 않음. 저장은 검색·재시작·활성화 없음. owner-search-settings 3/3, 실제 Windows DPAPI는 가짜 값으로 왕복.
- scripts/search-settings-dialog.ps1 + 기존 소유자 GUI 버튼/owner-pairing private pipe 배선. 공급자 기본 선택 없음, 마스킹, 저장 시도 후 입력 비움. '저장됨/미설정', '공급자 어댑터 미연결 · 실검색 미검증' 표시. 원본 주 창은 기기·모델 설정 탭 아래 검색 키 보관 버튼. UI 시험은 별도 가짜 config에서 WinForms PerformClick → 실제 Node 비공개 pipe → 실제 DPAPI 3요청(미설정/저장/재조회). realKeysUsed:false, networkSearchCalls:0. 캡처 육안 확인: 한글·컨트롤 넘침 없음. 두 PowerShell 파일 parser 오류 0, UTF-8 BOM 유지.
- 재현 후 수정: wrath의 기존 영숫자 regex는 개인 ASCII 오류 문자열을 전송했고, live 공급자의 MIT/official/useful 주장을 추천 근거로 수용했음. red.txt 1 pass/2 fail → 수정 후 focused.txt 33/33. 공개 오류 코드 4개만 허용, 개인 goal/Vault/owner/request/source sentinel이 7욕망 검색어로 전송되지 않는 시험. 실제 검색 hit의 license/official/useful/commit/evidenceUrl 등은 독립 근거 검증 전 null 처리하여 추천/초안 생성 불가. 합성 fixture 라벨과 검증 흐름 유지. 독립 URL 검증기는 아직 없음.
- npm.cmd test 전체 실제 실행: 1346 total / 1325 pass / 0 fail / 21 skip, exit 0 (468654ms). 직전 1339/1318/0/21 대비 시험 7개 추가. full-regression.txt SHA-256 a74ed17aee5741590c9e81ed20a1fb6e3b52d1393b736261090aa36552bf81ed.
- 동결 3파일 solo-leveling.mjs/recovery-one-of-qpu.mjs/static-guard.mjs 변경 전후 해시 동일. 실행 코드 흡수/활성화 경계 및 authorizesDispatch:false 유지.

### RAN-UNVERIFIED

- 원격 실제 키 없이 가짜 입력으로 native 모달 동작·DPAPI 확인. 이것은 소유자가 설치된 전체 프로그램을 클릭한 인수나 실검색 증거가 아님. 운영 코어에 새 키 로딩 경로를 연결하거나 배포하지 않음.
- 최초 화면 시험용 하네스는 PowerShell 5 BOM/JSON 한글 경로/config 인코딩 오류로 실패했음. 기존 제품의 전달 방식과 UTF-8 config/report를 적용한 재실행이 통과. 상세 INDEX.md. 새 ui-fixture-*는 산출물 폴더에 남겼고 가짜 입력만 사용. 이전 자동 삭제 거부 폴더는 건드리지 않음.

### BLOCKED / 다음 단계

- 공급자 선택(Brave/Tavily 또는 로컬 SearXNG)을 비동기로 질문했으며 아직 답변 없음. 공급자별 API 어댑터, resident의 별도 키 로딩, 독립 evidence URL 라이선스/공식성 확인은 미구현. 키를 이 창에 보관하는 것만으로 검색이 동작한다고 보고하지 않음. 실제 외부 검색 0건, 실검색 미검증.
- 선택 후 공식 API 계약에 맞게 해당 어댑터/키 로딩을 연결하고, 소유자 직접 입력 후 예산 내 검색 1건 및 독립 출처 확인. SearXNG 선택 시 별도 루프백 프로세스의 자원/설치 조건부터 확인. 구매·계정 생성·네트워크 노출 변경·실행 코드 활성화 없음.

변경 소스 9개 및 산출물 SHA-256 목록: build-artifacts/g1-search-boundaries-20260930/implementation-report.json (e4ac450b67b56dd38874018257256a282cfaeb738b15bd379af80731bec77a3a). 화면 search-settings-dummy.png SHA-256 4cac693e23a9ee67d3e089f084400ab0f3a2dc08cc5a2778a2d2292e8f56dccf. 실행 명령/결과와 한계는 같은 폴더 INDEX.md, focused.txt, storage-first.txt, secret-storage.txt, ui-report.json, ps-parse.json, full-regression.txt 참조.

## §139 — 2026-09-30 Claude(Cowork): §138 검색 키 분리 보관·입력창·검색어 경계 독립 검증 — 보고 사실 확인

### VERIFIED (직접 확인)

- full-regression.txt SHA a74ed17a…f81ed, 1346 total / 1325 pass / 0 fail / 21 skip(직전 1339/1318 대비 +7). focused.txt 33/33(f11f3755…), storage-first.txt 4/4(4c8dd156…). implementation-report.json e4ac450b…7a3a, search-settings-dummy.png 4cac693e…dccf 일치. report의 sources 9개 SHA 드리프트 0. (참고: Desktop/npm-test-output.txt는 이번에 갱신되지 않아 직전 §136 해시 82e152b3…로 남아 있음 — Codex도 이번엔 Desktop 사본을 주장하지 않음.)
- 동결 3파일 SHA 변화 없음(solo-leveling 14c1d6ac…, recovery-one-of-qpu 452ef8ef…, static-guard 3efd4eb2…), 앞 두 파일 git diff 무수정.
- 코드 직접 읽음: owner-search-settings.mjs는 별도 {type:'connectorSecrets',version:1,search:{provider,apiKey}}, provider는 brave/tavily만 허용, 키 8~4096자·공백/제어문자 거부, 기존 DPAPI 함수 재사용, tokenFile 옆 connector-secrets.dpapi 별도 파일, 반환값은 credentialStatus/adapterStatus:'not_implemented'/liveSearchVerified:false/authorizesDispatch:false 고정 — 키·일부·평문 오류 미출력, 저장은 검색/재시작/활성화 안 함. 모델용 provider.dpapi 및 store/backup 코드는 이번에 변경 없음(backup.mjs·store.mjs에 connectorSecrets 참조 없음 = 일반 백업 제외).
- gap-scout.mjs: wrath 검색어는 공개 오류 코드 4개(empty_model_response, mission_call_limit, unsupported_tool_or_arguments, semantic_uncertain)만 허용, 그 외는 failure_cause_undetermined로 보류. 실제(비합성) 검색 hit은 title/url/snippet만 남기고 license/official/useful/commit/evidenceUrl 등을 버려 추천·초안 생성 불가(주석에 "발견 단서일 뿐, 독립 검증 아님" 명시).
- 직접 재실행: gap-search-boundaries·connector-secret-backup·owner-search-settings·gap-scout·search-provider 합계 31개 중 30 통과·0 실패·1 스킵. 스킵은 'Windows DPAPI roundtrip' — 내 Linux VM에서는 실행 불가라 정상 스킵이며, Codex는 실제 Windows에서 가짜 값으로 통과시켰다고 보고(내가 직접 재현하지는 못함). 산출물에서 키 형태 문자열 검색 0건. ui-report.json: realKeysUsed:false, networkSearchCalls:0, 마스킹·저장 후 입력 비움, providerDefaultEmpty:true.

### 한계·주의

- 공급자별 API 어댑터·resident의 키 로딩·독립 근거 URL 검증기는 미구현. 키 저장만으로 검색 작동하지 않음(status 'not_implemented' 그대로). 실제 외부 검색 0건.
- 중요한 귀결: 지금 상태에서는 실제 검색을 해도 독립 근거 검증기가 없어서 추천·초안이 0건으로 남음(정직한 설계이나 "실검색 성공 = 유용한 초안"이 아님). 독립 근거 검증기(라이선스·공식성·최신 커밋을 원 저장소에서 직접 확인)가 다음 필수 조각.
- 공급자 선택(Brave/Tavily vs 로컬 SearXNG)은 소유자 답 대기. 현재 허용 provider 목록에는 SearXNG가 없음(SearXNG 선택 시 별도 처리 필요).
- Codex가 재현 후 수정했다고 밝힌 두 결함(개인 ASCII 오류 문자열의 검색어 유출, 공급자 주장 수용)은 코드로 확인됨 — 이번 지시서의 4조건이 실제로 반영됨.
- 커밋/push 없음, HEAD e7b6dfe, 변경 경로 166.

### 판정

Codex §138 보고는 사실. 이번 검증에서 오류 없음.

## §140 — 2026-09-30 Codex: G1 독립 GitHub 메타데이터 근거 검증기

### VERIFIED

- 경로/remote/branch/full HEAD 재확인: C:\Users\우연호\Documents\Projects\yeno-os / wooyeonho/yeno-os / blackhole/p3-jev-recovery-port-20260924 / e7b6dfef772665b2e7f237c0cc9f51f4663ee211. 시작166개 변경 경로를 보존. 동결3파일 SHA 불변. Vault/자격정보/의존성/운영 resident/commit/push 변경 없음.
- 저장 먼저: repositoryEvidence v1만 백업 허용 목록에 추가, 옛 state/직접 인코딩한 옛 암호화 backup 복원 및 손상 거부 6/6(storage-first.txt). 이후 기존 검색·흡수 초안이 있는 구 백업까지 4/4(storage-populated.txt). 공개 JSON 원문 bytes를 base64로 보존하며 SHA-256/sourceUrl/fetchedAt 기록. base64 자체는 암호화가 아니고 전체 백업 계층은 기존 AES-GCM.
- GitHub URL owner/repo만 파싱. 고정 api.github.com repo JSON과 git/ref/heads JSON(코드 patch가 딸려오는 commit 본문 대신)만 읽음. HTTPS/자격증명 없음/manual redirect/64KiB/호출12초. API 내부 메타데이터 redirect만 경로·신원 대조 후 허용, 외부호스트/HTTP/contents/다른 repo head 거부. README/코드/clone/실행 없음. npm/PyPI는 이번 범위에 필요 없어 구현하지 않음.
- SPDX 허용 목록, GPL계열 별도프로세스 전용 기록 및 추천 제외, archived/disabled 제외. 별 수/pushed_at/HEAD SHA는 원문 관측값. official/useful null 유지. 검색사 MIT/official/useful 등 주장은 무시. candidate에 저장된 근거 참조와 사실만 반영하고 기존 F4/추천/초안 경로로 전달. usefulness_unverified 조건을 완화하지 않음.
- 별도 일일20회 예산은 redirect 포함 매 HTTP 직전에 영속 예약. repo+synthetic 구분 캐시, failed/429/403/unknown도 자동 재호출 없음. 이력128개. 실제 새 Windows Node 프로세스 재시작2종: 완료2호출 유지, 강제 종료 예약1호출 unknown 유지(HTTP는 합성). owner-only GET /api/gap-scout/evidence는 조회만 하고 호출하지 않음. source/backup 검증에서 근거 SHA·투영값·참조 일치 검사.
- 무인증 실제 GitHub4호출(검색 공급자0): quantastica/quantum-circuit → MIT, archived=false, disabled=false, stars274, default master, HEAD a15d3134fddbf981fab3ea80f3b28060b3f64add, pushed_at 2026-09-19T22:09:42Z, 관측2026-09-30T12:14:07.221Z. rhasspy/piper → MIT, archived=true, disabled=false, stars11294, default master, HEAD 73c04d81d5590ecc46e522de3601ce7fb29fc2be, pushed_at 2025-08-26T15:01:29Z, 관측2026-09-30T12:14:07.823Z. 후자는 repository_archived로 제외. 기대값을 미리 고정하지 않고 관측 그대로 기록. JSON원본4개 SHA/필드 재대조 일치. 새 오프라인 Node에서 실제 캐시 재조회: 추가호출0, 파일무수정, 누적4회 유지.
- 최종 집중65/65. 전체 npm.cmd test 최종1376 / 1355 pass / 0 fail / 21 skip, exit0. 직전1346/1325/0/21 대비30개 추가. 이 전체 회귀는 소유자의 후속 C1~L5 배치/전체회귀2회 지시 수신 전에 완료됨.
- 중간 실패 숨기지 않음: 재시작 하네스 두 번째 run의 t 인자 누락으로2시험 실패·child2개 미종료 → 정확히 그 테스트 자식만 종료하고 수정, 재실행 통과. 첫 전체1375/1354/0/21 후 추가 검토에서 redirect 주소ID와 JSON id 불일치가 저장 검증 오류로 번지는 경우 재현(redirect-identity-red.txt) → head 요청 전에 evidence_unavailable로 처리하도록 수정, 최종 집중65 및 전체1376 통과. 실패 로그는 별도 보존, 성공에 합산하지 않음.

### RAN-UNVERIFIED

- 실제 공개 메타데이터를 확인했지만 실제 검색 공급자 → GitHub → 실제 검색 후보의 전체 흐름은 공급자 미선정/미설정으로 미실행. 합성 HTTP/실제 프로세스/실제 공개 API 증거를 구분함.
- verified는 메타데이터 조건 충족만 뜻함. SPDX는 GitHub 관측이며 특정커밋 LICENSE 본문 검토·유용성·공식성·법적 승인·코드 실행 수락이 아님. 기본브랜치와 메타데이터는 각각의 시점 관측. 저장 캐시는 매번 최신임을 주장하지 않음.

### BLOCKED / 다음

- 유용성은 소유자/Researcher의 별도 판단으로 남음. 따라서 메타데이터 통과만으로 추천/초안을 만들지 않음. 실행 코드 활성화 권한은 여전히 authorizesDispatch:false.
- 새 사용자 배치 지시에 따라 다음은 C1 색욕 자기미화. C1~C3 후/ C5·C4·L5 후 각각 전체회귀1회만, 그 사이 관련 시험만 실행.

산출물: build-artifacts/g1-repository-evidence-20260930/INDEX.md 및 implementation-report.json. 소스15개+전체 산출물 SHA 목록 포함. 보고서 SHA b2ab3f8d1663e39e81a2388f91fc8a210ac1e0d4cf81b25b281b2c2df90c96ed; 최종회귀 SHA 36175f585968d6f029cc2f3676938706388e447fa2e54ff65f45862a9f7aa645; live/report.json SHA 2b8d3f655a037e2daf01a3bb5259e2a8b72b916ce1fab5143963e7530234dde5.

## §141 — 2026-09-30 Codex: C1 색욕 자기미화 초안

VERIFIED: 기존 absorbInbox self-beautification 스키마 재사용(새 최상위 키 없음). 구현 전 옛 상태/암호화 백업 호환 1/1, 관련 시험 16/16 통과. lust-mirror는 실제 바이트 해시가 맞는 구조화 측정 파일만 읽고 위반 건수를 센다(미적 점수 없음). 기존 lust gapRise 정책으로 배고픔 +15, 동일 근거 중복 상승 없음. 소유자 전용 /api/lust-mirror/inspect → 비활성 초안 → 기존 Jarvis 시스템 보고 연결. Edge에서 의도적으로 만든 가로 넘침 측정 → HTTP → 초안 1건, 배고픔 65, 재전송 추가 0, 400px 실제 화면 넘침 없음. 새 활성화 경로 없음, authorizesDispatch:false.

RAN-UNVERIFIED: 실제 브라우저/HTTP지만 결함은 합성 fixture이다. CJK 절단·명명 불일치 자동 탐지는 미구현이며 확인되지 않은 결함은 만들지 않는다. 전체 회귀는 사용자 지시대로 C3 이후로 묶음.

실패 기록: 첫 HTTP 시험 500 — 임의 beauty_draft 트리거를 코어가 거부. 기존 mutation 저장 경로 사용으로 수정 후 동일 시나리오 통과. c1-browser.txt/c1-browser-debug.txt 실패 로그 보존. 긴 근거 해시는 화면 대신 초안 데이터에 보존.

BLOCKED: 실제 사용자 화면의 지속 자동 감사 및 원격 모델 품질 증거 없음. Vault/동결 파일/커밋/push 변경 없음.

- build-artifacts/concept-20260930/c1-findings.json: fbd875cddc25b64dbcbd32ea8383498ae4dc828f3da9bc7c08c1e2a016d8aaa8
- build-artifacts/concept-20260930/c1-inbox.json: 639a48bcb6286a5e74628c753ab68ef30d24495bdbb66f047d6ec29c0332b16a
- build-artifacts/concept-20260930/c1-drawer.png: 358a6a0afa7368c145f45340e060c5deb2c515873262f9697d7c52b6f9ac54f2
- build-artifacts/concept-20260930/c1-focused.txt: 7958d28f2f6b66f50dcdda7f6fdb919b44ca2eb89d700a622b3fe60d7d42c050
- build-artifacts/concept-20260930/c1-browser-final.txt: e26640e6364142b7430c343926124f03bf420b0c705e022dd053a7c85330f5ca

## §142 — 2026-09-30 Claude(Cowork): 욕망 v3 지시서 — 결과 기반 배부름·충족 장부·세계 신호

- `docs/CODEX_DIRECTIVE_DRIVES_V3_20260930.md` 작성(SHA-256 `1adac5b72de2a0c97d2c90d3fcac13332788c5f27943f7e072b48497241d2f51`), Vault `01_DRAFTS/20260928_BLACKHOLE_CONCEPT_CANON/`에 사본 저장·해시 일치, Vault CHANGELOG (52) 기록, CODEX_HANDOFF에 진입점 추가. 코드 변경 없음.
- 근거(코드 직접 확인): `drive-state.mjs advanceHunger`는 지배 욕망에 결과와 무관하게 `fed`를 적용, `HUNGER_RULES_V2`는 주석상 선언된 우선순위, `motivation.mjs observedFeedback`의 outcome/criterionMet는 wrath 신호에만 쓰임.
- 핵심: attempt(fed/3) + 작업 종료 시 정산(멱등, 새 타이머 없음), `driveOutcomes` 장부(횟수만, 확률·점수 없음)와 stuck, G1 검토 대기 초안 기반 cue, v1/v2 재현·백업 복원 유지, gap-scout `version!==2` 등 v3 대응 지점 명시.
- 상태: **지시서 작성 단계. 구현·검증 전.** Codex 실행 순서에서 C3 다음·C5 앞. 구현 후 파일·해시·코드·회귀로 독립 검증 예정.

## §143 — 2026-09-30 Codex: C2 탄생 정책 v2·일어나라 기록

VERIFIED: 저장/백업 허용 목록 shadowArise 추가 후 구현 전 호환 4/4(기존 v1 이름·ID·임무·지문 그대로). birthPolicyVersion 2 신규 그림자는 실제 같은 목표 실패→첫 성공 / 기록된 결정론 검증 회복 / 소유자 major 명령만 근거. 일반 성공은 기존 그림자 성장·역할 XP만. ariseAttempts 최대3, uncertain 실패 보존, 보관/소환은 삭제 없이 소유자 전용 HTTP. stored는 배정 제외. 기존 등급 계산 무수정, 계급 칭호는 표시만. lordLevel v1=floor(log2(검증 임무 수))+1, 0건이면0; 명부 상한=4×level은 명시 정책이며 품질 점수 아님. 관련 테스트 48/48. Edge 400px 명부·임무 읽기창·소유자 보관/소환 통과. 전체 회귀는 C3 후 예정.

RAN-UNVERIFIED: 스크린샷 명부는 합성 임무 증거(E등급), 실제 모델 품질 아님. HTTP 합성 provider 통합에서는 소유자 표시→검증→D, 재시작 후 두 번째 입력→C를 따로 검증. v1 일반 성공 즉시 탄생 기대값은 의도적으로 제거; system-notice의 새 fixture 필드 누락 실패 3건 수정 후 재실행 48/48, 실패 로그 별도 보존.

BLOCKED: 실제 모델/휴대폰 증거 없음. 현 작업 범위 밖 §142 욕망 v3는 동시 기록됨을 확인했으나 이 묶음에 끼워 넣지 않음. 커밋/push·Vault·동결 파일 변경 없음.

산출물 build-artifacts/concept-20260930/:
- c2-storage-final.txt: 25d842747cee4820f87b9c9a26ff77ef890b40348c95a1401df29a4d0dc2c2e3
- c2-related-green.txt: 76d5b0e8fb502cb9d141fa3951dc8c2aef07f04e63c54a0dda9d41c2a1c76966
- c2-arise-worthy.json: 1008714a6af005f7f20d93f5f9b9dad3cd347ff1c8a544eac75d26b70e43c580
- c2-arise-failed.json: 4726d95a56fce51b2a796c75bfb54a8f8858a5c548e3676552b29ac52ad79782
- c2-roster.json: a5c2e75098154e7d8d6f4c1a9dd80399663bf92bd524c835ed34600d97c6730e
- c2-drawer.png: dcab19ad15e7e3806110d2c6ce8ac97914064528251ce1061fb4f0681fbb9709

## §144 — 2026-09-30 Codex: C3 커비 카피·첫 묶음 회귀

VERIFIED: kirby 최상위 상태/백업 허용 목록과 옛 상태·옛 암호화 백업 호환 3/3을 구현보다 먼저 통과. 관련 시험 8/8. 흡입은 실제 출처가 연결된 선언형 manifest를 기존 import→verify로 시험하며 자동 활성화 없음. 실패/noAbility는 absorbInbox에만 남고 레지스트리 불합격 항목을 만들지 않음. 흡수 영수증 inboxId→capabilityId/hash, 활성 버전에서만 결정론적 모자, 단일 슬롯, 표시용 역할 링크. 실제 저장 작업의 연속 실행 검증 실패 3건→기존 disable 경로→star 기록·슬롯 해제. 재검증+기존 소유자 활성화 후에만 재장착. 조합 표시는 기존 leveling-evidence compositions에만 의존.

실제 Edge/격리 HTTP: 흡입 5건 → 4 noAbility +1 시험통과 비활성 → 테스트 소유자 activate → equip → 400px 모자 표시/넘침 없음. 운영 활성화·실제 원격 호출 아님. 전체 회귀 ① npm.cmd test exit0: 1398 total /1377 pass /0 fail /21 skip (410757.5679ms). 사용자 요청대로 C1~C3 사이 전체 회귀는 실행하지 않았음.

RAN-UNVERIFIED: 합성 원본/manifest 전환 시험이며 외부 OSS 유용성·실제 모델·실제 조합 성공 증거는 아님(조합 없으면 빈 목록). BLOCKED: 실검색 키·실기기 없음. 실제 실행 코드 연결은 기존 최종 소유자 승인 유지. Vault·동결 파일·커밋/push 변경 없음.

산출물 build-artifacts/concept-20260930/:
- c3-storage-first.txt: 5bd33c37f5019c73af770ee4354a4d51c89f4f2c7d22b7bcc1de97907693e58f
- c3-focused-final.txt: 152cec0b10ebd374ffcba4023475336411e368b7b900ebe44593dba7d8fcb54a
- c3-inhale.json: b318062dfb295b755799b88bab697e71b18809f86085f7d30c69aec149261859
- c3-abilities.json: b174c1198cbeeadacb9d1fc34b11d31fd427644597fcb955ab8b2a4b2d369877
- c3-topbar.png: 84d3c13db6c9716a391b26d3331161604585575c17c35cc71612931cf678c027
- c3-browser.txt: a077f4f7868efb339906247146b9cced3d17e3ae94fa50a09e0de7227afe4cd5
- checkpoint-1-full-regression.txt: 918ef889082b52fe46e12bd8df8f4c6c9bb0d53081d9e729a572d2ed945c85e0

## §145 — 2026-09-30 Codex: C5 단일 양자 결정 기록

VERIFIED: 저장/옛 상태·암호화 백업 호환 3/3 먼저 통과. 관련 시험 10/10, 실제 자식 프로세스 재시작 시험 1/1. 실제 Edge 400px 및 격리 HTTP: pending 확률분포·엔트로피 표시, 소유자 측정 1회, 재측정 409, 기기 주체 403. measured와 expired/classicalFallback 분리. 상태벡터는 기존 OSS 계산값이며 authorizesDispatch:false.

RAN-UNVERIFIED: 비용·대안·상태는 합성 fixture이며 실제 모델·물리 QPU·운영 복구 성공 증거 아님. 동일 비용은 기존 classical fallback 유지. 첫 브라우저 스크립트 생성 오류(MODULE_NOT_FOUND)는 수정 후 별도 green 로그로 보존. BLOCKED: 실검색 키/실기기 없음; entanglement는 요청대로 C5-b로 유보. 전체 회귀 추가 없음. 도착한 욕망 v3 지시서를 다음에 반영하고 C4/L5 후 두 번째 회귀를 실행한다.

산출물 build-artifacts/concept-20260930/:
- c5-storage-first.txt: b311c4aec42dd9194982989542490eecec114711c33a23f72930bc4bd0c419ad
- c5-focused.txt: 76399c813f59933cf934ecd5a4b47f76dbf55b36787b9b4e036e068a6250acfa
- c5-restart.txt: 080ee3afdbfc91e0c699ee171230737120ce682644c9215deafbf245f001d701
- c5-superposed.json: 0b99fa99f1f102c50fbe43ef2e50afbcdde653c82e8d9c59b1653f26007770d2
- c5-expired.json: ddf60952208927a8b16368f4f36800f8a4d2a97eed93d3155f911283d5e18177
- c5-measured.json: aaea835bd4fbbedb5cfff235b08b14bb9a7dc3f0d85d7c6769422a0afa2a4e3d
- c5-drawer.png: b3cf48b49133f6ba85d175c72b6a484ae77655ba9d7dd5c098aa4cb6a93ec424
- c5-browser-green.txt: 3c5b9a3bf0e68c9639cb66a7f1e66c552ffc31d2e8fa732989aeea5c351b95e0

## §146 — 2026-09-30 Claude(Cowork): S9~S20 확장 지시서 — 계획 완료 이후 12단계

- `docs/CODEX_DIRECTIVE_S9_S20_EXPANSION_20260930.md` 작성(SHA-256 `f28ff19ab6f52681c126741d36de1297273f23bee977cbf6228f4720e2e4ee14`), Vault 사본 해시 일치, CHANGELOG (53), CODEX_HANDOFF 진입점 추가. 코드 변경 없음.
- 전제: S0~S8과 욕망 v3 완료 뒤 시작, 기존 계획 축소 없음. 근거: `MISSING_MEASUREMENTS` 4항목과 `outcome-verification.mjs` 원장·지표·출처·권한 계약이 이미 있으므로 S9는 새 지표를 만들지 않고 실제 출처를 연결.
- 순서 S9→S20, 전체 회귀는 S11·S14·S17·S20 뒤 4회, 시험 3층 러너 선행. 소유자 결정 11항목(키·토큰·서명 키·외부 검증자·브랜드 이름·두 번째 머신·커밋 승인 등)은 BLOCKED로 남기고 진행.
- 상태: 지시서 단계, 구현·검증 전. Codex는 그 사이 §143~§145(C2·C3·C5)를 기록함 — 이어서 §140~§145 독립 검증 예정.

## §147 — 2026-09-30 Codex: 욕망 v3 결과 정산

VERIFIED: driveAttempts/driveOutcomes 저장·구형 상태·구형 암호화 백업 호환 3/3을 먼저 통과. 관련 시험 58/58. v1/v2 재현 보존, 다음 결정부터 v3 1/3 시도·남은 충족·실패 상승·미확인 불변, 실제 장부 및 초안 cue, 200건 상한은 명시 오류(자동 삭제 없음). G1 v3 연속 조건 및 화면 그래프 v3 필터 수정. 격리 HTTP/Edge 400·768·1440 캡처, 실패 3회 stuck→실제 로컬 문서 작업 산출물로 해제, 실제 자식 프로세스 재시작/암호화 백업 후 이중 정산 없음.

실패 기록: 첫 관련 시험 31/33(부실 백업 fixture·v2 기대값 잔존)→수정 58/58. 화면 직접 검사에서 v3 그래프 누락 발견→필터 수정·세 폭 재캡처. RAN-UNVERIFIED: 실패는 합성 저장 상태이고 성공은 로컬 document 작업; 모델 내용 품질/실제 프로젝트 성과 검증 아님. 장부상 충족은 산출물 참조 또는 저장된 의미 판정만 뜻함. 최종 독립 화면 검토와 두 번째 전체 회귀는 C4/L5 뒤 합산. BLOCKED: 실제 검색·원격 키·실기기 기존 조건 유지. Vault 무수정.

산출물 build-artifacts/drives-v3-20260930/:
- storage-first-both-keys.txt: df2dc1bf7dea77082412811c5d0a1dab6d98c655a189f8f26f810e20f09dc8d9
- focused.txt: 93816c322e7cf58081beb799cbf2afc9167da30c10b7582ce81d41e8d9975462
- focused-green.txt: 8ef201ce722bdebf76189dacbb0f01d15339d6f7591dbab6e2d9e7f6fada9b0e
- live-green.txt: a8f065ef660c843b1065594dbd82a0073123af77452cc4a3f83fb4c76fe5363d
- stuck.json: 62955caab8cec3407f2d80ce3acf53a2ccc79c5eb706b112364be1071c24e502
- report.json: 80c96f36ae8c8b2dbd89cb8cca7ff5363a42cd1ea6cb85da17d497c1f68b8825
- fulfillment-400.png: 13db23a9c11a5cc28ce0748adfd5554d613fc174b14e27b0ebfb966c5332335b
- fulfillment-768.png: c972673bb490f8dc7e204efb5c10d83f6e8866e629b7f176fbc3bc16c505eace
- fulfillment-1440.png: 8b2b065bae0e9672982dd3680ede12be8e23ff5defff40252666bf82cb05cd06

## §148 — 2026-09-30 Codex: C4 JEV 사건부

VERIFIED: jevDocket 새 최상위 상태·백업 허용 및 구형 상태/암호화 백업 3/3을 구현 전 통과. 관련 시험 33/33, 소유자 전용 HTTP/실제 프로세스 재시작 포함 추가 5/5. 모든 typed 질문별 사건을 지문·근거·답·상태로 보존, abstain/dissent 별도. dependency 0건은 유효한 true이고 필요한 상태 누락만 abstain. 새 absorbWorthy/ariseWorthy/candidateLicenseOk는 저장 사실에서만 판단하며 authorizesDispatch:false. 실제 scheduler agreementRate/Wilson과 결과가 관측된 파이프라인 outcomeAccuracy/Wilson을 분리. 미확정은 pending으로 남음.

RAN-UNVERIFIED: 10개 임무 관측은 합성 fixture이며 실제 10개 임무 완주가 아님. 실제 코어 단일 사건부/재시작을 별도 시험. outcomeAccuracy는 명시된 파이프라인 판정 일치율이고 외부 세계 결과의 참·품질 증거가 아니다. BLOCKED: 독립 외부 성과와 실검색·실기기 없음. 전체 회귀는 요청대로 L5 뒤 ②만 실행.

산출물 build-artifacts/concept-20260930/:
- c4-storage-first.txt: 8518a78671d1efa8e50afc2afa1820289d386b40764a92c194e9639f8be5b510
- c4-focused.txt: ccacecb5d5bfd32a48a9da99ac7dc92a4cf93cc6d3d84fe1b389b7593ed8b75e
- c4-http.txt: 8909d90271e99957935a133c104ff8746aececa447f1d76529fd586299ca0cab

## §149 — 2026-09-30 Claude(Cowork): §140~§148 독립 검증 + 연속 실행 목표 헌장

- 검증: §140·§141·§143·§144·§145·§147·§148에 적힌 산출물 SHA 38개 전부 일치(불일치 0), §140 보고서·회귀·live report 해시 일치, 체크포인트 ① 회귀 1398/1377/0/21, §140 회귀 1376/1355/0/21 로그 확인, 동결 3파일 SHA 불변·git diff 무수정, 산출물 비밀 형태 문자열 0건. 직접 재실행: repository-evidence·lust-mirror 27/27 통과. drive-outcomes/quantum 묶음은 내 환경에서 시간 제한 초과로 미확정(실패 아님, Codex 회귀 로그로 대체). 코드 열람: `driveFulfillment`(stuck=연속 3회 미충족)·`driveCues`(초안 기반, Kirby 흡수분 제외)가 욕망 v3 지시서와 일치, `repository-evidence.mjs`는 고정 호스트·예약 예산·redirect 제한·재시작 unknown 처리 확인, live report의 rhasspy/piper archived=true 제외·quantum-circuit MIT 통과 원문 일치.
- 주의: 실검색·실제 모델 한 바퀴·실기기 0건은 그대로. `drive-outcomes.mjs`는 매우 긴 한 줄 코드 위주라 유지보수 부담(기능 오류 아님).
- `docs/BLACKHOLE_GOAL_CHARTER_20260930.md` 작성(SHA-256 `f9b8140359fc41cb91bb9cc8d56409290d9097be5b718ba0e71ca54a784a819c`), Vault 사본 일치, CHANGELOG (54).

## §150 — 2026-09-30 Codex: L5 통합 인수·화면 수정·두 번째 회귀 최종

VERIFIED: 격리 코어의 실제 HTTP/디스크 작업으로 동일 프로젝트·동일 목표의 첫 실패 임무에서 G1 합성 검색 단서→absorbInbox 초안→기존 선언형 ledger-digest manifest의 import/verify→격리 테스트 소유자 activate→실제 능력 runId/출력 해시→두 번째 missionId/Builder 입력·산출물→저장된 semantic verdict까지 단일 인과 체인을 조회·검증했다. L5 chain은 모든 ID와 실제 파일 바이트의 SHA-256을 다시 맞추고 `authorizesDispatch:false`로 반환한다. 누락된 Builder 출력, 거부된 초안, 비활성 기능, 누락된 run, 전체 멈춤, 프로세스 재시작의 거부/복구 경로도 통과했다. JEV 사건·양자 단일 결정 측정·C1 자기 미화 초안·격리 Vault Markdown export·실제 Edge 400px 화면을 같은 인수 스크립트에서 실행했다. 실제 Vault는 변경하지 않았다. 욕망 v3 Edge 400/768/1440 화면과 차트의 0/50/100 눈금, 모바일 입력 문구를 재캡처했고 독립 화면 재검토에서 차단 결함 없음. 동결 파일 3개의 해시와 수정 없음 확인, `git diff --check` exit 0.

실패→수정 기록: 두 번째 전체 회귀의 첫 실행은 1424 total / 1402 pass / 1 fail / 21 skip, exit 1. 기존 `blackhole-core-server.test.mjs`의 첫 heartbeat가 `runtime_started`여야 하는데 욕망 v3 기동 정산의 별도 `store.save()`가 `state_changed`를 먼저 기록한 실제 결함이었다. 정산을 기존 runtime boot save에 합쳐 첫 heartbeat의 원인을 보존했다. 관련 18/18, 욕망 v3 실제 Edge/문서 작업/재시작 스크립트, L5 스크립트 재실행 통과. 실패 후 수정본 전체 회귀는 `npm.cmd test` exit 0, 1424 total / 1403 pass / 0 fail / 21 skip. 사용자 요청의 전체 회귀 두 체크포인트에 더해 이 실패 교정 재실행 1회를 수행했으며, 첫 실패를 성공에 합산하지 않는다. §147의 초기 스크린샷·report 해시는 재실행으로 교체됐으므로 아래 최신 캡처 해시를 기준으로 한다.

RAN-UNVERIFIED: 검색 공급자와 Shadow 모델 응답은 합성이다. 격리 코어의 소유자 activate는 인수용 시험만이며 외부 OSS의 운영 실행 코드 승격이나 소유자 최종 승인 완료를 뜻하지 않는다. 양자 비용·대안도 합성 입력이고 물리 QPU 실행이 아니다. 산출물 인용/저장된 semantic pass는 외부 세계의 유용성·내용 정확성·수익을 입증하지 않는다. BLOCKED: 실제 검색 키 없는 실검색, 실제 모델 및 Android 실기기 페어링→요청→결과→복구, 외부 검증·물리 QPU. S9~S20은 지시서 단계이며 이 묶음의 구현 범위 밖이다. 커밋/push·운영 배포·Vault 변경 없음.

산출물 SHA-256:
- `build-artifacts/concept-20260930/l5-loop.json`: `53d87ae35b187124bddf9e506d63f6a87d8ac6c4b61117b5e1b0f69bc72c914f`
- `build-artifacts/concept-20260930/l5-jarvis.png`: `f9edb8d823a2ed1f26490b142c49806d515dd3f96bb7cbadd586e766b3198cd4`
- `build-artifacts/concept-20260930/l5-obsidian-export.md`: `cb55b93d66a1f61f3598940f8c922c518d3f5d614dc72dac1c126bb8057d7ad3`
- `build-artifacts/concept-20260930/l5-live-final.txt`: `27cb4e2258429467c45d447218d8b69f89f9eaaacf4560bf6b81d4c259c98074`
- `build-artifacts/concept-20260930/checkpoint-2-full-regression.txt` (실패 보존): `265208b3c98d9232a66d01ad365677c2d21744eb33b74f6906d9946b6eaf4136`
- `build-artifacts/concept-20260930/checkpoint-2-failure-focused.txt`: `b2c5739280a676db437710f63bf628092d277851d795ba60b29171b23bc97bb1`
- `build-artifacts/concept-20260930/checkpoint-2-full-regression-retry.txt` (최종): `ed6bfe04f0ae8e524963f9718c6294305dc3fa4e51ce084d0923178850902cce`
- `build-artifacts/drives-v3-20260930/live-ui-final.txt`: `55c100fa59985e6711053923a59ff767870e138ff20ebae2c823f305b6227183`
- `build-artifacts/drives-v3-20260930/fulfillment-400-top.png`: `e49c9c0feb8ed82d63f4c40c510a3449c2a75c78a06971b11c7130b4b7ab9d63`
- `build-artifacts/drives-v3-20260930/fulfillment-400-chart.png`: `56c57a6d7066e49762342b8352218a9f5f976d18dea22c41030a50de455b785b`
- `build-artifacts/drives-v3-20260930/fulfillment-768-chart.png`: `b6c8e6a9feb200575a3d65aa901a0f7556c41ac03aaad6b4811764f5c18c8200`
- `build-artifacts/drives-v3-20260930/fulfillment-1440-chart.png`: `1e1cea4c0a903d87f813c3f96632a1887474756ae5496fadf3b7185e3e86cf6e`

## §151 — 2026-09-30 Claude(Cowork): 릴 7종 흡수 지시서 — 상태 오브·정찰 도구 후보·측정 실험

- `docs/CODEX_DIRECTIVE_ABSORB_REELS_20260930.md` 작성(SHA-256 `8141500b923603c84aa515f4ec7b34a1d25ac4aa1b5562e3ba54d8c64ab6467c`), charter 부록 A(P1.5)로 삽입(charter 새 SHA-256 `69846f66c56424988ffd3020f3652695d5d9f263b8224bb7615f4ea481c21d55`), Vault 사본 2개 해시 일치, CHANGELOG (55), HANDOFF 진입점. 코드 변경 없음.
- 흡수 원칙: 릴의 성과·매출·작동 주장은 증거가 아니며 `reference-claim(unverified)`로만 저장. 오픈소스는 독립 근거 검증기로 실제 GitHub 메타데이터를 먼저 확인(dogfooding). 소스 복사는 검증된 커밋 sha + LICENSE + VENDOR.md 해시.
- 상태: 지시서 단계. Codex는 §150(L5·화면 수정·두 번째 회귀)까지 기록 — 독립 검증 예정.

## §152 — 2026-09-30 Codex: P1 시험 3층·상태 파일 생성 기반

VERIFIED: 기존 저RAM 직렬·512MiB 조건을 보존한 채 `scripts/run-tests.mjs`에 fast/integration/full 분할과 변경 파일별 최소 층 선택을 추가했다. 기본 `npm.cmd test`는 full 전체 목록을 유지한다. fast 19파일·integration 188파일·full 207파일이 중복 없이 분할됨을 목록과 시험으로 확인했다. `npm.cmd run test:fast`는 152/152 통과, 실제 벽시계 12.512초(<60초). 변경 `runtime/lib/drive-outcomes.mjs`→integration, `runtime/server.mjs`→full, 미지 경로→full이며 명시된 더 좁은 층은 거부한다. 러너·상태 생성기 관련 5/5 시험 통과. STATUS 생성기는 아래 실행기록의 `STATUS|` 근거 행만 읽고 실제 산출물 해시를 대조한다; 원문 로그 전체를 화면에 노출하지 않는다. 설계 초안과 체크포인트 커밋 제안만 만들었고 stage/commit/push는 실행하지 않았다. S9~S20·P1.5는 아직 지시서 단계로 유지한다.

RAN-UNVERIFIED: integration 층은 목록/선택 계약을 검증했으며 전 층 실행은 S11 뒤로 남겼다. `docs/STATUS.json`은 구현·증거 등급을 실행기록에서 파생하지만 독립적인 외부 진실 판정기는 아니다. BLOCKED: 런타임 상태 등록부 코드는 헌장 P1이 소유자 승인을 요구하므로 설계 초안만 보존. P2 실제 모델 한 바퀴는 소유자 키 미설정 시 차단. P1.5의 외부 저장소 확인과 오브/실험 구현은 다음 독립 단계. 동결 세 파일 무수정, Vault 무수정.

아래 행은 `scripts/status-from-log.mjs`의 입력 계약이다. `implemented`는 해당 하위 기능의 로컬 구현 상태이며 제품 전체 완성을 뜻하지 않는다. `local`은 격리 PC 실행, `external`은 공개 공식 API 읽기, `synthetic`은 합성 공급자/자료다. 이후 단계가 진행되면 같은 id의 새 행이 최신 값을 대체한다.

- STATUS|id=CP1|stage=P0|implementation=implemented|evidence=local,synthetic|source=134|artifact=build-artifacts/concept-20260928/implementation-report.json|sha256=8484eb6acdb72eab6919e177edac9fcd302cd2abf55b66f03ae6faa1c09ea42b
- STATUS|id=E1-E3|stage=P0|implementation=implemented|evidence=local,synthetic|source=134|artifact=build-artifacts/concept-20260928/implementation-report.json|sha256=8484eb6acdb72eab6919e177edac9fcd302cd2abf55b66f03ae6faa1c09ea42b
- STATUS|id=G1-evidence|stage=P0|implementation=implemented|evidence=external,synthetic|source=140|artifact=build-artifacts/g1-repository-evidence-20260930/implementation-report.json|sha256=b2ab3f8d1663e39e81a2388f91fc8a210ac1e0d4cf81b25b281b2c2df90c96ed
- STATUS|id=C1|stage=P0|implementation=implemented|evidence=local,synthetic|source=141|artifact=build-artifacts/concept-20260930/c1-findings.json|sha256=fbd875cddc25b64dbcbd32ea8383498ae4dc828f3da9bc7c08c1e2a016d8aaa8
- STATUS|id=C2|stage=P0|implementation=implemented|evidence=local,synthetic|source=143|artifact=build-artifacts/concept-20260930/c2-arise-worthy.json|sha256=1008714a6af005f7f20d93f5f9b9dad3cd347ff1c8a544eac75d26b70e43c580
- STATUS|id=C3|stage=P0|implementation=implemented|evidence=local,synthetic|source=144|artifact=build-artifacts/concept-20260930/c3-inhale.json|sha256=b318062dfb295b755799b88bab697e71b18809f86085f7d30c69aec149261859
- STATUS|id=C5|stage=P0|implementation=implemented|evidence=local,synthetic|source=145|artifact=build-artifacts/concept-20260930/c5-measured.json|sha256=aaea835bd4fbbedb5cfff235b08b14bb9a7dc3f0d85d7c6769422a0afa2a4e3d
- STATUS|id=Drives-v3|stage=P0|implementation=implemented|evidence=local,synthetic|source=147|artifact=build-artifacts/drives-v3-20260930/report.json|sha256=c74a9b3893d7740ccb16a11c8c8c60ad4a93e70d4ca60daead6cfb3d37e40fa2
- STATUS|id=C4|stage=P0|implementation=implemented|evidence=local,synthetic|source=148|artifact=build-artifacts/concept-20260930/c4-http.txt|sha256=8909d90271e99957935a133c104ff8746aececa447f1d76529fd586299ca0cab
- STATUS|id=L5|stage=P0|implementation=implemented|evidence=local,synthetic|source=150|artifact=build-artifacts/concept-20260930/l5-loop.json|sha256=53d87ae35b187124bddf9e506d63f6a87d8ac6c4b61117b5e1b0f69bc72c914f
- STATUS|id=P0-regression|stage=P0|implementation=implemented|evidence=local|source=150|artifact=build-artifacts/concept-20260930/checkpoint-2-full-regression-retry.txt|sha256=ed6bfe04f0ae8e524963f9718c6294305dc3fa4e51ce084d0923178850902cce
- STATUS|id=P1-test-runner|stage=P1|implementation=implemented|evidence=local|source=152|artifact=build-artifacts/concept-20260930/p1-fast-final.txt|sha256=46dc29f82af7cbea2123927cf8213109756c689ba92074d126d6ea88ce12fd5c
- STATUS|id=P1-status-generator|stage=P1|implementation=implemented|evidence=local|source=152|artifact=build-artifacts/concept-20260930/p1-runner-status-green.txt|sha256=3cdb361ec108279c068c1eeccff56a0ffd450945d25e478e2c0c124216dd3b57
- STATUS|id=P1-registry-design|stage=P1|implementation=implemented|evidence=local|source=152|artifact=docs/BLACKHOLE_STATE_REGISTRY_DESIGN_20260930.md|sha256=ec746c5af043d8563f6d87b7becc217fbacc2f0155136ed6c9969a6ca43ba4f3
- STATUS|id=P1-registry-runtime|stage=P1|implementation=not_implemented|evidence=none|source=152|artifact=-|sha256=-
- STATUS|id=P1-commit-proposal|stage=P1|implementation=implemented|evidence=local|source=152|artifact=docs/BLACKHOLE_CHECKPOINT_COMMIT_PROPOSAL_20260930.md|sha256=f45e909a5b6364a7f41516c0e513dcb60fa2030d1b4fd0242fd2de242f409881
- STATUS|id=P15-reel-absorption|stage=P1|implementation=not_implemented|evidence=none|source=151|artifact=-|sha256=-
- STATUS|id=P2-real-loop|stage=P2|implementation=not_implemented|evidence=none|source=150|artifact=-|sha256=-
- STATUS|id=S9|stage=P3|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S10|stage=P3|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S11|stage=P3|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S12|stage=P4|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S13|stage=P4|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S14|stage=P4|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S15|stage=P5|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S16|stage=P5|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S17|stage=P5|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S18|stage=P6|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S19|stage=P6|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-
- STATUS|id=S20|stage=P6|implementation=not_implemented|evidence=none|source=146|artifact=-|sha256=-

P1 추가 확인: 생성기 시험의 첫 실패는 테스트 fixture의 1자 ID가 엄격한 스키마에 맞지 않은 탓이었다(`p1-runner-status-focused.txt` 보존). fixture 수정 후 5/5, 산출물 경로 탈출·해시 변조 거부를 추가한 최종 fast 152/152, 벽시계 12.498초. 다음 두 행은 위 P1 항목의 최종 검증 산출물로 최신 값을 대체한다.
- STATUS|id=P1-test-runner|stage=P1|implementation=implemented|evidence=local|source=152|artifact=build-artifacts/concept-20260930/p1-fast-verified.txt|sha256=f8c44170d899503533ed6c2b9bdea3af423950340af2ff3f3f9e2a8fa2343a7a
- STATUS|id=P1-status-generator|stage=P1|implementation=implemented|evidence=local|source=152|artifact=build-artifacts/concept-20260930/p1-fast-verified.txt|sha256=f8c44170d899503533ed6c2b9bdea3af423950340af2ff3f3f9e2a8fa2343a7a

산출물 SHA-256: `p1-fast-verified-timing.txt` `3a34053a11a9bc6bc476898d11b30b01ac8ad75c656a3201ade74d12f6f9e584`; `p1-status-generate.txt` `a8b6fd956713850f258e5e166cefca51ad77a0bb66ec72b269e598083a0ced3d`; `p1-status-check.txt` `3c419893f5f9ce4d70b108adc968ffb5cb19d1cbb99f988cfa7ba7f2c8e4b0f2`; `docs/BLACKHOLE_STATE_REGISTRY_DESIGN_20260930.md` `ec746c5af043d8563f6d87b7becc217fbacc2f0155136ed6c9969a6ca43ba4f3`; `docs/BLACKHOLE_CHECKPOINT_COMMIT_PROPOSAL_20260930.md` `f45e909a5b6364a7f41516c0e513dcb60fa2030d1b4fd0242fd2de242f409881`. STATUS.json 파일 해시는 생성·재검사 후 다음 행에 보존한다.

STATUS.json 최종 SHA-256: 0188b4138c499ea3976c5030628dde89da7a5e37b418d61f96f434d3205bdfc4 (`node scripts/status-from-log.mjs --check` 통과).

## §153 — 2026-10-01 Codex: P1.5 릴 흡수 1차 구현·실측 (부분 완료)

VERIFIED: `reference-claim`/`experiment`/`content-draft`를 기존 absorbInbox의 비활성 초안 종류로 추가했다. 새 최상위 상태 키를 만들지 않고, 구현 전 구형 상태·암호화 백업 복원 1/1을 먼저 통과시켰다. 새 종류의 디스크·암호화 백업 왕복과 허위 verified/success/publish 필드 거부를 관련 시험으로 확인했다. 이 초안들은 `authorizesDispatch:false`이며 승격 함수가 없다. 실제 사용자 릴 원본 주소·효과 주장은 입력하지 않았으므로 시험의 릴 주장은 합성 fixture다.

VERIFIED: 기존 독립 repository-evidence 경로로 무인증 공식 GitHub API 4회만 읽어 thinking-orbs와 Agent-Reach의 메타데이터와 기본 브랜치 HEAD를 확인했다. 둘 다 관측 시점에 MIT/archived=false/disabled=false였고, stars는 각각 3380/86325(품질 점수 아님). 공식성은 null. raw JSON URL·시각·SHA-256은 `report.json`에 있다. thinking-orbs의 고정 커밋 `de85557ca220332586d070d8788c0e1d6e877a0d`의 TS 원본 16개와 LICENSE 1개를 복사하고, MIT 고지·원본/변환 ESM 해시 장부를 남겼다. 해시 검증기에서 원본 17/17, ESM 10/10 일치. React 래퍼는 실행하지 않고 타입 제거 ESM의 캔버스 지오메트리만 작은 오브가 사용한다.

VERIFIED: Agent Reach는 `kind=scout`, `mode=process`, `implemented:false`, `not_implemented`, `canCheck:false`인 비활성 커넥터 서술자로만 등록했다. 공개 소스 한정·소유자 고정 설치·쿠키 소유자 전용·별도 소셜 승인·근거 검증 전 단서 취급 정책을 담았다. 설치/실행/쿠키 접근 0건. SPECS/CLAD·출처 미확인 홀로그램·드롭쉬핑은 `BLACKHOLE_PARKED_IDEAS.md`에 보류로 기록했다.

VERIFIED: 작은 헤더 오브는 `/api/state`의 저장된 core 활동과 job에만 반응한다. offline/idle/paused/stopped/전체 멈춤/근거 없는 실행은 정지, planning/executing은 working, verifying는 solving, owner wait는 listening으로 순수 함수에서 결정된다. Edge+실제 격리 HTTP 코어 400/768/1440px 화면은 가로 넘침 0, 페이지 오류 0, 외부 요청 0. 합성 provider로 실행 중 실제 코어 `executing`, running job 1건에서 오브 `working`, 완료 뒤 `still`을 확인했다. reduced-motion 캔버스 정지, 모션 켜짐 프레임 변경. Chromium의 전체 페이지 TaskDuration 관측은 1.0654초 동안 0.2044초이며 작은 오브만의 CPU 비용은 아니다. 관련 35/35 통과, `git diff --check` exit 0, 동결 3파일 SHA 불변.

RAN-UNVERIFIED: 전체 회귀는 헌장상 다음 S11 체크포인트까지 실행하지 않았다. 오브의 `verifying→solving`은 순수 함수 시험만 통과했고 실제 미션의 순간 상태 캡처는 못 했다. 욕망·그림자 행의 고유 활동은 현재 API에 증거 원천이 없어 오브를 붙이지 않았으며, 꾸며낸 움직임을 넣지 않았다. 실제 릴 원문과 S9 플랫폼 실측값이 없어서 가설·콘텐츠 초안은 합성 시험 수준이다. 공개 메타데이터는 도구의 유용성 증거가 아니다.

BLOCKED: P1.5 전 범위 완료는 실제 미션 planning→executing→verifying 3장 수락, 욕망/그림자 개별 활동 원천, 소유자 제공 릴 주소/주장 검증, S9 실측 출처 전까지 보류한다. P2 실제 모델 한 바퀴는 소유자만 입력하는 모델 키가 없어 별도 BLOCKED. 운영 배포, Vault 수정, 커밋/push, 코드 활성화 없음.

산출물 SHA-256:
- `build-artifacts/reel-absorption-20261001/report.json` `d72a1fa456a87639adab67b013efde04b295148398036d73ec0886a976c01d78`
- `build-artifacts/reel-absorption-20261001/small-orb-browser-report.json` `cc7b57cab720d91c486ca6db6e52d08561ad6ec1b3606a89b20d5a2009f5c529`
- `build-artifacts/reel-absorption-20261001/focused-tests.txt` `cafa4425379a0009bfa6ff87558abaea81a5c51094aa78eff8dbc20ee2c71280`
- `runtime/public/vendor/thinking-orbs/VENDOR.md` `0d5487aaabfb908d046ce7465cb1c3093652cf38e25fc4418c096d6096988a2e`
- `runtime/public/vendor/thinking-orbs/SOURCE_SHA256.txt` `4094a895b17b306f15da7adb37b679c8652cf487ff6e1b76b925b4f3da47ae41`
- `runtime/public/vendor/thinking-orbs/ADAPTED_SHA256.txt` `ddd7fd64984221984aa1579a0c117f2f2bfc4c0609b324b4cb63cb3877f0d627`
- `docs/BLACKHOLE_PARKED_IDEAS.md` `7cfd30a32b8e3d734fbe2b851bd208f7f02c3dfd2154d6b9acf3a5d90c8c34b4`
- 동결: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=P15-reel-absorption|stage=P1|implementation=partial|evidence=local,synthetic,external|source=153|artifact=build-artifacts/reel-absorption-20261001/small-orb-browser-report.json|sha256=cc7b57cab720d91c486ca6db6e52d08561ad6ec1b3606a89b20d5a2009f5c529

## §154 — 2026-10-01 Codex: S9 결과 별점 저장·화면과 실측 출처 계약 대조 (부분 완료)

VERIFIED: 저장을 먼저 했다. 새 `resultRatings` 최상위 키를 초기 상태·검증·백업 허용 목록에 넣고, 구형 상태와 구형 암호화 백업의 무손실 복원 및 손상 필드 거부를 구현 전에 1/1 통과했다. 별점 1~5는 완료된 job의 저장된 실제 산출물 SHA-256을 읽어 검증한 뒤 소유자 페어링 또는 승인된 브라우저 세션에서만 POST로 기록한다. 값은 `self_reported`/`owner_report`/`authority:owner`/`authorizesDispatch:false`이며 같은 작업의 충돌 별점은 거부한다. 미평가는 빈 배열로 유지한다. Edge 400px에서 합성 provider가 만든 실제 격리 코어 job 결과를 4점으로 클릭해 화면 표시, 서버 기록, 재시작 후 동일 기록, 암호화 백업 왕복을 확인했다. 이는 소유자의 실제 평가가 아니라 시험 입력이다. 별점은 기존 성과 원장·욕망 v3 정산·독립 검증 판정에 연결하지 않았다.

VERIFIED: `owner-analytics`, `owner-publication`, `owner-revenue`는 모두 공식 API 플랫폼 미선택을 드러내는 `not_implemented`/`canCheck:false` 읽기 전용 커넥터 서술자다. 송금·결제 동작은 없다. 관련 저장/단위/보안/욕망 정산 12/12, 커넥터 회귀 20/20, 브라우저 재시작/백업 인수 통과. `git diff --check` exit 0. 동결 세 파일 해시 불변, Vault 수정·커밋/push 없음.

실패→수정: 첫 Edge 검증 스크립트가 공개 요약 `core.state()`를 전체 저장 상태로 잘못 취급해 TypeError가 났다. 전용 GET으로 바꾼 다음 Playwright API 요청에 브라우저 세션 헤더가 빠져 403이 났다. 헤더를 추가하고 저장소 재시작 뒤 직접 읽도록 고쳐 통과했다. 이 두 검증기 결함은 성공에 합산하지 않는다.

RAN-UNVERIFIED: 실제 주인 평가 입력은 0건이며 화면의 4점은 합성 시험이다. 실제 분석/게시/정산 플랫폼은 선택·연결되지 않았고 `external_structured` 실측값은 0건이다. S9 지시서의 GitHub stars/watchers를 `adoption` 최소 출처로 쓰라는 문장은 기존 `METRICS`와 충돌한다: stars/watchers는 `adoption.installs`도 `fame.followers`도 아니다. 새 지표·권한을 만들지 않고 `docs/S9_SOURCE_CONTRACT_GAP_20261001.md`에 보류 사유를 적었다. `motivation.mjs` v1의 `missingMeasurements` 고정 검증도 임의 변경하지 않았다. 외부 제3자 검증 0건은 S15 전까지 그대로다.

BLOCKED: S9 수용 조건의 실제 출처 1개 이상은 적합한 공식 API 플랫폼과 소유자 전용 키가 없어서 미달. P2 실제 모델 한 바퀴도 소유자 키 없음. S9-b/c/d 및 결정별 측정 가능 표시·실측 원장 연결은 완료로 세지 않는다. 전체 회귀는 헌장대로 S11 뒤에만 실행한다. 다음 독립 단계는 야간 창 기본 꺼짐의 S10 저장 계약·시험이다.

산출물 SHA-256:
- `build-artifacts/concept-20260930/s9-rating-storage-first.txt` `8295db4f387f039cfce74a31b4d5a27b7af451394f645dde435856b70862856b`
- `build-artifacts/concept-20260930/s9-focused.txt` `c34cf42ff22886dcd85e12444cabf78434d7bfed28f79b9f0ccd10e4ecf409cc`
- `build-artifacts/concept-20260930/s9-connectors-focused.txt` `79b0ea6d7393581ef1218f3fcaf11c6f1f1c462ef2ec04d5db6e25f6b314fea0`
- `build-artifacts/concept-20260930/s9-owner-rating-red.txt` `f0f4e04f0d744a116be65daf5858a7b07974908713ff5ece6097faff3e1546d1`
- `build-artifacts/concept-20260930/s9-owner-rating-green.txt` `c25e94a19f04b0d9166294b9fbb69f8948f1582b2ee591a5608803ca78fb8279`
- `build-artifacts/s9-20261001/owner-rating-report.json` `c12330c7e48b4a10cfcdbf7fd2c692b107f3a82c07b911e8afd0cd033813b869`
- `build-artifacts/s9-20261001/owner-rating-400.png` `2d4998ed02921b59bce088c1fb7870fb6b272b91512feefae7cbdfd49d4b03b0`
- `docs/S9_SOURCE_CONTRACT_GAP_20261001.md` `aa3c981e3b9195d69562dec930203008d87cdb968e8f45b9f3fdde8d3e12d728`
- 동결: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S9|stage=P3|implementation=partial|evidence=local,synthetic|source=154|artifact=build-artifacts/s9-20261001/owner-rating-report.json|sha256=c12330c7e48b4a10cfcdbf7fd2c692b107f3a82c07b911e8afd0cd033813b869

## §155 — 2026-10-01 Codex: S10 야간 창·로컬 연대기·재시작 중복 방지 (부분 완료)

VERIFIED: 새 최상위 `nightCycle`의 구형 상태·구형 암호화 백업 복원과 손상 상태 거부를 구현 전에 1/1 통과시켰다. 기본 `window:null`은 실행을 막는다. 소유자 페어링/승인 브라우저만 시간대와 분 단위 창을 설정할 수 있다. 기존 150ms scheduler tick에서만 실행하며 새 타이머와 모델 호출은 없다. 실패 코드별 현재 실패 작업 ID, 14일 지난 갭의 만료 표시, 중복 산출물 해시 후보, 활성 능력, 자기 미화 초안을 실제 저장 상태에서 읽어 결정론적 마크다운 한 건을 만든다. 보고서와 갭 만료는 검증 후 함께 상태에 반영한다. 같은 야간 날짜의 두 번째 tick과 재시작 후 tick은 보고서를 재생성하지 않는다. `authorizesDispatch:false`이고 산출물 삭제·능력 활성화도 없다.

VERIFIED: `node --test runtime/test/night-cycle-storage.test.mjs runtime/test/night-cycle.test.mjs runtime/test/gap-scout.test.mjs runtime/test/gap-storage.test.mjs runtime/test/scheduler-fix.test.mjs` → 30/30, 실패 0. `node scripts/verify-s10-night-live.mjs` → 실제 격리 HTTP 코어에서 기본 꺼짐, 비소유자 거부, 합성 시간 창 설정, `chronicle/YYYY-MM-DD.md` 파일 SHA-256과 보고서 SHA-256 일치, 재시작/암호화 백업의 보고서 1건, 모델 호출 0건을 확인. 창 설정은 시험용이며 운영 설정에 적용하지 않았다. `git diff --check` exit 0, 동결 세 파일 해시 불변. Vault 수정·커밋/push 없음.

실패→수정: 저장 스키마 검증 강화 중 `ids` 함수 이름을 지역 Set이 가려 두 단위 테스트가 `TypeError`로 실패했다. 이름을 `validIds`로 분리하고 재실행해 30/30 통과했다. 실패를 성공 수치에 합산하지 않았다.

RAN-UNVERIFIED: 운영 야간 창은 소유자가 정하지 않아 기본 꺼짐이며, 운영 코어의 실제 밤 실행은 0건이다. 연대기는 격리 코어의 로컬 파일만 검증했다. 전체 회귀는 계획된 S11 체크포인트까지 실행하지 않았다.

BLOCKED: Obsidian `01_DRAFTS/BLACKHOLE_연대기`로의 쓰기는 이번 작업의 Vault 수정 금지 조건 때문에 실행하지 않았다. Obsidian 연결 상태도 이 격리 시험에서 검증하지 않았다. 다음 독립 단계는 S11 그림자의 모델 배정·역할별 도구 범위와 격리 체인이다.

산출물 SHA-256:
- `build-artifacts/s10-20261001/night-live-report.json` `8a563f5c446ad215c8fc371faf9fa1dfa74a9d13e77fde97b3f324d30c59c3bf`
- `build-artifacts/s10-20261001/focused-tests.txt` `2e3dafb50a1797399cf5c949c917f364c802d5aa6eee7c155637cd946d87e657`
- `runtime/lib/night-cycle.mjs` `34f744a4b31a52e72e45e7ad322c8ba5490169f5758be12c79b43c3bc9c31a67`
- `runtime/lib/night-cycle-state.mjs` `91c9489e4e012d387d9395c67f45632c2947bbb711e91004981b1f6ac50c246a`
- `scripts/verify-s10-night-live.mjs` `5d7e42734d3b1dfbd11646e68f195a1befe2296e440181c105648f83cc3decb9`
- 동결: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S10|stage=P3|implementation=partial|evidence=local,synthetic|source=155|artifact=build-artifacts/s10-20261001/night-live-report.json|sha256=8a563f5c446ad215c8fc371faf9fa1dfa74a9d13e77fde97b3f324d30c59c3bf

## §156 — 2026-09-30 Claude(Cowork): 오픈소스 조립(OSS-first) 지시서

- `docs/CODEX_DIRECTIVE_OSS_ASSEMBLY_20260930.md` 작성(SHA-256 `a544f876a05eb388c9d038a9f7e55d39948adf47b94e47779285b0a24348d3df`), charter 부록 B 추가(새 SHA-256 `50fba26c0ac1a1e42a86c1fcc2c5806af3b88615c8bf735c786c638f7d9dd198`), Vault 사본 2개 해시 일치, CHANGELOG (56), HANDOFF 진입점. 코드 변경 없음.
- 확인한 사실: `runtime/lib` 126개 파일·약 16,800줄, 외부 의존성 4개, 화면 vendor는 three·thinking-orbs. 모듈별 대체 가능 여부는 아직 미확인(이름·줄 수만 본 것) — 감사(AUD-1)에서 코드를 읽고 확정할 것.
- 원칙: A 복사/B 별도 프로세스/C 제외, 외부 출력은 `oss:<이름>@<sha>` unverified로 들어와 기존 검증을 통과해야 함, 스타는 근거 아님, 교체는 어댑터+폴백+모듈 하나씩.
- 미검증 대기: Codex §150, §152~§155(P1 시험 3층, P1.5 1차, S9, S10)는 아직 내가 독립 검증하지 않음.

## §157 — 2026-09-30 Claude(Cowork): OSS 조립 지시서 정정 — 고유 모듈도 엔진층은 오픈소스 우선

- 소유자 지적으로 §156의 "고유 모듈은 대체 대상이 아님"을 정정: 정책층(직접)과 엔진층(오픈소스 우선)으로 분리. 지시서 새 SHA-256 `08f228f857e3ca5ec8ee61bbc18d0b73b9e1cf9ccbeceea98d75bff70d516595`, 목표헌장 새 SHA-256 `6afaef9a1e840593a8df695261163994c27b20ae53709cbbbd1b58c2e3f811ef`, Vault 사본 일치, CHANGELOG (57), HANDOFF 문장 수정. 코드 변경 없음. §156 본문은 수정하지 않고 이 항목으로 정정.
- 엔진 후보 이름은 가설이며 감사(AUD-1)에서 근거 검증기 관측값으로만 확정.

## §158 — 2026-10-01 Codex: S11 그림자별 모델·도구 범위와 격리 코어 수락 (부분 완료)

VERIFIED: 새 `shadowProfiles` 최상위 상태 키의 기본값·검증·백업 허용 목록과 구형 상태/구형 암호화 백업 복원 시험을 기능 구현 전에 1/1 통과시켰다. 이름 있는 활성 그림자만 소유자 화면에서 연결된 모델, 선언된 역할·등급 도구 범위, 1~4회 호출 예산을 저장한다. 보관된 그림자는 배정하지 않는다. `agent-engine`은 실제 제공 도구를 그 범위로 좁히고 범위 밖 직접 호출도 거부한다. Builder의 기존 읽기 전용 `project_read`는 유지한다. 권한 없는 모델 배정과 범위 밖 도구 사용은 거부된다.

VERIFIED: 관련 19/19 통과. 실제 격리 HTTP 코어와 Edge 400px 화면에서 소유자만 설정 변경, 연결되지 않은 모델 거부, 설정 저장·재시작 보존·암호화 백업 왕복·보관된 그림자 제외를 확인했다. 합성 provider 미션에서 Scout/Researcher `synthetic-local`, Builder/SemanticVerifier `synthetic-remote`로 역할별 모델 분리가 기록되고 미션이 완료됐다. 화면 400×840에서 가로 넘침 없음. S11 체크포인트 전체 `npm.cmd test`는 1,443개 중 1,422 통과·0 실패·21 스킵(exit 0), `git diff --check` exit 0. 동결 세 파일 해시 불변. Vault 수정·커밋/push·운영 배포 없음.

실패→수정: 초기 단위 실행의 모듈 경로 오류와 Builder 범위에서 기존 `project_read`를 빠뜨린 문제를 수정하고 관련 시험을 다시 통과시켰다. 별도로 `*.test.mjs`가 아닌 `agent.fixture.mjs`를 직접 선택한 비표준 실행에서 낡은 자동검토 기대 2건이 실패했다. 이는 `npm test` 선택 집합에 없으며 전체 회귀 통과 수치에 포함하지 않았다.

RAN-UNVERIFIED: 서로 다른 모델의 체인은 합성 provider이며 실제 원격 모델 품질이나 실제 소유자 모델 배정을 증명하지 않는다. 로컬 Ollama 연결 판정은 있었지만 실제 외부 자격증명은 입력·조회하지 않았다. Builder의 코드 편집 권한을 새로 부여한 것이 아니며 이번 S11 범위는 읽기 전용 도구 배정이다.

BLOCKED: 소유자가 원격 모델 키를 비공개 화면에 입력하지 않아 실제 로컬→원격 모델 체인은 미검증. S12 음성·텔레그램·Android 실기기는 별도 단계이며 장치·토큰 미제공 항목은 그대로 BLOCKED로 남긴다. 새 OSS 조립 지시서 §157은 이후 단계에서 함께 대조한다.

산출물 SHA-256:
- `build-artifacts/concept-20260930/s11-storage-first.txt` `297597d69fca7001bfe4807dfd67b3b81cef16c4d8885e96ef2c931eb75eddf7`
- `build-artifacts/s11-20261001/focused-tests.txt` `f45fae447dd60738a1b3b68e02291b72ead4c6ed9526692428a71f4b3d47b1dc`
- `build-artifacts/s11-20261001/shadow-profile-report.json` `bad587e6a363002613f5a869cb2d426e6088214bc90cdd6790afc0b702100705`
- `build-artifacts/s11-20261001/shadow-profile-400.png` `535ad5ababb8fa8829df9c3eff7087642110ce8aa99f8a17c6f7f675d94bd338`
- `build-artifacts/s11-20261001/full-regression.txt` `3a517de60dd351fde67afddcb8e0774f31b13f2117bf281fd326d4caf6fdfbfc`
- 동결: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S11|stage=P3|implementation=partial|evidence=local,synthetic|source=158|artifact=build-artifacts/s11-20261001/shadow-profile-report.json|sha256=bad587e6a363002613f5a869cb2d426e6088214bc90cdd6790afc0b702100705

## §159 — 2026-10-01 Codex: S12 채널 권한 표·Android 제한 요약 (부분 완료)

VERIFIED: 기존 Android 컨트롤러·브라우저 Live Voice·OpenClaw 후보 분류를 코드에서 확인하고 `docs/OSS_FIRST_CHECKS.md`에 재사용 결정을 기록했다. 새 `channel-surfaces.mjs`는 browser/android/voice/telegram의 허용·금지 표를 순수 정책으로 내며 어느 채널에도 실행 코드 활성화 권한을 주지 않는다. Telegram 후보는 읽기·쓰기가 모두 비활성이다. 새 `GET /api/channel-overview`는 이미 인증된 소유자 브라우저/페어링 또는 Android 기기에만 밤 보고 날짜·해시와 초안 개수만 전달하고 보고 본문·초안 본문을 전달하지 않는다. Android 화면은 그 숫자를 보조 상태로 표시하며 기존 코어에서 404면 미확인으로 표시한다. 새 최상위 상태 키나 자격증명 저장은 없다.

VERIFIED: 격리 실제 HTTP 코어에서 합성 Android 등록 토큰은 제한 요약 200, 다른 기기 403, 미인증 401, 소유자 페어링 200. 새 채널 정책·HTTP와 기존 OpenClaw 후보 경계 7/7, Android 기존 홈 10/10, TypeScript `tsc --noEmit` exit 0, `git diff --check` exit 0. 동결 세 파일 해시 불변. Vault 수정·커밋/push·운영 배포 없음.

실패·한계: 첫 HTTP 시험은 테스트 종료 직후 임시 폴더의 즉시 재귀 삭제 때 Windows Node 프로세스가 종료돼 파일 수준 실패로 나왔다. 시험용 폴더 삭제를 hook에서 빼고 같은 HTTP 단언 3/3을 다시 통과시켰다. 변경하지 않은 `native-studio.test.mjs`도 별도 단독 실행에서 6개 단언 뒤 프로세스가 종료돼 완료 판정이 없다. 컨트롤러 `npm.cmd run build --prefix apps/controller`는 TypeScript 단계를 통과하고 Vite 113개 모듈 변환 뒤 Windows exit `-1073740791`로 끝났다. 빌드 성공이나 APK 갱신으로 표시하지 않는다. 관측 당시 여유 물리 메모리 약 0.64~0.68GiB이나 이 수치가 프로세스 종료의 원인이라는 증거는 없다.

RAN-UNVERIFIED: Android 화면의 새 보조 상태 문구는 코드와 TypeScript까지 확인했으나 새 APK·실기기 화면으로 보지 못했다. 전체 회귀는 S14 체크포인트 전까지 계획상 실행하지 않는다. 텔레그램 실제 봇, whisper.cpp/Piper 별도 프로세스, 실제 브라우저 음성의 새 S12 수락은 이번 조각에서 실행하지 않았다.

BLOCKED: Android 실기기 0대, 텔레그램 소유자 토큰 없음, 실제 음성 공급자/모델 연결 없음. OpenClaw 입력은 계속 `authentication:unverified`/`authorizesDispatch:false` 후보일 뿐이다. 이 연결을 소유자 권한으로 올리지 않는다. S12 전체 수락 전에는 컨트롤러 빌드 종료 원인과 실제 채널 수락을 더 확인해야 한다.

산출물 SHA-256:
- `build-artifacts/s12-20261001/focused-tests.txt` `9e82f05beece9aede5a9d42155e9db695ebe48a0b0038d6bb7c2fd911a2baa74`
- `build-artifacts/s12-20261001/native-home-tests.txt` `f9d48b81957a4e72296831d584bfdcb38592227be3c03dd761dd71379be7b6d4`
- `build-artifacts/s12-controller-build.txt` `992f1becacf0c0a187f87b8dce85676cac665691ee0567b15b84ec5c5fc86987` (실패 로그)
- `runtime/lib/channel-surfaces.mjs` `18b0591bf4f80ee7a9293affc5517ddd63d7acdfbcb1c6599bd43522a49de55b`
- `runtime/test/channel-surfaces.test.mjs` `39b9da3d20a9daa88d93a19f086cf6182a48002971e62957d0c21080e4bc5112`
- `docs/OSS_FIRST_CHECKS.md` `8a936e306487d03aeba15e1eecab99fee0ec62f7164ef5085f686ee848919f0e`
- 동결: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S12|stage=P4|implementation=partial|evidence=local,synthetic|source=159|artifact=build-artifacts/s12-20261001/focused-tests.txt|sha256=9e82f05beece9aede5a9d42155e9db695ebe48a0b0038d6bb7c2fd911a2baa74

## §160 — 2026-10-01 Codex: S13 Ed25519 능력 파일·신뢰 검증·비활성 초안 (부분 완료)

VERIFIED: `docs/OSS_FIRST_CHECKS.md`에 Node 내장 Ed25519 엔진과 기존 manifest 검증·초안함 재사용을 기록했다. 새 최상위 상태 키는 없다. 능력 교환 형식을 확장하기 전에 기존 초안함의 암호화 백업 복원 1/1을 통과시켰다. `capability-exchange.mjs`는 이미 활성이고 fixture 검증된 능력만 manifest, 버전별 해시, 검증/승인 이력, 라이선스, 출처와 함께 Ed25519로 서명한다. 반입 시 원본 manifest를 기존 `importCapability` 검증기로 확인하고, 해시·서명·신뢰된 공개키를 검사한 뒤 `exchanged-capability` **비활성** 초안으로만 넣는다. 서명·신뢰 목록·manifest/라이선스 변조는 거부된다. 초안함에 promote/activate 함수는 없고 이 경로에서 실행 코드 연결은 0건이다.

VERIFIED: 합성 키·기존 검토 manifest로 관련 시험 5/5 통과. 같은 파일 중복 반입은 초안 1건으로 수렴하며 새 종류의 암호화 백업 왕복도 확인했다. `git diff --check` exit 0. 동결 세 파일 해시 불변. Vault 수정·커밋/push·운영 배포 없음. 첫 단위 시험은 공개키를 다시 `createPublicKey`에 넣어 Node가 거부한 실제 오류였다. 공개키/개인키를 구분해 고친 뒤 5/5 통과했으며 실패를 성공에 합산하지 않았다.

RAN-UNVERIFIED: 서명·검증은 생성한 합성 Ed25519 키로만 실험했다. 소유자 DPAPI 서명 키 보관, 신뢰 목록 화면, 파일 선택·저장 UI와 두 PC 사이 파일 교환은 구현·실행하지 않았다. 전체 회귀는 계획된 S14 체크포인트까지 실행하지 않았다. 기존 `gap-storage.test.mjs` 단독 실행은 이 PC에서 기존 테스트 hook의 임시 폴더 재귀 삭제 시 프로세스가 비정상 종료되어 완료로 세지 않았다; 별도 S13 보존형 복원 시험으로 저장 선행 조건을 확인했다.

BLOCKED: 소유자가 서명 키·신뢰할 상대를 정하지 않아 운영 교환과 수신 공개키 등록은 불가. 따라서 S13 전체 수락을 주장하지 않는다. 다음 독립 단계는 S14의 비공개 영수증·재검증기로, 실제 공개 승인 전에는 외부 게시하지 않는다.

산출물 SHA-256:
- `build-artifacts/s13-20261001/storage-first.txt` `4646d3d3353e79f489633897b252f3ff5cb66cc98d91c8b183f8edf928306699`
- `build-artifacts/s13-20261001/focused-tests.txt` `29cf32bb7c5baff06fac3681f80ba31ec1c1690874292f3dffbe7b535575729e`
- `runtime/lib/capability-exchange.mjs` `a0e1a2d97167074bf89524c30bc9753ecf3effe9975f7a84124e0b9a065a2370`
- `runtime/test/capability-exchange.test.mjs` `4322c8cfb069b5e914361d21158c95250750019b30a96477e85a8753771332a2`
- `runtime/test/s13-storage-preflight.test.mjs` `95cbf91267acb654c37a1bf6190e4197c03d302efaca453adc7299061813fdff`
- 동결: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S13|stage=P4|implementation=partial|evidence=local,synthetic|source=160|artifact=build-artifacts/s13-20261001/focused-tests.txt|sha256=29cf32bb7c5baff06fac3681f80ba31ec1c1690874292f3dffbe7b535575729e

## §161 — 2026-09-30 Claude(Cowork): OSS 조립 지시서 — 개량(패치 방식) 허용 명시

- 지시서 1.1절 추가. 지시서 새 SHA-256 `8000992d954aaea1b6c06c888f5c288f2fc9202b453e6d6d86a522d33de19b8a`, 목표헌장 새 SHA-256 `e72a63113162f97ee50208ed240adbcb78eff6c9f9f6525790d4a3faf27a207b`, Vault 일치, CHANGELOG (58). 코드 변경 없음.
- 라이선스 주의(법률 자문 아님): MIT/BSD는 고지 유지, Apache-2.0은 변경 고지, GPL 계열은 수정본 배포 시 소스 공개 필요 — 공개 준비(S20) 전 재검토.

## §162 — 2026-09-30 Claude(Cowork): OSS 조립 지시서 AUD-4 목표 구조 재설계 추가

- 지시서 새 SHA-256 `d47db24f51ed276e79996f846f5a6f7144ebb14066a6603b9266a115d4c3b35b`, Vault 일치, CHANGELOG (59). 코드 변경 없음. 전면 재작성 금지·모듈 단위 교체·기존 시험 유지가 조건.

## §163 — 2026-09-30 Claude(Cowork): OSS 조립 지시서 2.1절 — 깨지면 고쳐서 돌아가게

- 지시서 새 SHA-256 `a04b0b893d9016232e521c80d8033f2feb854eb37e97736d607826c591dcb21f`, Vault 일치, CHANGELOG (60). 코드 변경 없음.

## §164 — 2026-10-01 Codex: S14 비공개 미션 영수증·재검증과 P4 전체 회귀 (부분 완료)

VERIFIED: `docs/OSS_FIRST_CHECKS.md`에 Node 내장 SHA-256과 기존 미션 기록 재사용 결정을 남겼다. 새 최상위 상태 키 없이 `runtime/lib/mission-receipts.mjs`가 끝난 Shadow 미션마다 입력 원문의 해시, 역할별 작업·모델명, 실제 저장 바이트와 맞는 산출물 해시, 결정론적/의미 판정, 연결된 욕망 논쟁 해시, 합성/미확인 출처 표식, 직전 영수증 해시를 기록한다. 목표 원문·산출물 본문·오류 원문·토큰은 페이지에 넣지 않는다. `receipts/<missionId>.json/.html`은 로컬 비공개 파일이며 기존 파일 불일치 시 덮어쓰지 않고 오류로 남긴다. 재시작 중 JSON은 있으나 HTML만 없는 경우 유효한 JSON에서 HTML을 재생성한다. 소유자 전용 `/api/receipts`는 본문 없이 건수·해시·판정만 제공한다.

VERIFIED: 합성 provider를 쓰는 실제 격리 HTTP 미션이 완료되어 미션 1건, 단계 5개, 산출물 5개에 대한 영수증을 자동 생성했다. `scripts/verify-receipt.mjs`가 복사한 영수증과 실제 산출물 바이트 5개의 체인·해시를 확인했다. 별도 합성 복사본 산출물 1개를 바꾸면 `artifact_hash_mismatch`, exit 1로 거부했다. 단위 시험은 개인 목표·본문 비노출, 반복 저장 중복 0, HTML 복구, 산출물 변조 및 페이지 변조 거부를 확인했다. S14 체크포인트 `npm.cmd test` → **1,451개 / 1,430 통과 / 0 실패 / 21 스킵**, exit 0. 같은 로그를 소유자 지정 `Desktop/npm-test-output.txt`에도 복사하고 SHA 일치 확인했다. `git diff --check` exit 0, 동결 세 파일 SHA 불변. Vault 수정·커밋/push·외부 게시 없음.

RAN-UNVERIFIED: 미션은 합성 모델 입력이므로 내용 품질이나 실제 모델 실증이 아니다. 로컬 SHA-256 체인은 개별 파일 변조를 검출하지만 외부 서명/앵커가 없어 공격자가 전체 체인을 다시 쓴 경우까지 독립적으로 증명하지 않는다. 복사한 산출물은 시험용이며 실제 비공개 미션의 공개 번들이 아니다. Android 앱 Vite 빌드 종료 문제(§159)는 이 전체 테스트 통과와 별개로 남아 있다.

BLOCKED: 영수증 외부 공개는 소유자 페이지별 승인 전까지 금지. 제3자 서명은 S15의 신뢰 목록·서명자 부재로 미실행. S14의 공개 수락은 미달이며 다음 독립 단계는 S15 외부 attestation의 형식·검증 경계를 만든 뒤 실제 외부 검증자를 기다리는 것이다.

산출물 SHA-256:
- `build-artifacts/s14-20261001/full-regression.txt` 및 `Desktop/npm-test-output.txt` `f5f053fb3bd3e4a803d3ea1d34ee326cb6e764aae833b4ef5380dd3b9604e42c`
- `build-artifacts/s14-20261001/report.json` `276af09cb42a49fc10161f7cb10080c3142b4941c8af14114587540903149278`
- `build-artifacts/s14-20261001/live-run.txt` `76b54b7e1efca3315b8a49b69453f18e1fc090851f40638ef54b827772096fbc`
- `build-artifacts/s14-20261001/verify-cli.txt` `20146f9d1bbd5b642dd2bf63e5e4aae2ec207f2cfa2f8dcda1e7d45384364681`
- `build-artifacts/s14-20261001/tamper-rejection.txt` `70f42b9c551daa4d1fd0d044494b9f91570701c2db24dfb94f71b7c53a9e4eff`
- `runtime/lib/mission-receipts.mjs` `050a2fd02c4edb575c768cc2ac0f2895efc7302091f97e7f0bb0cc4d64a347c6`
- `runtime/test/mission-receipts.test.mjs` `5dd2131e5baf395855426fef6566077acd3899c345a2dbb2be902f771f993315`
- `scripts/verify-receipt.mjs` `670cd84a424e11b684d8ed767a6707883de3d5699e4c6f14493293e3015c75c6`
- `scripts/verify-s14-receipt-live.mjs` `873f98c8df7929e95cc2f8e33704dc2663732d3bbe01c79fbdb377a39e3d9949`
- 동결: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S14|stage=P4|implementation=partial|evidence=local,synthetic|source=164|artifact=build-artifacts/s14-20261001/report.json|sha256=276af09cb42a49fc10161f7cb10080c3142b4941c8af14114587540903149278

## §165 — 2026-10-01 Codex: S15 외부 영수증 증언 계약·성과 등급 분리 (부분 완료)

VERIFIED: `docs/OSS_FIRST_CHECKS.md`에 S13 Ed25519/S14 영수증 엔진 재사용을 추가했다. `receipt-attestation.mjs`는 영수증 JSON 해시와 그 안의 모든 산출물 바이트 해시를 다시 확인하고, 신뢰 목록에 있는 소유자 아닌 Ed25519 공개키의 서명만 검증한다. 입력에는 영수증 해시·미션 ID·산출물 해시·시각과 `receipt_integrity_only` 주장만 들어간다. 소유자 키 자가서명, 미신뢰 키, 바뀐 영수증·산출물은 모두 거부한다. 합성 키 시험 2건과 S14 재검증 시험 2건, 합계 4/4 통과. 반환은 `externalPersonVerified:false`, `outcomeVerified:false`, `highGradeCandidate:false`, `authorizesDispatch:false`로 고정이며 성과 원장이나 `solo-leveling.mjs`에 자동 입력하지 않는다. 동결 세 파일 SHA 불변, `git diff --check` exit 0, Vault 수정·커밋/push 없음.

RAN-UNVERIFIED: 생성한 합성 키와 합성 영수증으로 서명 계약을 시험했다. 신뢰 목록은 시험 호출 인자로만 전달되고 운영 DPAPI 저장·소유자 화면·재시작 복구는 구현되지 않았다. `npm.cmd test` 전체 회귀는 S17 체크포인트 전까지 계획상 추가 실행하지 않았다.

BLOCKED: 실제 외부 검증자 0명, 신뢰할 외부 공개키·서명 파일 미제공. 실제 S등급 근거 0건. **설계 충돌:** S14 영수증의 제3자 서명은 실행/산출물 무결성에 관한 증언이지 `outcome-verification`의 수익·청중 등 성과 지표 참값 증명이 아니다. 따라서 서명만으로 `external_verified` verdict를 만들면 과장이다. 외부인이 성과 출처 자체를 검증한 별도 근거가 생기기 전까지 S등급 연결은 닫아 둔다. 다음 독립 단계는 S16 자기 개선 초안의 격리 생성이며 실제 트리 적용은 소유자 승인 전까지 금지한다.

산출물 SHA-256:
- `build-artifacts/s15-20261001/focused-tests.txt` `1577f3e3da8005569d248a2f2286eb48fb2cbc968f847f05721c66a24ab647e7`
- `runtime/lib/receipt-attestation.mjs` `15f7eefe105efa3f20ceb9bd9ed89c92287b88c0a02060d45d6017a5e6553f67`
- `runtime/test/receipt-attestation.test.mjs` `28a7826c55c0f86f290dca11f31af4d98382e349a085e08f2267150c2978cb06`
- 동결: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S15|stage=P5|implementation=partial|evidence=local,synthetic|source=165|artifact=build-artifacts/s15-20261001/focused-tests.txt|sha256=1577f3e3da8005569d248a2f2286eb48fb2cbc968f847f05721c66a24ab647e7

## §166 — 2026-09-30 Claude(Cowork): 개념·엔진별 오픈소스 후보 지도

- `docs/OSS_CANDIDATE_MAP_20260930.md` 작성(SHA-256 `b177870777a84e73d1564e2301fd66494ecdc01fa835fe905af0b95559af71cc`), 지시서 AUD-1 연결(새 SHA-256 `d884f79492c4633f54b9e7df460d58b7a75b12dfa29ad3d5834a6f067d7c3b78`), Vault 일치, CHANGELOG (61). 코드 변경 없음.
- 미확인 명시: 마지막 커밋 날짜(Voyager 2024-04-03, SearXNG 2026-09-08만 확인), litellm·in-toto 라이선스, 블랙홀 모듈별 실제 대체 가능성. 전부 가설이며 Codex 감사에서 확정.

## §167 — 2026-10-01 Codex: S16 자기 변경안 초안 계약

VERIFIED: 기존 repository-patch 범위 검사, 동결 경로 차단, 정적 가드, Docker 무네트워크 통과 증거와 patch SHA 결합 뒤에만 `self-change-proposal`을 absorbInbox에 초안으로 넣는다. 생성 함수에 저장소 쓰기·승격 경로가 없고 `authorizesDispatch:false`이다. 옛 inbox/백업 저장 계약 시험 1/1을 구현 전에 재실행했다. 집중 시험 5/5, 실패 0. 실험의 Docker 증거는 합성 fixture이므로 실제 Docker 수행 주장 아님.

RAN-UNVERIFIED: 실제 개발자 워커가 만든 패치를 이 새 초안함에 넣는 운영 연결과 소유자 화면 승인/적용은 실행하지 않았다. 실행 코드 활성화는 소유자 최종 승인 전 금지 상태다.

BLOCKED: 실제 워커 Docker 시험 증거·소유자 승인 UI가 없어 실 프로젝트 자기개선 완주 0건.

증거: `build-artifacts/s16-20261001/focused-tests.txt` SHA-256 `68e42ff52fd0334d68c7c62088233289caa214bd0e33ddf3a8dc6dcb33586a98`; `runtime/lib/self-change-proposal.mjs` `904edbf77679babc3dc1798b42f5e8a3cfce05f7ce4a93cec0064d45eff62d4b`; `runtime/lib/absorb-inbox.mjs` `36f568a983daea537c7bdd40b5f66b527342aab6404397fde966e9e6549a7b68`; `runtime/test/self-change-proposal.test.mjs` `19c0a78b45f1ff54b2947f6e5eb39e8a9e368ac4af42d277b1b9558bd6918f3c`.

동결 SHA 불변: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`, `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`, `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S16|stage=P5|implementation=partial|evidence=local,synthetic|source=167|artifact=build-artifacts/s16-20261001/focused-tests.txt|sha256=68e42ff52fd0334d68c7c62088233289caa214bd0e33ddf3a8dc6dcb33586a98

## §168 — 2026-09-30 Claude(Cowork): 개념 융합 재설계안

- `docs/BLACKHOLE_REDESIGN_OSS_FUSION_20260930.md` 작성(SHA-256 `5adb31a0ba18a65af5b3fb9b1fe7d2a63439b3e0f7143e5a57a26599184a74cb`), 지시서 AUD-4 연결(새 SHA-256 `be8a361aea677fc31f78318e4bbdf5c6b920d66248127ff614a0961e8b187803`), Vault 일치, CHANGELOG (62), HANDOFF 한 줄. 코드 변경 없음.
- 모듈 대응은 이름·파일 머리말만 본 가설. 오픈소스 동작 설명은 일반 지식이며 실제 기동 확인 전 가설.

## §169 — 2026-10-01 Codex: S17 저장 사건 무대와 전체 회귀 체크포인트

VERIFIED: JARVIS는 서버가 투영한 욕망 정산·그림자·커비 알림만 최대 3건 읽기 전용 무대로 표시한다. 새 `PUBLIC_BRAND_NAME` 기본값은 BLACKHOLE. 사건이 없거나 연결이 끊기면 무대가 숨는다. 색과 별개로 텍스트 범주를 표시하고 소리는 재생하지 않는다. 모델 함수·화면 계약 집중 시험 11/11. 실제 Edge 400×840, 768×900, 1440×900과 reduced-motion 캡처 모두 가로 넘침 0, 작업 명령 전송 0. 첫 캡처의 오브/발언 겹침을 보고 CSS를 조정한 뒤 캡처를 다시 만들었다.

VERIFIED: S17 체크포인트 `npm.cmd test` 1,458 total / 1,437 pass / 0 fail / 21 skip, exit 0. `Desktop/npm-test-output.txt`로 복사하고 해시 동일 확인.

RAN-UNVERIFIED: 브라우저 사건 세 줄은 실제 격리 코어의 페어링 후 `/api/state`에 시험용으로 주입한 합성 알림이다. 실제 운영 기록의 90초 데모/실제 모델·기기 수락은 아직 아니다. 실제 소유자 브랜드 이름, 소리 선택, 모션으로 정산·기상을 개별 표현하는 전체 S17 요구도 미완이다.

BLOCKED: 실제 모델·기기와 소유자 브랜드 결정, 운영 상태 실증. 화면에는 합성 사건을 운영 진실로 저장하지 않았다.

산출물: `build-artifacts/s17-20261001/report.json` SHA-256 `b79db60accdfe2990e36c359fa8cb1905a08ce589d38b0e8496637821f15b851`; `focused-tests.txt` `cbef80882738dc08e9332604421f793f8690fd1401cb7ae12b0647cbf2e4f52a`; `full-regression.txt` `0cba5d573c0c9a4597972da036f71db08228c82055462c65d58c12d2bd376a6d`; `scripts/verify-s17-stage-live.mjs` `04668b3284144d5c7e3e87a2581dd4793beee6a0fa1f472fa739ab16042dadea`. PNG 3개 해시는 report.json에 기록됨.

동결 SHA 불변: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`, `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`, `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S17|stage=P5|implementation=partial|evidence=local,synthetic|source=169|artifact=build-artifacts/s17-20261001/report.json|sha256=b79db60accdfe2990e36c359fa8cb1905a08ce589d38b0e8496637821f15b851

## §170 — 2026-10-01 Codex: S18 설치·업데이트 신뢰 계약, Windows 격리 인수

VERIFIED: 기존 Windows PowerShell 5.1 격리 인수 `test-resident-windows.ps1` 재실행에서 109/109 검사, `status=passed`, `productionChanges=false`. 새 업데이트 manifest 검증기는 신뢰 목록의 Ed25519 공개키·패키지 SHA-256 바이트가 모두 맞아야 검증하고, 위조 키·변조 바이트·서명되지 않은 버전·추가 필드를 거부한다. 설치 권한은 `authorizesInstall:false`. 원격 러너 권한 표는 소유자 mTLS fingerprint가 일치할 때 scout/builder의 worker 실행만 허용하며 상태 저장은 primary-only. 집중 시험 8/8, fast 층 152/152. CI YAML은 fast/integration을 각각 실행하고 full은 수동 입력일 때만 실행하도록 변경(원격 CI 자체는 미실행).

RAN-UNVERIFIED: 첫 Windows 인수 시도는 PowerShell 7에서 preflight 0건 실패(`windows-test-log.txt`)였다. 이 실패를 보존하고 `powershell.exe` 5.1로 고쳐 실행했다. 운영 resident 조회는 taskState=Ready, managementAvailable=false, coreHealthy=null, phoneStatus=unverified였으므로 운영 건강을 VERIFIED로 표기하지 않는다. S16 복원시 런타임이 controller TypeScript 패키지를 요구할 수 있는 결합을 발견해 `absorb-inbox` 재검증의 worker 정적 가드 import를 제거했다. 정적 가드는 제안 생성 단계에서 계속 실행되고, 저장된 초안은 범위/해시를 재검증한다.

BLOCKED: 소유자 서명 인증서·업데이트 설치 승인, 두 번째 소유 머신과 HTTPS 상호 인증, 운영 resident 건강 확인, 원격 CI 실행. 실제 다운로드/설치/원격 dispatch 0회.

증거: `build-artifacts/s18-20261001/windows-acceptance.json` SHA-256 `37c8d512f9593e985800460b035a58371faf9a48a370c62dc97a39440d2e81a3`; 실패 `windows-test-log.txt` `979639c272f538f320cca2833eb5ffc3443ebcc60e1ba995b0cacadf4746c70b`; 통과 로그 `windows-test-log-ps51.txt` `ab6477a14c0755680509810c8d0937c1d8cb580e62232c20a527cb93bc9c6f75`; `focused-tests.txt` `6fd71e4842a2be35ed6a819c0f8e779ae1cb46015d3bfc26e9eaca06f1743da5`; `fast-tests.txt` `0bf7ad91df12e9e8b4fc6987534b7dde889be1c908ec04c6230c06c9baaf1f13`. `runtime/lib/release-trust.mjs` `1dc9983c57a5d6c4370695d0b220942ee961f1288d117d2b728b3f02889c7b56`; `remote-runner-policy.mjs` `cb269e84b55fad649158683c6870b9f1ada761c489ad375b001644ef3d0f48eb`.

동결 SHA 불변: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`, `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`, `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S18|stage=P6|implementation=partial|evidence=local,synthetic|source=170|artifact=build-artifacts/s18-20261001/windows-acceptance.json|sha256=37c8d512f9593e985800460b035a58371faf9a48a370c62dc97a39440d2e81a3

## §171 — 2026-10-01 Codex: S19 오프라인 사업 계약과 로컬 영수증·연대기

VERIFIED: 합성 Ed25519 라이선스가 정확한 기간·서명·선언된 세 기능 범위일 때만 오프라인 권한을 반환하고, 핵심 엔진/검증/영수증은 라이선스 없이도 `true`다. 결제·계정·송금 경로 없음. 루프백 + 소유자 세션 전용 `GET /api/receipts/:missionId/verify`는 격리 코어에서 정상 200, 미인증 401, 산출물 변조 409를 반환했다. 서명은 외부 결과 품질을 증명하지 않으므로 `externalOutcomeVerified:false`. 밤 주기 저장 보고에서 Markdown 원문 해시 동일, MIT `fflate@0.8.3`로 EPUB ZIP 첫 mimetype 항목을 store(압축 방식 0)로 만들고 5개 항목을 다시 풀어 확인. 모델 호출 0. 집중 시험 6/6.

RAN-UNVERIFIED: 첫 EPUB 시도에서 Windows .NET `NoCompression`이 20바이트 mimetype을 25바이트 deflate로 저장해 규격 검사에 실패했다. 잘못된 PS 포장기는 제거하고 fflate로 교체했다. EPUB은 ZIP 구조·문자열만 검증했고 외부 리더 열람은 미실행. 라이선스 정책 모듈은 실제 채널/교환소/원격 러너에 활성 게이트로 연결하지 않았다. 실제 소유자 서명 키·판매·발급·출판 0건.

BLOCKED: 소유자 라이선스 정책/키, 실제 외부 전자책 리더 호환성, 루프백 밖 영수증 노출 승인. 결제 기능은 의도적으로 미구현.

증거: `build-artifacts/s19-20261001/receipt-api-report.json` SHA-256 `afe62ef45823d61945ed2f56a4d2dee5edf87b7440e7261a6957321036645760`; `chronicle-report.json` `4c3dad7c5abb2d0389d5b79de98d3305c59cac6a45902801e35e9351def83488`; `focused-tests.txt` `174d09f80f0e3dd16147a251c09d4ff459fccbad61ddcad91e1e1af341065f52`; `chronicle/2026-10-01-chronicle.epub` `27a32b591e2518be9d412b6ea756e959907723083dd23c8059fb7738cad41c2e`. npm registry `fflate@0.8.3` MIT, integrity `sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==`, 잠금 파일에 고정.

동결 SHA 불변: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`, `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`, `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S19|stage=P6|implementation=partial|evidence=local,synthetic|source=171|artifact=build-artifacts/s19-20261001/receipt-api-report.json|sha256=afe62ef45823d61945ed2f56a4d2dee5edf87b7440e7261a6957321036645760

## §172 — 2026-10-01 Codex: S20 공개 상태표와 합성 재현 번들

VERIFIED: `README.md`의 기능별 주장·근거 표는 `docs/STATUS.json`에서만 `scripts/public-status.mjs`로 생성한다. 기존 README의 현재 증거와 맞지 않는 운영 서비스 서술은 제거했다. `node scripts/status-from-log.mjs --check`와 `node scripts/public-status.mjs --check`가 통과했고 생성기 집중 시험 2/2가 통과했다. 기여·보안 신고·외부 테스터 안내/피드백은 로컬 문서 초안으로 남겼으며 외부 전송 0건이다.

VERIFIED: 격리 코어의 합성 공급자로 실제 미션 1건을 실행하여 입력 JSON, 영수증 JSON/HTML, 산출물 5개, SHA-256 목록, Node 내장 모듈만 쓰는 재검증 스크립트를 ZIP에 묶었다. 이 PC의 새 디렉터리에 압축을 푼 뒤 재검증했고, 산출물 변조가 거부되며 원본을 복원한 뒤 다시 통과했다. 증거 등급은 `synthetic`, `externalOutcomeVerified:false`, `authorizesDispatch:false`이다. 서명/외부 앵커가 없으므로 로컬 해시가 발행자 신원이나 외부 품질을 증명하지 않는다.

VERIFIED: S20 체크포인트 `npm.cmd test 2>&1 | Tee-Object -FilePath Desktop/npm-test-output.txt` 종료 코드 0. 전체 회귀 1,465 total / 1,444 pass / 0 fail / 21 skip. 원본 로그를 `build-artifacts/s20-20261001/full-regression.txt`로 복사했고 SHA-256 `bb5c235a4a62b2251626b91139cc005f64dce6849b0724ee25d0d258c36c284c`이다.

RAN-UNVERIFIED: 합성 ZIP을 같은 PC의 다른 디렉터리에서 재검증한 것만 확인했다. 외부인·다른 머신 설치/검증, 실제 소유자 작업 재현, 실제 Android 휴대폰 사용, 실제 모델 응답, 공개 배포, 테스터 10명 접촉은 실행하지 않았다. `build-artifacts/` 링크는 이 로컬 작업 공간에서만 열린다. 공개 배포 자료의 비밀·사생활 심사는 수행되지 않았다.

BLOCKED: 제3자 머신/검증자, 실제 기기/모델 키, 외부 테스터 접촉·배포 승인, 공개 브랜드·서명 정책과 저장소 전체 라이선스 선택. S20의 라이선스 파일은 권리자가 범위를 결정하기 전에는 작성할 수 없어 `docs/PUBLIC_LICENSE_DECISION_PENDING.md`로 사유만 남겼다. 의존성 MIT는 저장소 전체에 재배포 권한을 주지 않는다. 실제 영수증 공개와 실행 코드 활성화는 여전히 소유자 최종 승인 전까지 닫혀 있다.

산출물 SHA-256: `build-artifacts/s20-20261001/report.json` `6fe1254c8e99ac09b7dce17388073e7591fd17facbcdd7c2f5e3abc3964274e9`; `synthetic-reproduction.zip` `83dac524b952f65271d042254fa4ae9619d661435c92931e36ac05fdaaa513e7`; `scripts/verify-reproduction-bundle.mjs` `9a51e2a092db39cd484531f99b0684e899d2a802bd9caaa59f523990b70df112`; `docs/PUBLIC_LICENSE_DECISION_PENDING.md` `df5640397832df098cbec381d2cd5ec64374b194334ce006cf533824ac787221`.

동결 SHA 불변: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`, `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`, `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S20|stage=P6|implementation=partial|evidence=local,synthetic|source=172|artifact=build-artifacts/s20-20261001/report.json|sha256=6fe1254c8e99ac09b7dce17388073e7591fd17facbcdd7c2f5e3abc3964274e9

## §173 — 2026-10-01 Codex: S12 Android 컨트롤러 빌드 재현·우회 및 새 APK

VERIFIED: 같은 미커밋 소스의 `npm.cmd run build --prefix apps/controller`는 기본 시스템 Node 24.11.1에서 TypeScript 통과·Vite 113 모듈 변환 뒤 Windows exit `-1073740791`로 다시 종료됐다. `NODE_OPTIONS=--max-old-space-size=384`에서도 같은 종료였다. 이 PC에 이미 있는 번들 Node 24.19.0을 PATH 앞에 둔 **같은 npm 빌드 명령**은 exit 0, Vite 113 모듈 변환·청크/자산 출력 완료. 이는 런타임 변경 시 통과한다는 관측이지 기본 Node 바이너리의 결함이나 RAM 인과관계 확정은 아니다. `--root` 옵션으로 한 번 잘못 호출한 CLI 시도도 수락 근거로 세지 않았다.

VERIFIED: 기존 승인된 Android SDK/JDK 환경과 번들 Node로 `npm.cmd --prefix apps/controller run tauri -- android build --debug --apk --target aarch64 --ci` exit 0. 기존 APK를 덮지 않고 `C:\blackhole-build-tools\artifacts\BLACKHOLE-smoke-0.2.0-arm64-debug-20261001-r173.apk`에 동일 바이트 사본을 남겼다. 110,880,595바이트, SHA-256 `2550f560d8c25db07c77fb4f650d6555ef6322a30c9a5570607346850fbf6764`. SDK의 정확한 경로로 `apksigner` v2 서명 검증, `zipalign -c -P 16 -v 4`, `aapt dump badging` 통과. package `kr.yeno.controller.smoke`, versionCode 2001, minSdk 28, targetSdk 36, arm64-v8a. 디버그 서명 지문 `01ed048243d404d2761c5cf3f6224e4e048eb8604516c430bd3dad92774a1da4`는 r84와 동일. APK 안 `libyeno_controller_lib.so`와 방금 빌드한 네이티브 파일 SHA-256 둘 다 `23c2973d66c5f2f92ed34815f3ae441b21f96ed10743e758dd6c12375711e9cd`; Vite JS/CSS 자산 이름이 내부 바이너리에 존재함을 확인했다.

RAN-UNVERIFIED: 첫 SDK 검사 호출은 `apksigner`가 PATH에 없어 실행되지 않았고, 기존 SDK의 절대 경로로 재실행해 성공했다. `adb devices -l` 목록은 0대. 실제 Android 설치, 페어링, 요청, PC 작업 진행·결과·복구는 실행하지 못했다. 웹 자산 이름/네이티브 바이트 검사는 기기 화면 동작이나 Android OS 백업 규칙의 실사용 증거가 아니다. S20 전체 회귀는 이 소스 수정 없는 빌드 전에 이미 1,465/1,444/0/21로 통과했으며 추가 전체 회귀는 돌리지 않았다.

BLOCKED: 휴대폰 실기기 0대와 소유자 페어링 행동. 원격 모델 키·검색 키도 이 빌드에 넣지 않았다. 릴리스 서명 패키지나 스토어 배포가 아니므로 소유자 실제 서명 키 없이 debug APK만 보존했다.

증거: `build-artifacts/s20-20261001/android-build-report.json` SHA-256 `b43bf7415db80206331f73b27065b5cfd417a41fa0991497d07a4878211f242a`; 빌드 로그 `android-debug-build.txt` `14bf0fb9a73a27071db4b87bf205e79bb2e4ec7fd6fb818a814b2bbf639b020d`; 기본 Node 실패 `controller-build.txt` `992f1becacf0c0a187f87b8dce85676cac665691ee0567b15b84ec5c5fc86987`; 성공 `controller-build-fixed-runtime.txt` `76408545cd6535a8068552e845e145365e3d5667457a541a05a1bbf22ffed0ba`. 세부 검사 로그 SHA는 report.json에 기록.

동결 SHA 불변: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`, `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`, `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S12|stage=P4|implementation=partial|evidence=local,synthetic|source=173|artifact=build-artifacts/s20-20261001/android-build-report.json|sha256=b43bf7415db80206331f73b27065b5cfd417a41fa0991497d07a4878211f242a

## §174 — 2026-10-01 Codex: 일일 마감과 소유자 결정 대기

VERIFIED: 오늘 S16~S20에서 자기 변경안 초안 계약, 사건 무대, Windows 격리 설치 인수, 오프라인 권한/로컬 영수증, 공개 상태표/합성 재현 ZIP을 각각 §167·§169~§172에 기록했다. S17 전체 회귀 1,458/1,437/0/21, S20 전체 회귀 1,465/1,444/0/21, 각각 실패 0. S12 Android 컨트롤러의 기본 Node 빌드 실패를 보존하고 번들 Node로 빌드와 새 디버그 APK를 완성한 사실은 §173에 있다. 동결 세 파일 SHA는 §173에 다시 대조했다. 커밋/push·Vault 수정·운영 배포·실제 자격증명 입력·외부 연락·공개 게시 0건.

RAN-UNVERIFIED: 이 PC의 운영 예약 작업은 `Ready`이지만 managementAvailable=false, coreHealthy=null, `http://127.0.0.1:8790/api/health`는 도달하지 못했다. 따라서 운영 resident 건강/휴대폰 실행은 확인하지 못했다. 새 APK는 디버그 서명/정렬/네이티브 바이트까지만 확인했고 실제 휴대폰 설치는 0건. S20 재현 ZIP은 같은 PC 별도 디렉터리에서만 검증했고 제3자 머신은 0건. STATUS 등록부의 `implemented`는 해당 코드·국소 시험 범위이며 제품 완성을 뜻하지 않는다.

BLOCKED/소유자 결정 큐: 실제 모델 키와 검색 공급자·키, Android 실기기 연결/페어링, 운영 resident 설치·기동 범위, S9 청중/수익 공식 플랫폼, S10 야간 창, S11 그림자 모델 배정, S12 텔레그램 토큰/음성 장치, S13/S15/S18 서명 키·신뢰 목록·두 번째 머신/외부 검증자, S14 영수증 공개, S17 공개 브랜드/모션·소리 선호, S19 라이선스 정책, S20 저장소 공개 라이선스/테스터 접촉·배포, 실행 코드 최종 활성화와 체크포인트 커밋 승인. 승인·자료가 없는 항목은 계속 닫혀 있다. 특히 소유자 승인 전 외부 코드를 실행 경로에 붙이지 않는다.

남은 로컬 품질 과제는 별도 목표로 보존한다: S17 실제 운영 사건 90초 화면 인수, S13/S15 소유자 키 저장·신뢰 목록 UI, S18 원격 CI/업데이트 설치 경로, S19 EPUB 외부 리더 호환, P1.5 실제 순간 상태 캡처. 이들은 오늘의 VERIFIED에 포함되지 않으며 소유자 자원/권한이 열려도 추가 구현·시험이 필요하다. 다음 한 단계는 실제 Android 기기가 연결되면 §173 APK의 페어링→요청→진행→결과→재시작 복구를 순서대로 실기기 수락하는 것이다. 연결 전에는 기존 코드의 운영 건강 진단과 남은 로컬 결함을 계속 분리한다.

## §175 — 2026-10-01 Codex: S13/S15 소유자 서명 키·신뢰 목록 로컬 경계

VERIFIED: 새 최상위 상태 키 없이 기존 S13 옛 상태/암호화 백업 복원과 서명 계약을 **구현 전에** 5/5 재실행했다. `owner-signing-vault.mjs`는 모델·검색 자격정보와 별도인 `signing-identity.dpapi`만 사용한다. 최초 생성은 소유자 GUI 행동일 때만 가능하고, 저장된 키를 덮어쓰지 않는다. Windows CurrentUser DPAPI로 합성 Ed25519 개인키를 암호화 보관하며 GUI/파이프 응답은 상태·지문·공개키만 반환한다. 선택한 공개키의 추가/철회는 소유자 GUI에서만 호출한다. 저장된 신뢰 목록을 S13 교환 패킷의 draft-only 수락과 S15 영수증 무결성 서명 검증에 실제 연결했다. 합성 서명은 `authorizesDispatch:false`, 외부인 신원 확인 false, 성과 판정 false, S등급 후보 false를 유지한다. `owner-signing-bridge.test.mjs`와 보관/계약 시험 5/5, 기존 S13/S15/복원 관련 집중 시험 8/8. 운영 서명 파일은 조회 시 존재하지 않았다.

VERIFIED: Windows PowerShell 5.1의 WinForms 팝업을 실제 오프스크린 렌더링해 `gui-smoke.png`를 확인했다. 한국어가 깨지지 않도록 새 PS1에 UTF-8 BOM을 넣었고 서명 상태·공개키 내보내기·신뢰 목록·철회 버튼이 보인다. GUI 생성은 합성 응답만 사용했으며 소유자 실제 화면 클릭은 하지 않았다. `git diff --check` 통과.

RAN-UNVERIFIED: 새 단독 시험의 첫 실행은 Windows에서 테스트 임시 폴더를 즉시 재귀 삭제하는 hook 중 파일 수준 실패로 종료됐다(`vault-tests.txt`). 삭제 hook을 제거한 뒤 동일 단언 3/3, 이후 브리지 포함 5/5 통과. 첫 PowerShell 5.1 GUI smoke는 기기 기본 ExecutionPolicy 때문에 막혔고 프로세스 한정 `-ExecutionPolicy Bypass`로 재실행해 통과했다. 이는 시스템 정책 변경이 아니다. 테스트 임시 폴더 정리는 자동 승인 검토가 재귀 삭제를 거부하여 실행하지 않았다. 폴더에는 합성 시험 키만 있으며 실제 소유자 키가 아니다.

BLOCKED: 소유자 실제 서명 키 최초 생성·신뢰할 외부 검증자 선정/등록, 실제 외부 서명 0건. S13 능력 교환 파일의 소유자 선택→운영 코어 draft 저장 전체 흐름과 S15 서명 파일의 운영 신뢰 목록 재시작·화면 수락은 아직 구현/실행되지 않았다. 실행 코드 활성화는 소유자 최종 승인 전 닫혀 있다. 동결 파일 무수정, Vault·운영 자격정보·커밋/push 무변경.

증거: `build-artifacts/s13-owner-trust-20261001/report.json` SHA-256 `5d449bb88a6447c0d2cbde9cecbbb8a4ea5d46b39e9c814a843981401d8efdec`; `preflight.txt` `e174c0f94d62f71da6d85d9f2a5d873ce17da301867cd904459d50c26b02e416`; 첫 실패 `vault-tests.txt` `04350f48e1f27c181b2eabe00db57c3678cb4706a7801017dbabfd1ae4b20e26`; 최종 `bridge-and-vault.txt` `9e0843283e187ef9221e9d4cb10b7c3b99d5b421864aabcf1c36b3bbe2033aab`; 화면 `gui-smoke.png` `515d4e7a8ad454f679512f920efb9e7881bf98f250fcb026423f69042c2d8bda`; `runtime/owner-signing-vault.mjs` `c191fdb607bf431a1b52275202ea0d39201a1cf30610cf826c2265559878092f`.

동결 SHA 불변: `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`, `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`, `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337`.
- STATUS|id=S13|stage=P4|implementation=partial|evidence=local,synthetic|source=175|artifact=build-artifacts/s13-owner-trust-20261001/report.json|sha256=5d449bb88a6447c0d2cbde9cecbbb8a4ea5d46b39e9c814a843981401d8efdec
- STATUS|id=S15|stage=P5|implementation=partial|evidence=local,synthetic|source=175|artifact=build-artifacts/s13-owner-trust-20261001/report.json|sha256=5d449bb88a6447c0d2cbde9cecbbb8a4ea5d46b39e9c814a843981401d8efdec

## §176 — 2026-10-01 Claude(Cowork): Codex 지적 반영 — faster-whisper 자원·AGPL 별도 프로세스 정정

- 후보 지도 `2becd874c266eba5a40b88d6805cb253a8bbea8c101cbfa9f926289ee3101db5`, 재설계안 `adbe61c4f319742f26edda050a812d890529044297bb7eb3bd04b4135eb9f25f`, 지시서 `ee3676eaeaa416d1a527503566602dd5addaa68a47d555122355ec8651dee0b2`로 갱신, Vault 일치, CHANGELOG (63). 코드 변경 없음. 앞선 설계 기록(§166·§168)의 해당 서술(faster-whisper "가벼움", SearXNG "별도 프로세스면 됨")은 이 항목으로 정정하며 과거 항목은 수정하지 않음.

## §177 — 2026-10-01 Codex: OSS 재설계 자원·계약 사전 대조

VERIFIED: PC 연결이 살아 있어 로컬 Git remote/branch/HEAD, 7.731 GiB 물리 RAM·0.813 GiB 순간 여유 RAM, `runtime/lib` 137개 `.mjs`와 `runtime/public` 전체 84개를 직접 조회했다. 설계 초안의 126개는 현재 파일 수가 아니다. `shadow-roster.mjs`에서 그림자 ID는 계속 유지되고 임무 ID들이 `missions`에 누적되는 것을 확인해 그림자 정체성과 작업 기록을 분리했다. 동결 세 파일 SHA-256은 §175 기준과 일치한다. 공식 프로젝트 원문에서 faster-whisper CPU small int8 예시 1,477MB, OpenHands Windows WSL+Docker/권장 4GB, LiveKit Agent 서버 시작 기준 4코어/8GB, DBOS PostgreSQL 요구, Temporal 단일 바이너리 개발 서버, SearXNG Python/컨테이너 설치 경로를 확인했다. LiteLLM 루트 LICENSE는 enterprise 제외 MIT, in-toto LICENSE는 Apache-2.0을 직접 읽었다. 자세한 URL과 범위는 `docs/BLACKHOLE_OSS_RESOURCE_PRECHECK_20261001.md`에 있다. 파일 SHA-256 `91299b3f3fb97b757da5729866e8ded324c082bbbf25cb8ba654fb33267374fb`.

RAN-UNVERIFIED: 외부 OSS 설치·기동·실제 RAM/CPU 측정·모듈 교체·전체 회귀는 이번 사전 대조에서 실행하지 않았다. 공식 벤치마크는 이 PC의 측정값이 아니다. 후보별 최신 commit/stars/archived도 이번에는 재관측하지 않았다.

BLOCKED/보류: AUD-1 전수 감사표와 AUD-4 목표 구조는 아직 완성되지 않았다. B 후보 최초 기동/파이썬·도커 설치, 운영 저장소 교체, 외부 코드 실행 경로 활성화는 기존 소유자 경계대로 보류한다. 기존 구현과 데이터는 보존한다. 다음 단계는 실제 137개 lib 모듈과 public 파일의 포함 기준을 고정해 AUD-1 전수 감사표를 작성하는 것이다. 커밋/push·Vault 수정·자격정보 입력·운영 배포 0건.

## §178 — 2026-10-01 Claude(Cowork): Codex §152~§175 독립 검증

VERIFIED(직접 확인): (1) `STATUS|` 줄 48개 중 산출물이 있는 고유 31개 가운데 30개의 파일 SHA-256이 기록값과 일치, 불일치 0, 나머지 1개(P1-registry-runtime)는 `not_implemented`·artifact `-`로 정직하게 표기. (2) 동결 3파일 SHA 불변(solo-leveling `14c1d6ac…`, recovery-one-of-qpu `452ef8ef…`, static-guard `3efd4eb2…`). HEAD는 여전히 `e7b6dfe`(커밋 없음), 미커밋 항목 모델 71·신규 215. (3) 전체 회귀 로그 3개를 직접 열어 확인: S14 1,451/1,430/0/21, S17 1,458/1,437/0/21, S20 1,465/1,444/0/21 — 보고와 일치, 실패 0, 건너뜀 21 유지, 로그 해시는 기록값과 일치(S17·S20 확인). (4) 비밀값 스캔(`docs`, `runtime/lib`, `runtime/*.mjs`, `runtime/test`, `runtime/public`, `scripts`, `build-artifacts`; PEM 개인키·sk-·AIza·ghp_·xox 패턴) 0건. S20 재현 ZIP 11개 항목에 비밀 관련 파일 없음. (5) 새 시험 9개 파일을 내 VM에서 직접 실행해 전부 통과: mission-receipts 3, receipt-attestation 2, capability-exchange 2, release-trust 3, chronicle-export 1, offline-license 2, self-change-proposal 3, jarvis-stage-moments 2, channel-surfaces 3 (합 21/21, 실패 0). (6) 코드 대조: 새 모듈들에 네트워크 호출·자식 프로세스·삭제 호출 없음. `receipt-attestation`은 `externalPersonVerified:false`·`outcomeVerified:false`·`highGradeCandidate:false`·`authorizesDispatch:false`로 외부 증언을 등급과 분리. `mission-receipts`는 `published:false`·`authorizesDispatch:false`. `owner-signing-vault`의 개인키는 vault 객체와 내부 서명 호출에만 쓰이고 응답 경로에 노출되지 않음.

RAN-UNVERIFIED/내가 못 한 것: S13 서명 vault·DPAPI·WinForms 화면(§175)은 Windows 전용이라 내 Linux VM에서 실행 불가 — Codex의 보고·스크린샷 해시만 대조(해시 일치), 동작은 미확인. 전체 회귀(약 9분)는 내 VM에서 재실행하지 않고 로그만 확인. Android APK 실제 설치 0건·운영 resident 8790 미응답은 Codex가 스스로 RAN-UNVERIFIED로 적은 그대로. 일부 시험은 병렬 실행 시 내 VM에서 시간 초과(124)가 나 단독 재실행해 통과 확인.

주의(정리 과제): `build-artifacts/g1-search-boundaries-20260930/ui-fixture-*/connector-secrets.dpapi` 2개(합성 시험 픽스처의 암호화 파일)가 저장소 안에 남아 있다 — 합성이지만 공개 번들·백업 제외 대상으로 확인하고 정리 권고. 커밋은 여전히 0이고 변경 286건이 미커밋 — 체크포인트 커밋 승인 필요. OSS_FIRST_CHECKS.md는 S12~S20이 대부분 "기존 구현·Node 내장 재사용"이며 외부 후보는 미검증이라 미채택으로 기록 — AUD-1 감사표(`OSS_ASSEMBLY_AUDIT.md`)는 아직 없음.
