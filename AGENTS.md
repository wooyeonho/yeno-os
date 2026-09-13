## 2026-09-13 코드·음성 확장 (최신 구현)

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
