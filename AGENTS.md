## 2026-09-13 저장소 개발 워커 통합 (최신 구현, 2차 보안·연결 수정 반영)

`workers/developer/`와 `runtime/lib/repository-patch.mjs`를 우선한다. 저장소 패치 작업(`job.repositoryTask`)은 `independent-core-engine.mjs`에서 `development-model-call`로 분류되며, 코드 생성·수리 모드와 동일하게 명시적 개발 요청에서만 모델을 호출한다. 운영 코어는 Docker 소켓을 갖지 않으며 저장소 시험을 직접 실행하지 않는다. 별도 신뢰 개발 호스트의 `workers/developer/cli.mjs`가 코어의 `/api/developer/plan`에서 받은 계획을 네트워크 없는 비루트 컨테이너에서 시험·최대 1회 수리하고, 승인된 정확한 커밋에서만 GitHub로 승격한다. 모델 패치는 시험·워크플로·인증·예산·워커 자신을 변경할 수 없다.

`editablePath()`(`runtime/lib/repository-patch.mjs`)의 `runtime/lib/`와 `runtime/public/` 판정은 둘 다 차단 목록이 아니라 **허용 목록**이다. `ALLOWED_LIB_FILES`·`ALLOWED_PUBLIC_FILES` 모두 현재 비어 있다 — 개별 보안 검토를 거쳐 명시적으로 등록하기 전까지는 두 디렉터리의 어떤 파일도, 신설 파일을 포함해 모델이 수정할 수 없다. `runtime/public/`은 소유자 브라우저에 그대로 서빙되므로(Docker 시험의 `--network none`은 배포 후 실제 브라우저에서 실행되는 JS의 네트워크 접근과 무관하다) `runtime/lib/`과 동일한 기본 거부가 적용된다.

Docker 기반 시험(패치 실패→1회 수리→재시험, 네트워크 없는 읽기 전용 비루트 컨테이너)은 **GitHub Actions CI에서 실제로 실행되어 통과했다** (`.github/workflows/developer-worker.yml`의 `verify` 잡). 최신 검증 실행 기록은 CHANGELOG.md를 따른다. 로컬 개발 컨테이너에는 Docker가 없어 `DEVELOPER_DOCKER_REQUIRED=1` 시험만 로컬에서 skip되며, 이를 "미검증"으로 적지 않는다 — CI 로그가 실제 증거다.

워커가 실제로 확인한 Docker 시험 결과·후보 커밋·GitHub Draft PR·CI 실행·소유자 승인·승격/롤백은 `workers/developer/cli.mjs`가 **매 단계마다 자동으로** `POST /api/developer/evidence`를 호출해 코어 상태(`job.developerEvidence`)와 암호화 백업에 되돌린다(`CoreGateway.reportEvidence`, `gateways.mjs`의 `dockerEvidenceFrom`). 이 접수 전까지 저장소 패치 작업의 `repositoryPlan.executionStatus`는 `patch-drafted`일 뿐이며, 실제로 Docker 검증까지 됐다는 뜻이 아니다. 단계는 `patch-drafted → docker-failed|docker-verified → awaiting-ci → awaiting-approval → approved → promoted → rolled-back` 순으로만 전진한다.

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
