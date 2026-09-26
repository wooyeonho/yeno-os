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
