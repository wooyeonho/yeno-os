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
