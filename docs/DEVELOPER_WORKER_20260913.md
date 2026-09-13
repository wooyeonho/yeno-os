# BLACKHOLE repository developer worker

## Current delivery boundary

This change implements a separate repository patch/test/repair worker and a one-model-call patch planning API in the existing core. It does **not** assert that a persistent worker is connected to the live Koyeb service. Runtime status deliberately reports `repositoryDevelopment.runnerConnected:false`; the legacy `developerWorker:false` remains until a real external host is enrolled and verified. No private runtime data, device credentials, provider keys or signing keys are copied to GitHub or test containers. No new provider or paid service is enabled.

## Executable flow

The operator assigns a task contract: immutable base commit, goal, one to four existing editable code paths, optional context paths and existing acceptance test paths. The worker reads tracked source at the exact commit into a disposable snapshot. Model context contains only explicitly selected files (12 KB total) and at most 3 KB failure feedback; it does not send the entire repository, memories or credentials.

`POST /api/developer/plan` (also `/api/v1/developer/plan` for an enrolled device) uses the existing provider and durable daily call ledger. Each plan has one model call, no model tools, a durable request ID, and a validated JSON patch artifact. Source contents are redacted from normal state responses; the existing authenticated artifact and encrypted backup paths preserve the result. Transport uncertainty never silently creates another request.

The external worker copies tracked source without `.git`, untracked files, dotfiles, dependencies or runtime data. It runs the ORIGINAL selected acceptance tests for a baseline, applies the patch to a separate snapshot, and reruns those same tests. On a known failure, it requests one repair against the ORIGINAL hashes; total at most two plan requests. Tests, workflows, package manifests, worker code, authentication, storage, provider/budget logic and runtime entrypoints cannot be modified by generated patches. Existing-file replacement only; arbitrary shell commands, package installation and data migration are not model capabilities.

Docker runs by an already resolved local image ID with no network, read-only source/root filesystem, no host credentials or Docker socket, non-root UID, removed capabilities, process/memory/time/output limits and bounded temporary storage. A Git worktree is not treated as isolation. Dependency-free Node tests work immediately; projects needing dependencies require a separately verified image with those dependencies already installed. The worker never automatically installs model-selected packages. Docker is not a proof against every kernel/container escape; use a disposable host, not the production core.

A successful worker candidate is retained in an external durable journal and can be published as a **draft PR**, never auto-merged. Unknown model/publish outcomes and interrupted in-flight operations hold for reconciliation. Replaying a completed request returns the existing record. The CLI checks core stop/AI state before each stage and polls every two seconds while active; loss of core contact aborts the runner. If container termination cannot be confirmed, the failure states that explicitly. Releasing the global stop does not automatically replay held work.

## Required deployment connections

Run on an isolated Linux developer host with Node 24 and Docker, not the single-process Koyeb production service. The host needs a trusted checkout of `wooyeonho/yeno-os`, a persistent journal directory **outside** the checkout, an installed/pinned Docker test image, and an already approved device credential for the same core. Supply credentials through the host's secret configuration, never as command-line values, task JSON, model prompts or committed files:

- `BLACKHOLE_CORE_ORIGIN`: existing HTTPS core origin.
- `BLACKHOLE_WORKER_DEVICE_TOKEN`: enrolled device credential for that core.
- `BLACKHOLE_WORKER_IMAGE_ID`: local `sha256:...` image ID, not a mutable tag.
- `BLACKHOLE_GITHUB_TOKEN`: repository-scoped write credential only when publishing a draft PR or explicitly promoting/rolling back. This ChatGPT connection's credentials are **not** automatically installed on the runtime host.

Example trusted operator invocation (paths are operator-selected, not model-selected):

```sh
node workers/developer/cli.mjs run --repo /srv/worker/yeno-os \
  --contract /srv/worker/tasks/task.json --journal /srv/worker/journals/task.json --publish
```

Example task structure (replace `baseCommit` with the exact checkout SHA and select the existing project/test paths):

```json
{
  "id": "casebook-improvement-001",
  "baseCommit": "<exact 40-character checkout commit>",
  "goal": "Implement the assigned improvement without changing acceptance tests",
  "editablePaths": ["projects/blackhole-casebook/engine.mjs"],
  "contextPaths": ["projects/blackhole-casebook/engine.test.mjs"],
  "testFiles": ["projects/blackhole-casebook/engine.test.mjs"]
}
```

## Approval, promotion and rollback

`promote --record JOURNAL --approve EXACT_CANDIDATE_SHA --expected-head PRODUCTION_SHA --verification-run RUN_ID` is an operator-only CLI command, unreachable from the model or test container. It requires a successful completed **push** run of `.github/workflows/developer-worker.yml` for the exact candidate, unchanged candidate parent/tree, and unchanged production ref. The production base tree must exactly match the tested base tree. Divergent trees are blocked for review rather than silently overwriting concurrent work. The production ref is advanced without force only after these checks.

The result is `deployment_requested_not_verified`, **not** a live success claim. Koyeb build completion, health, exact running source, compatibility and real device use still require operational verification. `rollback` requires exact operator approval and unchanged production head; it creates a forward code rollback commit and never claims to restore runtime data. New storage-schema migrations are outside the worker scope. Approval receipts and journals must remain outside all candidate-write locations.

## Verification

`npm run test:developer` runs contract, actual temporary-core API/backup/replay, worker fault cases and mocked GitHub promotion/rollback checks. Real Docker checks require `DEVELOPER_DOCKER_REQUIRED=1` and an installed `BLACKHOLE_WORKER_IMAGE_ID`; without that flag they are explicitly skipped, not counted as sandbox proof. The CI workflow enables the flag, tests real broken-code/failure/repair against immutable Node tests, and checks non-root execution, read-only source, missing host secrets/Git metadata and timeout termination.

The CI full core/browser regression runs in a separate networkless read-only container. Verification logs identify the source SHA and local image ID. Synthetic model and GitHub responses are labeled as such; a real provider request and real draft-PR/promotion from an unattended worker are separate acceptance gates.

Technical references: https://docs.docker.com/engine/containers/run/ ; https://docs.docker.com/engine/security/ ; https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax .
