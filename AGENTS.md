## 2026-09-15 실제 브라우저 모바일 viewport 검증 — jsdom으로는 못 잡는 실제 레이아웃 버그를 잡는다

jsdom 기반 UI 시험은 CSS 레이아웃 엔진이 없어 실제 픽셀 단위 겹침·잘림을 검증할 수 없다. `scripts/verify-mobile-viewport.mjs`가 실제 Chromium(Playwright)으로 실제 서버·실제 정적 파일을 360×800·412×915 뷰포트에서 확인하며, 로그인→목표 저장→성장 탭 열기까지 진짜 사용자 흐름을 따라간다. 이 검사가 처음 실행됐을 때 이 브랜치와 무관한 기존 버그(`autopilot-view-engine.mjs`가 `server.mjs` 정적 파일 허용 목록에 없어 실제 브라우저에서 앱 전체가 부팅에 실패)와 이 브랜치의 버그(`growth-view.mjs`가 2열 그리드 클래스 `.cockpit-hero`를 단일 콘텐츠에 잘못 재사용)를 모두 실제로 찾아냈다 — 두 버그 모두 기존 jsdom 검사(`verify-web-ui.mjs`)는 `app.js`를 esbuild로 먼저 번들링해 동적 import를 인라인시키므로 발견할 수 없었다. 이 스크립트는 **기존 강화된 Docker CI 샌드박스 안에서는 실행하지 않는다** — `workers/developer/Verification.Dockerfile`은 `--network none --cap-drop ALL --read-only`로 실행되며 브라우저 바이너리도, 그것을 내려받을 네트워크도 없다. 그 샌드박스에 실제 브라우저를 넣는 것은 별도의 보안 관련 인프라 결정(이 프로젝트의 선언된 능력이 이미 `browserAutomation:false`)이라 임의로 내리지 않았다 — `npm run verify:mobile`로 직접 실행한다. 해당 회귀의 빠르고 결정적인 절반(`.cockpit-hero` 재사용 금지)은 `runtime/test/growth-ui.test.mjs`에도 있어 Docker 샌드박스 안에서 항상 실행된다.

## 2026-09-14 휴대폰 성장 화면 — 현재 퀘스트·호문쿨루스 판단·커비 등급·장부를 한 화면에서

`runtime/public/growth-view.mjs`가 기존 조종석(`app.js`/`index.html`)에 "성장" 탭으로 연결돼 있다. 다른 `*-view.mjs`처럼 순수 표시 모듈이며(`createGrowthView({root,onNavigate,storage})`), 자체 fetch·변경 요청이 없다 — 표시값은 전부 이미 있는 `/api/state`·`/api/quests` 응답에서만 온다. 지어낸 레벨·경험치·퍼센트는 없다. "새로 확인"/"승급" 배지는 이 브라우저가 그 기능 id에 대해 마지막으로 저장해 둔 등급과의 실제 비교 결과이며(앱이 이미 쓰는 기기별 scoped storage 사용), 추정한 최근성 창이 아니다. `runtime/test/growth-ui.test.mjs`가 jsdom 단위 시험(정직한 빈 상태·동기 사유·등급 배지·새로확인/승급 diff·멈춤 퀘스트·XSS 안전성·고정폭 미사용)과 실제 HTTP 왕복 시험(퀘스트 실행 → 실제 성과 기록 → 커비 자동 흡수 → 실제 API 응답으로 렌더 → **재시작 후에도 동일** 확인)을 모두 검증한다.

## 2026-09-14 커비 자동 흡수 — 첫 조각만 구현됨 (`ledger-digest` 기능 하나)

