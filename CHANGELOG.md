# 2026-09-13 — evidence 보고 실패의 정합성 확보, docker-verified 라벨 정확성 수정

- **버그 수정 (정합성)**: `workers/developer/cli.mjs`의 `reportEvidence()`가 코어 전송 실패를 `console.error` 경고만 남기고 삼켜, Docker 검증이나 GitHub 승격/롤백이 실제로 성공한 뒤 evidence 보고만 실패해도 CLI가 성공으로 종료했다. 같은 저널을 다시 실행해도 이미 끝난 작업(`runDeveloperTask`가 조기 반환)이라 `core.lastJobId`가 다시 설정되지 않아 실패한 evidence가 자동 재전송되지 않았다 — 외부 저널과 코어 상태가 영구히 어긋날 수 있었다.
  - `workers/developer/gateways.mjs`에 `reportEvidenceDurably(core, jobId, evidence, pendingPath, signal)`를 추가했다. 전송에 실패하면 `{jobId, evidence}`를 `<record>.evidence-pending.json`에 원자적으로 기록하고, 성공하면 그 파일을 지운다. `mergeDeveloperEvidence`는 이미 접수된 사실의 재전송을 그대로(모순 없이) 받아들이므로, "요청은 갔는데 응답을 못 받은" 모호한 실패도 안전하게 재시도할 수 있다.
  - `cli.mjs`의 `run` 모드는 이제 `core.lastJobId`가 이번에 새로 설정되지 않았어도 저널에 이미 저장된 `jobId`를 읽어 evidence 재전송을 시도한다 — 같은 `--journal`로 재실행해도 모델·Docker·GitHub 작업은 반복하지 않고(저널이 이미 종료 상태면 `runDeveloperTask`가 그대로 조기 반환) evidence만 다시 보낸다. `promote`/`rollback`도 evidence 보고 실패 시 exit code 1로 종료해 "GitHub 쓰기는 성공했지만 코어에 안 알려짐" 상태를 명시적으로 드러낸다(단, 이미 성공한 GitHub 쓰기 자체는 절대 반복하지 않는다).
  - 별도 `sync-evidence --pending <path>` 명령을 추가했다. Docker나 GitHub를 전혀 건드리지 않고 parked evidence만 재전송한다 — `run`/`promote`/`rollback` 재실행이 아닌 경로로도 정합화할 수 있다.
  - `workers/developer/gateways.test.mjs`에 `reportEvidenceDurably`의 실패→park→재전송→정리 경로와, park된 evidence를 그대로 재전송하는 것이 `mergeDeveloperEvidence`에서 충돌이 아니라 멱등 처리됨을 확인하는 시험을 추가했다.
- **버그 수정 (라벨 정확성)**: `developerEvidenceStatus`가 `attempts.some(a=>a.passed)`만으로 `docker-verified`를 판정해, `isolation`이 `'synthetic-test-adapter'`(테스트용 가짜 러너)여도, 혹은 `patchSha256`이 아직 `null`이어도 진짜 Docker 검증과 동일하게 표시됐다. `docker-verified`는 이제 (1) 통과한 시도 중 `isolation === 'docker-no-network'`인 것이 있고 (2) `patchSha256`이 채워져 있을 때만(그 값은 `/api/developer/evidence`에서 이미 코어의 실제 저장 아티팩트 해시와 대조됨) 반환한다. 그 밖의 통과(가짜 어댑터, 또는 해시가 아직 없는 경우)는 새 상태 `test-adapter-verified`로 구분해, 소유자가 실제로 승격 판단에 쓸 수 있는 라벨과 시험용 라벨이 절대 섞이지 않게 했다.
  - `runtime/test/repository-patch.test.mjs`에 회귀 시험을 추가하고, `workers/developer/core-integration.test.mjs`의 synthetic 경로(진짜 Docker가 아님을 스스로 명시하는 어댑터) 기대값을 `test-adapter-verified`로 바로잡았다(`DEVELOPER_DOCKER_REQUIRED=1`로 실행되는 실제 Docker 경로는 여전히 `docker-verified`를 기대한다).
- 전체 회귀: 로컬 476개 중 444 통과, 25 실패(이전과 완전히 동일한 사전 환경 한계 — WASM 샌드박스·UI DOM·Node 네이티브 전역 부재), 7 건너뜀. `npm run test:developer` 78개 중 75 통과, 3 건너뜀(로컬 Docker 부재).

