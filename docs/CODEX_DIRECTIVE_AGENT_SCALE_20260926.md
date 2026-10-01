# Codex 지시서 — 동시 워커·처리량 확장 (Shadow Army 실전 가동)

## PC 재확인 기준 (Codex, 2026-09-26)
현재 코어는 작업 동시 실행 상한 3, Shadow의 scout/researcher 병렬 2를 갖고 있으며 실제 HTTP 코어와 합성 모델 transport 시험에서 두 작업의 동시 실행이 확인됐다(`runtime/test/shadow-army.test.mjs`). 실모델 다수 동시 부하·월 PR 처리량은 아직 측정되지 않았다. 기존 실물 `qwen2.5:3b` Shadow 임무의 격리 실행 기록은 `build-artifacts/handoff-r3-20260926/m2-shadow-live-tools-fixed/report.json`에서 scout/researcher/builder·결정론 Verifier는 완료됐지만 semantic verdict가 `uncertain`이라 임무 `failed`이고, 후속 `m2-shadow-live-project-only/report.json`도 실패했다. 현재 2개 경로의 품질·복구부터 확인한 뒤 상한 확대 여부를 결정한다. `workers/developer`의 Docker 증거 경로는 코드·합성 시험으로 존재하지만 이 PC에는 Docker CLI와 고정 worker 이미지 ID가 없어 실물 Docker 실행을 이번에 확인하지 못했다. 코어는 `runnerConnected:false`를 보고한다. 아래 단계는 이 기준에서 시작하며 기존 Shadow의 산출물 해시·Verifier·semantic verdict를 중복 구현하지 않는다. 중간의 `approvalRequired` 심사와 최종 승격 승인은 각각 그대로 유지한다. 정본 실행 근거는 `docs/CLAUDE_EXECUTION_STATE.md` §55에 있다.

작성: Claude(Cowork), 2026-09-26. 배경: 소유자가 외부 사례(에이전트 15~20개 역할별 동시 가동, 월 PR ~1,000건 처리, 코드+실행/로그/성능 증거 동봉 제출, 기능 안내도·재사용 스킬, 스킬 퇴행 감시용 평가 테스트, 코드 구조/CI로 실수 경로 차단, 로컬 검증 통과 후 작업 확장)를 전하며 "우리는 왜 이걸 못하냐"고 물음. Claude 분석: 원칙(검증 증거 동봉, 편집 허용목록, 재사용 기능 레지스트리)은 이미 같은 방향이나, 실제 동시 실행 규모·처리량·퇴행 감시 자동화가 없음. 역할: Codex = 구현. Claude = 이 지시서 + 독립 검증. 소유자 = 최종 승인.

## 0. 유지해야 할 기존 계약 (완화 금지)
- 소유자 승인 게이트는 그대로 유지한다: `production_base_tree_mismatch` 차단, 승격은 소유자 승인 후에만, `capability-change`/`external-code` 리스크는 여전히 `approvalRequired:true`. "전면자동, 최종만 내가"(2026-09-26 소유자 방침) — 과정은 전부 자동/병렬로 늘리되 최종 승격만 소유자가 본다.
- 외부 코드 편입은 여전히 라이선스·고정 커밋·해시·fixture 검토를 통과해야 한다(`kirby.mjs`/`capability-discovery.mjs`). 이 지시서는 검토를 없애는 게 아니라 검토된 뒤의 실행 규모를 키우는 것이다.

## 1. 목표
`runtime/lib/shadow-army.mjs`(역할: scout/researcher/builder/verifier/semanticVerifier)는 구조만 있고 실제 동시 실행 규모가 작다. 이걸 실제로 여러 개 동시에 돌아가는 실전 파이프라인으로 키운다 — 소유자가 매번 손대지 않아도 병렬로 굴러가되, 실행 결과는 전부 실제 증거로 남는다.

## 2. 요구사항
1. **동시 실행 개수 — 실측 가능한 한도로.** 지금 동시에 몇 개의 `job`/Shadow가 실제로 병렬 실행되는지(코드상 한도, 실제 부하시험 결과)를 먼저 실측해서 보고하고, 그 한도를 구조적으로(메모리·모델 호출 예산·`YENO_AGENT_DAILY_CALL_LIMIT` 등 기존 상한과 충돌 없이) 늘릴 수 있는 만큼 늘린다. 목표 수치를 지어내지 말고 실제 한도·병목(모델 호출 큐, 저장소 잠금 등)을 먼저 보고한다.
2. **증거 동봉은 이미 있는 `workers/developer` 패턴을 다른 작업 유형까지 넓힌다.** 지금은 저장소 패치 작업에만 Docker 증거(`dockerEvidenceFrom`/`reportEvidenceDurably`)가 붙는다. 같은 패턴(실행 로그·산출물 해시·시험 결과)을 Shadow Army의 다른 역할(researcher/builder)에도 일관되게 적용해, 모든 완료 작업이 "주장"이 아니라 "증거"를 남기게 한다.
3. **스킬 퇴행 감시.** `solo-leveling.mjs`의 증거 기반 등급·강등은 있지만, "이 기능이 최근 실행에서 예전보다 나빠지고 있는가"를 전용으로 추적하는 회귀 감시가 없다. 기존 레지스트리 실행 이력(`history`)에서 같은 기능의 최근 N회 실행 성공률/검증 통과율 추이를 계산해, 하락 추세면 표시만 한다(자동 비활성화 여부는 별도 결정 — 이번 조각은 감지·보고까지만).
4. **CI/구조 가드레일 강화.** 지금 `ALLOWED_LIB_FILES`/`ALLOWED_PUBLIC_FILES`가 편집 허용목록으로 이미 있다. 실수 나기 쉬운 경로(비밀값 접근, 네트워크 직접 호출, 파일시스템 임의 쓰기 등)에 대해 CI에서 정적으로 잡아낼 수 있는 lint/검사 규칙이 있는지 확인하고, 없으면 기존 `.github/workflows/developer-worker.yml` 패턴에 맞춰 추가한다.
5. **로컬 검증 통과 후에만 확장.** 위 1~4를 한 번에 다 늘리지 말고, 각 단계마다 로컬(격리 VM) 검증이 실제로 통과한 뒤에만 다음 단계로 진행한다 — 기존 프로젝트 관행(Docker 격리 시험 → CI → 소유자 승인)과 동일.

## 3. 산출물
- 실측 보고서: 현재 동시 실행 가능 개수·병목·모델 호출 큐 상태(실제 코드/설정 기준, 추정 아님).
- 확장 후 실제 부하시험 로그(동시 job N개 실행, 실패/성공/증거 첨부율).
- `docs/CLAUDE_EXECUTION_STATE.md`에 새 §로 VERIFIED/RAN-UNVERIFIED/BLOCKED 기록.
- 전체 회귀 `npm test` 통과 유지.

## 4. Claude가 검증할 항목
1. 소유자 승인 게이트(승격·capability-change)가 그대로 살아있는지 — 우회 코드 없는지 grep으로 확인.
2. 동시 실행 실측치가 코드에서 실제로 그렇게 동작하는지(부하시험 재현).
3. 증거 동봉 확장이 실제로 새 작업 유형에서도 해시·로그를 남기는지.
4. 퇴행 감지가 실제 이력 데이터로 계산되는지(가짜 값 아님).
5. 새 CI 규칙이 실제로 위반 사례를 잡아내는지(red→green 재현).