`runtime/lib/kirby.mjs`가 소유자의 수동 `import`/`verify`/`activate` 없이도 커비가 스스로 새 기능을 흡수하게 한다. 실제로 저장된 부·명예·인지도 장부의 숫자 측정값 있는 `outcome`이 존재하고, 이미 저장소에 검토돼 있는 원본(`runtime/capabilities/ledger-digest.json`, 필터·정렬·행 제한만 하는 선언형 기능)이 아직 활성화되지 않았을 때만 흡수를 시도한다 — 목표 문장이나 모델 호출로 후보를 지어내지 않는다. 시도는 `capabilities.mjs`의 기존 `importCapability`→`verifyCapability`(fixture 재실행, 결정적·네트워크 없음)→`activateCapability`를 그대로 통과해야 하며, fixture 시험에 불합격하면 비활성 상태로 정직하게 남고(시도 기록은 지워지지 않는다) 절대 활성화되지 않는다 — 이 비활성 유지 자체가 복구 경로다. `POST /api/outcomes` 직후 자동 트리거되며, 활성화된 뒤에는 `capabilityCandidates()`/`autopilot.mjs`의 허용 목록에 들어가 `failure-triage`/`evidence-gap-brief`와 동일하게 동기 채점 대상이 된다. 아래 "휴대폰 단일 인수 시나리오" 항목의 "능력이 없을 때 커비가 자동으로 후보를 탐색·등록하는 것"은 이 커밋 이전 상태를 기록한 것이며, 지금은 `ledger-digest` 한 종류에 대해서만 그 자동 탐색·등록이 실제로 구현돼 있다.

## 2026-09-14 휴대폰 단일 인수 시나리오 — "정해줘" 왕복이 자동시험으로 통과함 (전체는 아님)

`runtime/lib/decide.mjs`가 음성 "지금 가장 먼저 해야 할 일을 정해줘"를 실제 호문쿨루스 일곱 동기 채점에 연결한다 — 오직 이미 저장된 `status:'proposed'` 목표만 후보로 삼고, 없으면 지어내지 않는다(`decideQuest`가 `null` 반환, `/api/voice`는 일반 대화로 자연 대체). `POST /api/voice`가 이 문구를 감지하면 `decideAndRunQuest()`로 실제 `runQuest()`를 실행하고 선택 이유(`decision.announcement`)를 함께 돌려주며, `voice-view.mjs`가 결과 도착 전에 그 이유를 먼저 읽는다. `runtime/test/phone-acceptance.test.mjs`가 목표 저장 → 정해줘 음성 → 자비스 실행 → 커비 재사용(선언형 기능, 서로 다른 입력 2건) → 성장 등급 반영 → 장부 기록 → **실제 재시작 후 전부 보존**까지 실제 HTTP API로 자동 확인한다.

범위 밖으로 정직하게 남긴 것: 물리 휴대폰·실제 마이크/스피커 검수(브라우저 음성 UI 자체는 기존 것 그대로), 코드형 커비(`code-workshop.mjs`)의 QuickJS 실행 경로(이 컨테이너의 기존 환경 한계라 선언형 커비로 같은 메커니즘을 증명), 능력이 없을 때 커비가 **자동으로** 후보를 탐색·등록하는 것(이번엔 부팅 시 이미 등록된 기능을 재사용했을 뿐).

## 2026-09-14 성장 엔진 (E→D→C→B→A→S) — 첫 조각만 구현됨

`runtime/lib/growth.mjs`가 `capabilities.mjs`/`code-workshop.mjs` 레지스트리의 실제 이력(`활성화`·`run`·`rollback`)만으로 각 기능의 등급을 계산한다. `/api/state`의 `growth.capabilities`/`growth.code`에서 확인한다. D(활성화+실제 실행)와 C(서로 다른 입력에서 재사용, **동일 입력 재실행은 불인정**)는 실제로 판정한다. B(조합과 복구)는 복구만 기록 가능하고 조합을 기록하는 구조가 없어 항상 막힌다. A(개입 횟수 추적 없음)와 S(장부가 `self_reported`만 지원, 외부 검증 경로 없음)도 항상 막힌다 — 이는 결함이 아니라 지금 증명할 수 없는 것을 그대로 보고하는 것이다. 다음 단계는 이 문서에서 이미 여러 차례 정리된 "휴대폰 단일 인수 시나리오"(자비스 음성 → 호문쿨루스 판단 → 자비스 실행 → 커비 처리 → 성장 엔진 판정 → 재실행 후 유지)의 나머지 조각들 — 폰 네이티브 UI, 호문쿨루스 결정 화면, 커비 보유 스킬 목록, 기능 조합 추적, 개입 횟수 추적, 장부 외부 검증 — 이며 이 커밋은 그중 성장 등급 계산 하나만 끝냈다.