# 2026-09-13 — runtime/public 잠금, evidence 실제 연결과 신뢰 경계 수정

- **보안 수정**: `runtime/public/`도 `runtime/lib/`과 같은 기본 거부형 허용 목록(`ALLOWED_PUBLIC_FILES`, 현재 빈 목록)으로 바꿨다. 이전 수정은 `runtime/lib/`만 잠갔고 `runtime/public/`은 여전히 전체 허용이어서, 모델 패치가 브라우저에 그대로 서빙되는 `app.js`·`web-client.mjs`·`device-connect.mjs`·`sw.js` 등을 바꿔 승인 버튼의 실제 동작이나 인증된 세션의 요청 대상을 변조할 수 있었다. Docker 시험의 `--network none`은 배포 후 브라우저에서 실행되는 JS와는 무관하다.
- **연결**: `POST /api/developer/evidence`가 라우트만 있고 실제로 호출하는 코드가 없었다. `workers/developer/gateways.mjs`에 `CoreGateway.reportEvidence()`와 (run() 저널에서 evidence를 만드는) `dockerEvidenceFrom()`을 추가하고, `workers/developer/cli.mjs`의 `run`/`promote`/`rollback` 각 단계가 끝날 때마다 이를 자동 호출하도록 연결했다. `core-integration.test.mjs`에 실제 HTTP 코어에 대해 이 경로를 그대로 실행하는 검사를 추가했다 — 검사 코드가 evidence 객체를 직접 만들어 API를 호출하는 대신, CLI가 실제로 실행하는 함수를 그대로 호출한다.
- 이 과정에서 별도의 실제 버그를 발견해 수정했다: 코어가 패치 아티팩트를 `JSON.stringify(patch, null, 2)`(들여쓰기 포함)로 저장했지만, 워커와 GitHub 게이트웨이는 어디서나 들여쓰기 없는 `JSON.stringify(patch)`로 `patchSha256`을 계산하고 있어 evidence의 patchSha256 검증이 실제로는 항상 실패하는 상태였다. 코어의 저장 형식을 들여쓰기 없는 쪽으로 맞췄다.
- **신뢰 경계 강화**: (1) `/api/developer/evidence`는 소유자 pairing 토큰 또는 `platform:'developer-worker'`로 등록한 기기만 호출 가능(일반 브라우저·다른 기기는 403). (2) 신고된 `patchSha256`을 코어가 실제로 저장한 아티팩트 SHA-256과 대조. (3) `attempts[].passed`는 신고값을 그대로 믿지 않고 `exitCode===0 && !timedOut && !outputOverflow`에서 코어가 직접 계산 — 모순된 조합(`exitCode:1, timedOut:true, passed:true` 등)을 구조적으로 통과시키던 문제를 막았다.
- **버그 수정**: `mergeDeveloperEvidence`가 `patchSha256`·`candidateCommit`을 항상 완전히 동일해야 한다고 요구해, 실제 워커 순서(Docker 검증 완료 시점엔 이 값들이 아직 없고, GitHub 후보 생성 이후에야 채워짐)에서 두 번째 보고가 무조건 `evidence_conflict`로 거부됐다. null → 값 채움은 허용하고, 값이 채워진 뒤에만 그 값을 고정하도록 고쳤다. 또한 두 번째 보고부터는 전체 evidence가 아니라 **새 사실만 담은 부분 패치**를 보낼 수 있도록 계약을 바꿔, 서로 다른 시점에 실행되는 별도 프로세스인 `promote`/`rollback` CLI 명령이 원래 저널 전체를 다시 알 필요가 없게 했다.
- **버그 수정**: 롤백 evidence 스키마가 `rollback.sourceCommit === promotion.sourceCommit`을 요구했지만, 실제 `approveRollback()`은 되돌리는 대상과 다른 **새 forward-revert 커밋**을 반환한다 — 즉 실제 롤백은 항상 이 검사에 걸려 거부됐을 것이다. `{rollbackCommit, revertedPromotionCommit}`로 필드를 분리하고 `rollbackCommit !== revertedPromotionCommit`, `revertedPromotionCommit === promotion.sourceCommit`을 요구하도록 고쳤다.
- 전체 회귀: 로컬 475개 중 443 통과, 25 실패(이전과 완전히 동일한 사전 환경 한계), 7 건너뜀. `npm run test:developer` 75개 중 72 통과, 3 건너뜀(로컬 Docker 부재).
- 이 커밋에 대한 실제 GitHub Actions 검증: run `34758673800`, head `b15dd8732a780babdf97fbcfac8e48d69158cf07`, conclusion success, artifact `10318068791` / SHA-256 `8bedd52c681cc4e837bd0cae06c5909b29e70df20448c1e193a5d00901f5bf83`. 이번에도 네트워크 없는 읽기 전용 비루트 컨테이너에서 실패→1회 수리→재시험 경로를 포함한 실제 Docker 시험이 통과했다.