## 2026-09-13 저장소 개발 워커 통합 (최신 구현, 3차 정합성·라벨 수정 반영)

`workers/developer/`와 `runtime/lib/repository-patch.mjs`를 우선한다. 저장소 패치 작업(`job.repositoryTask`)은 `independent-core-engine.mjs`에서 `development-model-call`로 분류되며, 코드 생성·수리 모드와 동일하게 명시적 개발 요청에서만 모델을 호출한다. 운영 코어는 Docker 소켓을 갖지 않으며 저장소 시험을 직접 실행하지 않는다. 별도 신뢰 개발 호스트의 `workers/developer/cli.mjs`가 코어의 `/api/developer/plan`에서 받은 계획을 네트워크 없는 비루트 컨테이너에서 시험·최대 1회 수리하고, 승인된 정확한 커밋에서만 GitHub로 승격한다. 모델 패치는 시험·워크플로·인증·예산·워커 자신을 변경할 수 없다.

`editablePath()`(`runtime/lib/repository-patch.mjs`)의 `runtime/lib/`와 `runtime/public/` 판정은 둘 다 차단 목록이 아니라 **허용 목록**이다. `ALLOWED_LIB_FILES`·`ALLOWED_PUBLIC_FILES` 모두 현재 비어 있다 — 개별 보안 검토를 거쳐 명시적으로 등록하기 전까지는 두 디렉터리의 어떤 파일도, 신설 파일을 포함해 모델이 수정할 수 없다. `runtime/public/`은 소유자 브라우저에 그대로 서빙되므로(Docker 시험의 `--network none`은 배포 후 실제 브라우저에서 실행되는 JS의 네트워크 접근과 무관하다) `runtime/lib/`과 동일한 기본 거부가 적용된다.

Docker 기반 시험(패치 실패→1회 수리→재시험, 네트워크 없는 읽기 전용 비루트 컨테이너)은 **GitHub Actions CI에서 실제로 실행되어 통과했다** (`.github/workflows/developer-worker.yml`의 `verify` 잡). 최신 검증 실행 기록은 CHANGELOG.md를 따른다. 로컬 개발 컨테이너에는 Docker가 없어 `DEVELOPER_DOCKER_REQUIRED=1` 시험만 로컬에서 skip되며, 이를 "미검증"으로 적지 않는다 — CI 로그가 실제 증거다.

워커가 실제로 확인한 Docker 시험 결과·후보 커밋·GitHub Draft PR·CI 실행·소유자 승인·승격/롤백은 `workers/developer/cli.mjs`가 **매 단계마다 자동으로** `POST /api/developer/evidence`를 호출해 코어 상태(`job.developerEvidence`)와 암호화 백업에 되돌린다(`CoreGateway.reportEvidence`, `gateways.mjs`의 `dockerEvidenceFrom`/`reportEvidenceDurably`). 이 접수 전까지 저장소 패치 작업의 `repositoryPlan.executionStatus`는 `patch-drafted`일 뿐이며, 실제로 Docker 검증까지 됐다는 뜻이 아니다. 단계는 `patch-drafted → docker-failed|test-adapter-verified|docker-verified → awaiting-ci → awaiting-approval → approved → promoted → rolled-back` 순으로만 전진한다. `docker-verified`는 통과한 시도의 `isolation`이 실제로 `'docker-no-network'`이고 `patchSha256`이 채워져 있을 때만 반환되며(그 값은 아래 문단대로 코어의 실제 저장 아티팩트 해시와 대조된다), 그 밖의 통과(시험용 어댑터, 또는 해시가 아직 없는 경우)는 `test-adapter-verified`로만 표시된다 — 소유자가 승격 판단에 쓰는 라벨과 시험용 라벨은 절대 섞이지 않는다.

evidence 보고 자체가 코어에 닿지 못하고 실패해도(네트워크 단절 등) Docker 시험이나 GitHub 승격/롤백처럼 이미 일어난 사실이 조용히 유실되지 않는다. `reportEvidenceDurably`가 실패한 보고를 `<record>.evidence-pending.json`에 원자적으로 남기고, 같은 `--journal`로 `run`을 다시 실행하면(저널이 이미 종료 상태라 모델·Docker·GitHub 작업은 반복하지 않는다) 그 evidence를 재전송하며, `promote`/`rollback`도 evidence 보고가 실패하면 exit code 1로 정합화가 필요함을 드러낸다(이미 끝난 GitHub 쓰기 자체는 절대 반복하지 않는다). Docker·GitHub 작업 없이 parked evidence만 다시 보내려면 `cli.mjs sync-evidence --pending <path>`를 쓴다. 재전송이 안전한 이유는 `mergeDeveloperEvidence`가 이미 접수된 사실과 동일한 재보고를 충돌이 아니라 멱등 처리로 받아들이기 때문이다.

`/api/developer/evidence`는 소유자 pairing 토큰 또는 `platform:'developer-worker'`로 등록한 기기만 호출할 수 있고(일반 브라우저·기기 토큰은 403), `patchSha256`을 신고하면 코어가 실제로 저장한 패치 아티팩트의 SHA-256과 대조하며, `attempts[].passed`는 신고값을 믿지 않고 `exitCode===0 && !timedOut && !outputOverflow`에서 코어가 직접 계산한다. 롤백 증거는 `{rollbackCommit, revertedPromotionCommit}`로 구분한다 — 실제 `approveRollback()`은 새 forward-revert 커밋을 만들며 그 SHA는 되돌리는 promotion 커밋과 절대 같지 않다. 두 번째 신고부터는 **부분 패치**를 보낼 수 있다(`mergeDeveloperEvidence`) — 이미 접수된 필드는 그대로 두고 새 필드만 보내면 코어가 이전 기록 위에 병합하며, 이미 접수된 사실은 이후 제출로 뒤집거나 지울 수 없다. `promote`/`rollback` CLI 명령이 서로 다른(별도 시점의) 프로세스로 실행되는 실제 운영 방식과 이 부분 패치 방식은 짝을 이룬다.

첫 실제 승격은 `codex`와 운영 배포 브랜치 `yeno-koyeb-pilot`의 트리가 이미 다르기 때문에 `production_base_tree_mismatch`로 반드시 차단된다. 이 조건을 완화하지 않는다 — 대신 연호님이 먼저 검증된 `codex` 트리를 `yeno-koyeb-pilot`에 수동 동기화하고 Koyeb Healthy·운영 데이터 보존을 확인한 뒤에만 첫 승격을 시도한다.

## 2026-09-13 모델 선택형 독립 OS 코어 계약 (최신 구현)

`docs/INDEPENDENT_OS_20260913.md`와 `runtime/lib/independent-core.mjs`를 우선한다. BLACKHOLE의 영속 코어는 모델 공급자나 API 키 없이 부팅·인증·상태 저장·작업 큐·결과 파일·복구·로컬 기능 실행이 가능해야 한다. 모델은 `model-call` 또는 `development-model-call`로 분류된 유한 작업에서만 선택적으로 사용한다. 모든 새 작업 유형은 실행 전 `executionBoundary`에 등록하며, 미등록 유형은 `unclassified`로 실패 폐쇄한다. 로컬 작업을 편의상 모델 경로로 우회하지 않는다. 무키 실제 서버·커비 실행·재시작 복구 회귀 검사를 제거하거나 완화하지 않는다. 아래 코드·음성 확장과 이전 제약도 계속 적용한다.

## 2026-09-13 코드·음성 확장

`docs/CODE_AND_VOICE_20260913.md`와 운영 검증 기록을 우선한다. `codeWorkshop`은 별도 영속 JavaScript 기능 registry이며 기존 declarative capabilities와 프로젝트·인증을 보존한다. 공개 GitHub 선택 파일/라이선스를 고정 커밋으로 가져와 QuickJS WASM에서 실행하고, 지정한 자동 코딩 작업을 최대2모델호출로 작성·시험·수정한다. 모든 시험은2회 재현; 실패한 후보는 활성 버전을 덮어쓰지 않는다. AI 끄기·전체 정지·호출 원장·단일 코드 작업·백업 복원 비활성을 유지한다. 상주 저장소 전체 수정/배포 작업자는 여전히 없으며 legacy `developerWorker:false`는 그 계약을 보존한다; `javascriptWorker:true`가 새 범위다. 음성은 브라우저 인식/합성과 한 번의 맥락 있는 실제 모델 응답이며 마이크·스피커 실기기 검증을 별도로 기록한다. 아래는 이전 이력과 여전히 적용되는 제약이다.

# YENO OS development instructions

## Current product name

The owner renamed the product to **블랙홀 (BLACKHOLE)**. Use this name in new user-facing work. Preserve existing repository paths, API compatibility names, application identifier, token/vault storage names, keys and project IDs during the display-name transition. Read `docs/BLACKHOLE_IDENTITY.md` for canonical project mapping. Smart-glasses SNS is the A02 Yeogie lineage, not a new duplicate project. Product ambition is not evidence of autonomous execution or world-leading performance.

## Role

The owner explicitly assigns development, design and verification to the current Codex session. Do the work directly, keep reports concise, and avoid unnecessary tool/model usage. Do not require a separate AI developer worker as a prerequisite. Act as the dedicated development lead for 연호님의 personal OS. Turn the agreed goal into working code, installable artifacts, and verifiable results. The owner is not a developer and currently uses an Android phone while the Windows laptop is powered off.

Choose a sensible default for routine implementation choices. Continue reversible, authorized implementation and fixes without asking the owner to manage every step. Ask one short question only when a missing account, target, or decision materially blocks the next action. Explain exactly what is needed.

Be explicit about implemented, tested, deployed, and device-verified states. Do not imply that writing a workflow produced an APK or EXE. Do not report a mock model response as a real provider call. Prefer useful implementation to another broad planning document.

## Product

The original portfolio has 49 canonical entries including C00 Master Control. The owner subsequently requested that suitable references become real projects: V11 BLACKHOLE casebook is one additional registered project, with an original offline playable prototype. Preserve the original 49 and this separately identified addition. Read docs/ALL_PROJECTS_AND_SOURCES_20260911.md for all delivery assignments and docs/ALL_SCOPE_VERIFICATION_20260911.json for actual scope-document, registration and test evidence; assignments are not 49 completed products. Use `docs/PROJECT_SCOPE_CORRECTION.md` and the current core registry; GitHub repository names are code/reference locations, never a replacement portfolio. Preserve canonical goals and restart execution from zero. Historical completion labels are not current evidence. The mistaken repository-based batch was cancelled; do not recreate or resume it.

YENO is a personal OS for daily life: Android APK and Windows EXE share identity, memory, goals, durable jobs, results, and owner controls through a persistent core. The first usable flow is: submit a task on the phone, close the app, reopen it, inspect the real result, and pause/resume work. Travel is one use case, not the product boundary.

YENO's interaction design is in `identity/YENO.md`. It is a product specification, not a claim of consciousness or existing implementation.

## Current baseline

`runtime/` now contains the 0.2.2 project/source-management core built on the imported 0.1.1 baseline. The owner's older local 0.2.3 installation is separate. Do not overwrite or silently migrate that installation.