# 2026-09-13 — 저장소 편집 허용 목록 보안 수정과 Docker 검증 기록 정정

- **보안 수정**: `runtime/lib/repository-patch.mjs`의 `editablePath()`가 `runtime/lib/` 아래 파일을 차단 목록(`PROTECTED`) 방식으로 걸러 실제로는 최신 `agent-engine.mjs`, `independent-core.mjs`/`independent-core-engine.mjs`, `job-view-engine.mjs`, `provider-config-engine.mjs`, `motivation.mjs`, `quests.mjs`, `capabilities.mjs`가 목록에서 빠져 있었다. 즉 모델이 작성한 패치가 모델 호출 방화벽·호문쿨루스 평가식·부명예인지도 장부 판정·기능 검증 로직을 직접 수정할 수 있는 상태였다. `runtime/lib/`을 기본 거부형 허용 목록(`ALLOWED_LIB_FILES`, 현재 빈 목록)으로 바꿔 신설 파일을 포함한 모든 `runtime/lib/*`가 개별 검토 전까지 기본 차단되도록 했다. 위 7개 파일과 임의의 미래 파일(`runtime/lib/future-policy.mjs`)을 거부하는 회귀 시험을 추가했다.
- `POST /api/developer/evidence`를 추가해 신뢰 개발 호스트가 실제로 확인한 Docker 시험 결과·후보 커밋·GitHub Draft PR·CI 실행 결론·소유자 승인·승격/롤백 커밋을 코어 상태(`job.developerEvidence`)와 암호화 백업에 되돌린다. `mergeDeveloperEvidence`는 이미 접수된 사실을 이후 제출로 뒤집거나 지울 수 없게 하고, `developerEvidenceStatus`는 `repositoryPlan.executionStatus`를 `patch-drafted → docker-failed|docker-verified → awaiting-ci → awaiting-approval → approved → promoted → rolled-back`로 명확히 구분해 패치 초안과 실제 검증 완료를 더 이상 같은 상태로 섞지 않는다.
- **기록 정정**: 앞선 통합 커밋의 "Docker 기반 시험 미수행" 기록은 부정확했다. 실제로는 PR #4의 GitHub Actions `verify` 잡이 진짜 Docker(네트워크 없는 읽기 전용 비루트 컨테이너, `DEVELOPER_DOCKER_REQUIRED=1`)로 실패→1회 수리→재시험 경로를 포함해 통과했다: run `34755163501`, head `80f7574d869cab970a93ed1a32bf82b3e325d6f6`, conclusion success, artifact `10316922073` / SHA-256 `07c5ccdeda4b46353f5a7cd9eb4336f2f36ea4ae1f4856aed1097ee4eb05f1af`. 이 세션의 로컬 컨테이너에는 Docker가 없어 관련 3개 시험만 로컬에서 skip된다.
- `codex`와 배포 브랜치 `yeno-koyeb-pilot`의 트리가 이미 다르므로(`254b4515...` vs `d55420d5...`) 첫 실제 승격은 기존 `production_base_tree_mismatch` 안전 조건에 그대로 막힌다. 이 조건은 약화하지 않았다 — 대신 운영 트리를 먼저 수동으로 정렬해야 한다는 필요조건으로 AGENTS.md에 남겼다.
- 전체 회귀: 로컬 466개 중 434 통과, 25 실패(모두 기존 환경 한계 — WASM/QuickJS 샌드박스, Node 24 전용 전역 객체 부재 — 로 이전과 완전히 동일), 7 건너뜀. `npm run test:developer` 65개 중 62 통과, 3 건너뜀(로컬 Docker 부재; CI에서는 위 run에서 실제로 통과).