The runtime implements durable source reviews/imports and candidate preparation documents, project registration and briefs, operating status documents, basic memory, deterministic command routing, document/diagnostic jobs, pause/resume/cancel, memory/settings snapshots, and versioned device authentication. The optional ecosystem reader searches six public GitHub topics and stores pinned README/license/SKILL.md evidence; follow docs/ECOSYSTEM_INTAKE.md. Intake never installs/activates a skill or changes existing owner reviews. NVIDIA/Moonshot adapters require real keys and bounded provider verification; API trial availability is not permanent unlimited free hosting. The fixed official-release watcher is implemented in runtime/lib/discovery.mjs; read docs/SOURCE_WATCH.md and actual live evidence before claiming it is enabled. It only registers unread/pending metadata, never model reviews or code execution. The legacy optional AI call produces a draft. A bounded agent loop provides seven read-only tools including cached ecosystem evidence and a verified draft artifact; read docs/AGENT_LOOP.md and current live evidence. Provider configuration is absent until verified, and the loop is not a coding/deployment worker. `apps/controller` contains the native controller source; consult `docs/STATUS.md` for actual build and device verification. The Koyeb core is deployed with a persistent volume; consult the status and live acceptance documents for the exact running source. The owner's Android first enrollment/state connection is evidenced by a screenshot; phone command/artifact/reopen acceptance remains pending. Developer workers, notifications and Windows installers remain pending until evidenced. Operating briefs summarize stored state. Project bots can assign scoped AI draft jobs with up to two concurrent bots, separate optional xAI credentials and durable stop/budget controls; see docs/PROJECT_BOTS.md and live evidence. They are not code-execution workers or the Grok Bot product.

Native mutations now require requestId. The compact requestLedger retains at most 20,000 accepted identities without automatic eviction, separately from the 2,000-entry/2MiB reply cache. Read docs/REQUEST_IDENTITY.md for capacity, replay, recovery and downgrade limits. Client retry changes require a newly built/installed APK; frontend compilation is not APK delivery. Owner-only encrypted full backup export and remote device revocation are implemented. Clean restore uses a fresh directory, startup guard, and runtime lease; it enables global stop, disables AI, pauses unfinished jobs and revokes restored active device credentials. The actual live dataset has been restored in a separate local process. Persistent backup/key upload failed, so do not claim ongoing independent backup storage. Follow `docs/BACKUP_RECOVERY.md` and `docs/LIVE_ACCEPTANCE.md`; never put actual backup data or keys in git.

Read `YENO_START_HERE.md`, `docs/STATUS.md`, and `docs/FIRST_TASK.md` before changing code. Consult `docs/BUILD_DECISIONS.md` for the accepted architecture.

The world observation job and source destination proposals are documented in `docs/WORLD.md` and `docs/ABSORPTION.md`. World reads only the fixed public USGS feed, has no model/key/location requirement, preserves raw-data hashes and bounded snapshots, and participates in stop/restart/backup recovery. `흡수 계획` classifies references; it does not create projects, install tools or claim unseen sources were verified. Keep these distinctions in future work.

## Commands

- Node 24 is the selected starter development runtime.
- Tests for core, controller request handling, and HTTP scope: `npm test` (Node 24).
- Frontend build: `npm run build:controller` after `npm ci --prefix apps/controller --ignore-scripts --no-audit --no-fund`.
- `npm run verify:baseline` and `STARTER_MANIFEST.json` document the original import only; current 0.2.0 changes intentionally differ. Do not use the old manifest as a gate for changed code or revert intentional edits to pass it.
- Local runtime: `npm start -- --no-open`.
- Dependencies are not needed for the existing built-in Node baseline tests. Install and lock dependencies when implementing new components.