# 2026-09-13 — 저장소 개발 워커를 독립 코어에 통합

- `blackhole/developer-worker-20260913`(PR #2)의 저장소 패치 작업자(`runtime/lib/repository-patch.mjs`, `workers/developer/*`)를 최신 `codex` 기준으로 다시 연결했다. PR #2 이후 `agent.mjs→agent-engine.mjs`, `job-view.mjs→job-view-engine.mjs`, 그리고 새 `independent-core(-engine).mjs` 모델 호출 방화벽이 추가돼 있어 단순 병합이 아니라 새 위치에 다시 연결했다.
- 저장소 패치 작업(`job.repositoryTask`)을 `independent-core-engine.mjs`에서 코드 생성·수리와 같은 `development-model-call`로 분류해, 배경 자동 실행이 아닌 명시적 개발 요청에서만 모델을 호출하도록 했다.
- `blackhole/`(별도 실험용 Seven Drives MVP, PR #3)는 이번 통합에 포함하지 않았다. 같은 `codex` 코어에 이미 더 엄격한 wealth/honor/fame 장부(`runtime/lib/quests.mjs`)와 해시·픽스처 기반 코드/기능 검증·승급 체계(`runtime/lib/capabilities.mjs`, `runtime/lib/code-workshop.mjs`)가 있어, PR #3의 자체 서버·상태 파일·자기신고형 boolean 검증 코드를 옮기면 오히려 더 약한 두 번째 BLACKHOLE가 생긴다고 판단했다.
- Node 24 로컬 회귀: 기존 `npm test`(Docker 불필요) 전체와 신규 `runtime/test/repository-*.test.mjs`, `workers/developer/gateways.test.mjs`를 실행했다. `workers/developer/worker.test.mjs`·`core-integration.test.mjs`의 실제 Docker 필요 검사(`DEVELOPER_DOCKER_REQUIRED=1`)는 이 환경에 Docker가 없어 실행하지 못했다.
- Koyeb 운영 배포, GitHub 실제 승격, 실제 유료 모델 호출은 이번 통합에서 수행하지 않았다. `yeno-koyeb-pilot`과 운영 데이터는 변경하지 않았다.

# 2026-09-12 — 목표 실행 운영 배포와 실제 Gemini 결과

기존 Koyeb 서비스에 f98cfa4c 배포568d3cc3의 Healthy/Active를 확인했다. Gemini 목표1개·모델호출1회로 5,142바이트 대본 결과를 실제 생성했다. 기존 데이터 보존·동일 요청 동일 작업·공개 HTTPS 다운로드200·SHA-256 일치를 검증했다. 하루4회 상한과 자동 검토off 유지. 호출 상한 도달·두 번째 모델과 폰 실기기 미검증을 상태 기록에 명시했다. 새 결제·호출 상한 확대·APK 재설치·실제 게시 없음.

# 2026-09-12 — 실제 목표 실행·교차 검토

첨부 전략의 일곱 욕망과 성과 기록을 기존 코어 작업/요청 원장/결과 해시에 연결했다. 제공자별 선택과 개별 호출·시간 제한, 전역 자동화 설정을 보존하는 실행 권한, 목표·성과 백업/복구, 모바일 웹 UI와 기존 앱 명령을 추가했다. 202개 로컬 검사와 모의 DOM 검증을 통과했다. 실제 운영 결과는 docs/STATUS.md에서 구분한다.

# 2026-09-12 AI 작성의 primary 호출 원장 우선

- primary와 legacy가 함께 준비됐을 때 신규 AI 작성이 legacy를 우선하던 경로를 수정했다. primary의 호출 예약·일일 상한·불명확 응답 보존을 사용하며 모델 표시도 일치한다.
- 합성 공급자 정상/불명확 응답, 디스크 재시작, 같은 요청 재사용, 상한 거부, legacy fallback 미실행 검사2개 추가. 전체174/174 통과.
- 기존 legacy-only와 과거 작업은 유지. 운영 배포·실제 모델 연결·키 발급·새 APK는 수행하지 않았다. 상세 `docs/RESUME_AI_ROUTING_20260912.md`.

# Android 앱 변경 자동 빌드

- 소유자의 2026-09-10 요청에 따라 codex의 앱/빌드 입력 변경에서 검사·APK 빌드·아티팩트 업로드를 자동 시작하도록 추가했다. 문서 변경은 제외한다. 수동 실행은 유지한다.
- 자동 빌드는 트리거 SHA를 체크아웃하고, 성공한 실행 요약에 APK 다운로드·소스·해시를 표시한다. 동시1개·45분·7일 보관·contents:read를 유지한다. 폰 설치나 코어 배포를 자동 완료로 표시하지 않는다.
- 로컬 YAML/분기 입력 검증과 요약 생성 fixture를 통과했다. 실제 자동 실행·컴파일 결과는 docs/STATUS.md에 따로 기록한다.

# 0.2.2 지속 요청 식별자와 재시도 보완

- native API 쓰기에 저장된 요청 ID를 요구하고, 기존 응답 캐시와 별도로 최대 20,000개 접수 식별자를 자동 삭제 없이 보존한다. 응답은 2,000개·2MiB로 제한한다.
- 캐시에서 빠진 요청도 같은 결과 ID로 조회/재시도한다. 결과 복구 불가 시 410으로 재실행을 막는다. 새 ID의 용량 초과는 실행 전 507이며 전체 멈춤·기기 폐기는 유지한다. 자기 기기 폐기는 인증된 기기 ID까지 지문에 결합한다.
- 원장이 없는 상태/백업은 보존형 이전을 지원한다. 원장 이전에 이미 지운 ID와 ID 없는 legacy 쓰기는 보장 범위 밖이다.
- 웹 및 native 소스는 인증 실패·응답 소실 뒤 요청 ID를 유지한다. 새 native APK 설치와 코어 배포는 별도다. 실제 결과는 `docs/LIVE_ACCEPTANCE.md`, 상세 계약은 `docs/REQUEST_IDENTITY.md`를 따른다.

# 0.2.2 암호화 백업·독립 복원·분실 기기 차단

- 소유자 전용 백업 API와 관리 CLI를 추가했다. 전체 상태·실제 참조 결과를 AES-256-GCM으로 암호화하고 복호화·파일 해시·경로·크기 검증 후 새 디렉터리에 복원한다. 비밀 원문 키·환경 변수·잠금 파일은 백업에 넣지 않는다.
- 복원은 전체 멈춤·미완료 작업 일시정지·AI 끄기·기존 기기 토큰 폐기를 기본으로 한다. 복원 잠금과 실패 표식으로 불완전한 디렉터리의 시작을 거부한다.
- 소유자가 기기 목록을 조회하고 분실 기기 하나를 원격 폐기할 수 있다. 기존 기기 자기 폐기는 유지하고 관리자 경로는 기기 bearer에 허용하지 않는다.
- 실제 HTTP 문서 생성 → 암호화 다운로드 → 새 디렉터리 복원 → 새 코어 결과 조회·같은 요청 ID 확인, 손상·잘못된 키·경로·용량·디스크 실패를 검사한다. 실제 실행 수치·배포·운영 데이터 복원 증거는 `docs/LIVE_ACCEPTANCE.md`를 따른다.
- 전체 출시 조건은 아직 미충족이다. `docs/RELEASE_READINESS.md`에 실기기·개발 작업자·요청 식별자·서명·외부 사용자 분리 등의 남은 조건을 기록했다. 자동 주기 백업과 운영 서버 자동 복구를 구현한 것은 아니다.

# 0.2.2 운영 브리핑 — 실제 저장 상태와 다음 행동 확인

- 기존 APK에서 `운영 브리핑`·`운영 현황` 명령으로 작업·진행 프로젝트·다음 작업·자료 검토·연결 범위를 실제 문서로 확인한다.
- 생성 시점의 상태와 재조회 시점의 상태를 구분하고 같은 요청 재전송·재시작에서 기존 결과를 보존한다. 본문·인증 필드는 복사하지 않고 메타데이터와 출력 길이를 제한한다.
- 사용자 캡처의 `코어 응답 확인됨`, revision 73으로 Android 최초 등록·상태 조회를 확인했다. 폰 명령·결과·앱 종료/재실행은 아직 별도 실사용 확인이 남아 있다.
- 운영 방향은 YENO 한 프로젝트에 집중하고, 검증된 실행 절차와 실제 반복 사용을 축적하는 것으로 정리했다. 신규 고객·매출·자율 개발 실행 달성을 주장하지 않는다.
- 실행·배포 증거는 `docs/STATUS.md`, `docs/LIVE_ACCEPTANCE.md`에 기록한다.

# 0.2.2 호환성 수정 — Android 최초 연결 Origin 오류

- 사용자 실기기 캡처의 `Origin does not match Host`를 실제 HTTPS에서 같은 native Origin으로 재현했다. 기존 API 검사에서 Origin 헤더를 빠뜨려 APK 통신과의 차이를 놓친 회귀다.
- 잠긴 HTTP 플러그인이 보내는 정확한 `http://tauri.localhost`를 `/api/v1/`에 한해 허용한다. Host 검사, 기기 등록 키와 기기 bearer 인증, 기존 웹 출처 제한을 유지한다. wildcard CORS·모든 localhost 허용·키 교체는 하지 않는다.
- 실제 APK의 Origin을 포함한 등록·문서 생성·결과·재시작·폐기와 거부 경계를 회귀 검사에 추가한다. 기존 APK 재빌드는 필요하지 않으며 폰의 연결 완료는 소유자 확인 전까지 미검증이다.
- 정확한 실행 검사·배포 증거는 `docs/ANDROID_ORIGIN_FIX.md`에 기록한다.

# 0.2.2 — 출처를 보존하는 개선 자료 접수

- 전체 63/63 검사 통과. 실제 Koyeb 빌드·76개 자료 등록·결과 생성·재시작 보존과 20개 프로젝트의 업그레이드 보존 검사 완료. 상세 증거는 `docs/LIVE_ACCEPTANCE.md`.
- 저장 실패 뒤 미저장 영수증/조회 결과를 성공으로 반환하지 않도록 재저장 게이트 추가.

- 자료 등록·검토·프로젝트 연결과 원자적 JSON 가져오기. 내용 확인 상태와 채택 판단 분리.
- 미확인 자료의 개선 후보 승격 제한, URL 중복·버전 충돌·요청 재전송 보존.
- 기존 APK 명령으로 자료 목록·브리핑·개선 후보 준비서 생성. 웹 자료 화면 추가.
- 실행 검사·배포 상태는 `docs/STATUS.md`와 `docs/LIVE_ACCEPTANCE.md`에서 구분한다.

# 변경 기록

## 2026-09-09 — 프로젝트 관리 0.2.1 구현·검사와 Supabase 비용 축소

- 프로젝트 등록·수정·버전 충돌 처리와 프로젝트별 실제 문서 결과를 추가했다. 기존 API 1 및 Android 명령 응답을 유지한다.
- 웹 프로젝트 화면, 기기 재인증 뒤에도 보존되는 요청 ID, 보류/보관과 외부 서버 상태의 구분을 구현했다. 개발 작업자는 미연결로 표시한다.
- 긴 목록, 잘못된 저장 레코드, 유니코드 이름 정규화와 응답 유실 경계 오류를 수정했다. Node 24.19.0 전체 검사 55/55 통과, 실패·취소·건너뜀 0, 14.507초. 화면·서버·프로젝트 모듈 구문 검사도 통과했다.
- hankki-anbu를 기존 Free 조직으로 이전했다. 같은 프로젝트 ID·ACTIVE_HEALTHY·테이블/뷰/함수 개수와 함수 정의 해시를 확인했다. DB 삭제·일시정지는 하지 않았다. Vercel Pro는 유지했다.
- 이 커밋 시점에는 새 프로젝트 기능의 Koyeb 배포·실제 등록·서버 재시작 시험이 남아 있다. 이후 실제 결과는 LIVE_ACCEPTANCE에 추가한다. 기존 APK를 다시 빌드하거나 Android 실기기 시험을 한 것은 아니다.

## 2026-09-09 — YENO 실제 상주 배포·재시작 검증과 Gyeol 일시정지

- 승인된 Micro 서버와 1 GB 전용 볼륨, 암호화 Secret 참조로 YENO를 실제 Koyeb에 배포했다. Docker 이미지 빌드와 HTTPS 코어 기동 성공.
- 실제 기기 등록·문서 생성·결과 해시·동일 요청 중복 방지, 이전 이미지로 재시작 후 동일 인증/작업/결과 보존을 확인했다. 시험 기기만 폐기하고 401을 확인했다.
- 기존 Gyeol 실행기는 소유자 승인으로 Pause, 실행 0개를 확인했다. 기존 DB·서비스·환경값은 삭제하지 않았다.
- Supabase 실제 청구 주기 누적 $30.97/예상 $49.46, Vercel 예정 $20을 확인했다. 두 서비스 구독·데이터 변경은 없다.
- 소유자 개인 연결 안내를 별도로 전달하며 비밀값을 소스에 넣지 않았다. Android 실기기 연결과 실제 AI 호출은 여전히 남은 검증이다.
- 이번 단계는 운영 배포/실검사와 문서 변경이며 기존 로컬 46/46 검사를 새 실행으로 재표시하지 않는다. 자세한 증거는 `docs/LIVE_ACCEPTANCE.md`.

## 2026-09-09 — 기존 Supabase·Vercel 재사용과 비용 감사

- 소유자의 요청에 따라 새 Koyeb 생성을 보류하고 기존 구독을 먼저 확인했다. Supabase Pro 프로젝트 3개의 크기·건수·활동 메타데이터와 Vercel Pro 실제 청구 화면을 읽었다.
- Vercel 연결 도구의 빈 목록과 실제 프로젝트 목록의 불일치, 같은 저장소를 쓰는 배포 후보, Supabase의 주기적인 tick과 실제 작업 활동 차이를 구분해 기록했다.
- 기존 Koyeb Gyeol이 담당하는 자동 작업과 Supabase/Vercel 의존성을 실행 중 커밋 기준으로 확인했다. 최신 main을 현재 운영 버전으로 오인하지 않았다.
- `docs/HOSTING_REUSE_AUDIT.md`에 재사용·휴면 검토·요금제 조건·복원 순서를 기록했다. Supabase Pro 프로젝트는 직접 Pause할 수 없다는 공식 조건을 반영했다.
- 서비스 중지·삭제, 구독 취소·변경, DB 이전, cron 변경, 새 리소스 생성은 실행하지 않았다. 이번 문서 변경에 새 코드 검사는 추가하지 않았으며 기존 46개 통과 기록과 구분한다.

## 2026-09-09 — 기존 Koyeb 계정 확인과 별도 YENO 후보

- 소유자 로그인과 YENO 저장소 선택 가능 상태를 확인했다. 기존 Gyeol 서비스의 소스·환경값·운영 배포는 변경하지 않았다.
- Koyeb 전용 Dockerfile/시작 경로와 정확한 hostname·port 설정, 실제 마운트/쓰기 권한 검증을 추가했다. 기존 Render와 공용 Docker 실행은 유지했다.
- 전체 Node 검사 46/46 통과, 실패·건너뜀·취소 0, 14.388초. shell/Node 구문 검사 통과. 실제 프로세스·인증·문서 결과·SIGKILL 복구를 실행했고 양성 마운트와 EACCES는 fixture임을 명시했다.
- 별도 Micro 서버·1 GB 볼륨 후보와 월 $5.36 서버 견적, 볼륨 preview 한계를 `docs/KOYEB_SETUP.md`에 기록했다. 실제 Docker/Koyeb/폰 연결은 남은 검증이다.
- YENO 서비스·볼륨·비밀값 생성과 새로운 결제·운영 배포는 실행하지 않았다. Render 후보는 보류했다.

## 2026-09-09 — 첫 실제 Android APK와 상주 코어 복구 후보

- 실제 CI 시도 3에서 Android ARM64 APK 생성·업로드에 성공했고 파일 해시·ZIP 무결성·native library를 확인했다.
- 서로 충돌하던 Tauri 내부 패키지를 release lock 기준으로 고정했다. 로컬 Rust 의존성 해결에 성공했고 성공한 CI의 Cargo.lock이 등록 파일과 일치했다.
- 영속 볼륨과 비밀 파일, 조용한 시작 경로, 단일 프로세스 컨테이너 구성을 준비했다.
- 실제 독점 flock을 검증하는 컨테이너 잠금으로 PID 재사용에 따른 crash 재시작 문제를 수정했다. 기존 PID 잠금은 임의로 삭제·우회하지 않는다.
- 강제 종료·재시작·데이터 보존 등을 포함해 로컬 검사 39개 통과. 실제 Docker 호스트·폰 연결·유료 모델·Windows 빌드는 아직 미검증이다.

## 2026-09-09 — 실제 Cargo 의존성 충돌과 기본 아이콘 누락 수정

- 두 번째 빌드는 SDK/NDK·Rust 설치를 통과했지만 HTTP 플러그인의 Tauri 최소 버전 조건에서 실패했다.
- 실제 배포된 crate 의존성으로 재확인해 Tauri를 2.8.2로 맞췄다. tauri-build 2.4.0과 JS API 2.8.0은 유지한다.
- 네이티브 컴파일 시 필요한 기본 PNG 아이콘을 SVG 원본과 Tauri CLI로 생성하고 설정에 명시했다.
- 이 수정의 완료 판정은 실제 CI 재실행 결과로 확인한다.

## 2026-09-09 — 첫 APK CI의 SDK 준비 실패 수정

- 첫 GitHub 빌드 실행에서 코어·명령 검사 30개와 화면 빌드 성공을 확인했다.
- Android 준비 단계의 `sdkmanager: command not found`를 확인해 SDK 설치·PATH 등록 action을 추가하고 확인한 커밋과 도구 버전을 고정했다.
- 수동 트리거·45분 제한·비공개 결과물 수집 구조를 유지하고 새 실행 안내를 갱신했다. 수정 이후 APK 컴파일 성공은 아직 검증하지 않았다.

## 2026-09-09 — Android 첫 빌드를 위한 후보 수정

- 네이티브 HTTPS API 권한과 Stronghold Argon2 설정을 수정했다.
- 거절된 명령으로 후속 제출이 막히는 문제, 기억 검색 결과 누락, 중복 제출과 재접속 상태 혼용을 수정했다.
- 기기 등록 응답 캐시에 토큰 원문을 저장하지 않도록 변경하고, 기존 데이터·인증을 보존하는 캐시 정리를 추가했다.
- 앱 패키지 lock과 Rust 직접 버전을 고정하고, 수동 ARM64 디버그 APK 빌드 및 결과 수집 설정을 추가했다.
- Node 24에서 30개 검사와 TypeScript·Vite 빌드가 통과했다. APK 컴파일·폰 설치·HTTPS 코어 연결은 아직 미검증이다.
- 현재 단계에 맞춰 개발 지침과 폰 실행 안내를 갱신했다. 검증 상세는 `docs/STATUS.md`를 따른다.

## 2026-09-08 — 비공개 GitHub 저장소 초기 등록

- `wooyeonho/yeno-os`의 기존 README 제목을 보존하고 실행·개발 안내를 추가했다.
- 준비된 실행 코어 0.1.1, 개발 지침, YENO 행동 기준과 수동 검증 워크플로를 수입했다.
- 이미 생성된 저장소에 맞춰 폰 안내와 첫 Codex 작업을 수정했다.
- Node 24 개발 기준을 명시했다.
- 실제 확인 상태와 남은 연결·빌드 작업은 `docs/STATUS.md`에 기록한다.

본 기록은 소스 등록에 관한 것이다. 운영 서버 배포, APK/EXE 생성, 실기기 확인을 뜻하지 않는다.

## 2026-09-09 — native controller candidate

- Added the versioned native controller API with persistent revocable device credentials.
- Added the Tauri 2 Android-first controller source and encrypted Stronghold connection vault.
- Added Android build and device acceptance procedures; no APK or device verification is claimed.


## 2026-09-09 — Android 첫 화면 관찰과 관리형 상주 서버 후보

- 사용자 Android 캡처에서 설치 후 본체 연결 화면 표시를 확인했다. 등록·보관소·명령·재접속은 아직 미검증으로 구분했다.
- Render native Node 서버 1개와 영구 디스크 1 GB를 선언한 `render.yaml`, `docs/RENDER_SETUP.md`를 추가했다. 자동 배포·preview는 끄며 별도 후보 브랜치를 사용한다.
- Docker와 관리형 호스트가 같은 조용한 서비스 실행 코드를 쓰도록 준비했다. 실제 마운트·host/port·독점 커널 잠금 검사를 거쳐 시작한다.
- 기본 월 비용 $7.25를 공식 요금 자료로 확인했다. 신규 계정 생성·결제·서비스 생성·실제 HTTPS 연결은 실행하지 않았다. 기존 노트북 설치와 Vault 데이터는 다루지 않았다.

- 수정 후 전체 Node 검사 43/43 통과(14.112초), shell/Node 구문·공식 Render JSON Schema 검증 통과. Render 양성 검사 마운트 메타데이터는 fixture이며 실제 호스트 검증과 구분했다.