The owner authorized automatic Android builds on 2026-09-10. `android-debug.yml` runs for relevant controller/build-input changes pushed to codex and retains manual dispatch. Push builds check out the triggering commit SHA; manual builds use source_ref. Documentation-only changes do not build an APK. Builds remain serial, time-limited to 45 minutes, contents:read only, and publish private artifacts for seven days; they do not install on the phone or deploy the core. It collects a test APK only if compilation succeeds. A workflow file, frontend bundle, or passing Node test is not an APK or device verification. Do not report a workflow run before checking its actual result.

## Implementation constraints

The owner explicitly authorized proactive native operation on 2026-09-12. The separate durable autopilot may select canonical EUREKA research, public world observations, private research-page For-Ai audits and caption MP4 outputs without a new task request, at most four model calls per UTC day within the existing overall limit. Read docs/AUTOPILOT_20260912.md and current live evidence. This does not enable coding workers, publication, outreach, trading, or use synthetic acceptance studio records as owner content. Preserve deterministic stage identities, verified parent artifacts, global-stop and unknown-call holds.

- Keep the first native controller compatible with a deliberately versioned server API. Existing relative `/api` requests and sessionStorage tokens cannot simply be copied into a native app unchanged.
- Implement explicit API origin/base selection, device-scoped authentication and revocation, and operating-system secret storage. Model and signing keys must remain outside client bundles.
- The existing file store is single-process. Do not run multiple control servers against it. Introduce transactional storage with a migration and recovery plan before expanding concurrency.
- Persist job identity before execution and preserve request identity across transport uncertainty. Verify ambiguous external results before retrying writes.
- Global stop must not depend on a model decision. Report whether the stop reached each worker. Releasing the global latch must not silently resume all jobs.
- Keep durable core state separate from disposable development environments. A Git worktree is not a security sandbox. Do not give arbitrary generated code the core's secrets, entire memory, or signing keys.
- Codex Cloud is a development environment; the ongoing YENO core needs a separate persistent host. SDK-driven coding executes where its worker is hosted, and is not an assumed API for starting Codex Cloud chats.
- Current development is performed directly by Codex as requested. A future unattended runtime worker is a separate product capability, not a prerequisite for current coding/design work. Do not add providers or delegate to extra workers contrary to the owner’s instruction. Never present the current session’s actions as unattended core execution.
- Do not silently enable previously disabled provider automation. Follow the owner's current authorization and existing applicable constraints.
- Use fake providers for fault cases, then a bounded real provider verification with configured credentials and budget. Track reservations, settlement, and unknown usage. Do not enable new spending or public deployment without the necessary authorization.
- Event or scheduled work requires an owner-assigned scope. Internal processing of already assigned jobs is distinct from creating new recurring work.
- The owner has now delegated proactive discovery of relevant YENO capabilities, evidence review, deduplicated candidate intake, and reversible prototypes/code/tests within the YENO project once the development environment is connected. Follow `docs/DISCOVERY.md`. Do not repeatedly ask permission for those delegated steps. Verify the scope for operational promotion; do not infer authorization for new spending, expanded permissions, or external publication.
- A separate scheduled research task may maintain `YENO_FEATURE_BACKLOG.md`. It is not evidence that YENO's native runtime can autonomously code, build, or install updates. Keep source-unavailable references pending and never infer unseen social-media content.
- Self-improvement produces tested candidates in a separate environment. Operational promotion and rollback follow the owner's existing authorization and require real compatibility evidence.
- Keep sensitive data, credentials, signing keys, actual runtime data, and private logs out of source and deliverable archives.

## Vault

The owner's Obsidian Vault is not available in this environment unless supplied or explicitly connected. Do not invent its contents. Treat `00_INBOX_RAW` originals as read-only; do not propose deletion or overwriting. Read and classify first. Propose new drafts in `01_DRAFTS`. Apply links/classification only after 우연호님 approval. Record applied work in `CHANGELOG.md`.

## Reporting

Report the result first: changed behavior, evidence from actual checks, material limitations, and one next action. Distinguish build success, installation success, device behavior, and readiness for daily use. The source, data, and recovery path should remain under the owner's control.
