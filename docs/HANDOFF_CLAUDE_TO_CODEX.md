# BLACKHOLE — Claude → (Codex/후속 Claude) 인수인계

작성: 2026-09-20 (세션 종료 시점). `BLACKHOLE_CLAUDE_CODE_EXECUTION.md` §3의 "후속 세션용 짧은 재개 지시"를 따른다.
Codex 인수인계를 기다리지 않고 Claude Code 단독으로 R0→R1→R2까지 실제 진행했다. 이 문서는 그 결과의 정확한 스냅샷이다.

## 1. PR 체인 (전부 Draft, 전부 Open, merge 없음)

```
codex (원본)
 └─ blackhole/jarvis-shadow-bridge-codex-20260920 (base)
     └─ blackhole/semantic-verification-claude-20260920 (PR #33, CI green)
         └─ blackhole/grok-provider-adapter-claude-20260920 (PR #34, CI green)
             └─ blackhole/single-ledger-intake-claude-20260920 (PR #35, CI green — run #105 f13d4cd)
                 └─ blackhole/canonical-intake-import-claude-20260920 (PR #36, CI green — run #105 id 35513051558, f13d4cd)
                     └─ blackhole/r2-verify-shadow-ui-claude-20260920 (PR #37, CI: run #106 id 35513941919, head d236f71 — 이 세션 종료 시점 in_progress, 아직 conclusion 미확정)
```

PR #33/#34/#35/#36 모두 실제로 존재하고 CI green임을 이번 세션에서 재확인했다(문서 속 과거 관측을 재사용하지 않음). PR #37이 최신이며 아직 CI 결과가 완전히 확정되지 않았다 — **통과했다고 가정하지 않는다.**

## 2. 이번 세션에서 실제로 한 일

- **R0**: git/PR/Issue #25 실제 상태를 재조회했다(과거 보고를 새 사실로 가정하지 않음).
- **PR #36 검증 중 실제 CI 실패를 발견하고 그 자리에서 수정했다**: `GET /api/sources?q=<code>`가 canonical 코드 하나당 여러 건을 비결정적으로 반환하는 버그(`sourceMatches()`의 `id` 부분일치 + 계층 코드 접두어 충돌 + summary 텍스트 중복). 커밋 `f13d4cd`로 수정, base-vs-head 실제 재실행으로 신규 실패 0개 확인, exact-head CI green(run #105) 재확인 후 PR #36을 완료 상태로 남겼다.
- **R2**: semantic verifier/JEV는 이미 모든 요구 보장을 갖추고 있음을 기존 시험 재실행으로 확인(코드 변경 없음). Shadow Army UI를 project-universe-model.mjs/view.mjs에 실제 데이터로 연결(서버는 이미 계산해 두었으나 클라이언트가 버리고 있던 필드). 검색 UI에 ALL/NOW/QUEUED/BLOCKED/AGING을 실제로 연결(서버와 동일한 `sourceBucket()` 재사용, 로직 분리 없음). 새 시험 7개(shadow-army-ui.test.mjs 6개, r2-search-coverage.test.mjs 1개) 추가, 전부 pass. 전체 회귀 961개 중 931 pass·23 fail(기존과 동일)·7 skip — 신규 실패 0개.
- `apps/controller`(Android)는 이번 R1 후속(PR #36)·R2(PR #37) 어느 쪽도 건드리지 않았다 — 새 APK 없음. 이유는 각 PR 본문·checkpoint에 명시.

## 3. 검증 상태 정직 표기

| 항목 | 상태 |
|---|---|
| PR #33/#34/#35/#36 CI | 실제 재조회함 — green |
| PR #37 CI | 이 문서 작성 시점 **in_progress** — conclusion 확인 전. 다음 세션이 반드시 재확인해야 함 |
| `npm run verify:mobile`(실제 Chromium) | 이 원격 샌드박스에서 `#pair-screen` 타임아웃 — R2 브랜치와 수정 전 PR #36 head 양쪽에서 동일 재현되어 사전 존재 환경 한계로 확인(회귀 아님). 실기기 검증은 여전히 별도 필요 |
| Android/APK | 변경 없음 → 새 APK 없음(의도적) |
| production/merge/결제/외부 게시 | 전혀 없음 |

## 4. 다음 단일 행동 (즉시 실행 가능)

**PR #37의 exact-head CI(run id 35513941919, head `d236f71`) conclusion을 실제로 조회하고, green이면 Issue #25에 §J 형식 보고를 게시한 뒤 R3(실제 폰 사용 흐름 1건: 명령 접수→job→artifact→검증→조회→앱 종료/재접속→같은 결과→stop→명시적 resume, `phone-acceptance.test.mjs`와의 실제 연결 확인)로 진행한다. red면 PR #37 범위 안에서만 원인을 조사해 수정한다.**

```
git checkout blackhole/r2-verify-shadow-ui-claude-20260920
npm test
```

## 5. Rollback

각 PR은 독립 커밋 단위로 `git revert` 가능하며 additive-only(기존 API 응답 형태 불변, 새 필드는 전부 optional/기본값 존재)이므로 되돌려도 기존 저장 데이터를 파괴하지 않는다. 자세한 롤백 경로는 `docs/CLAUDE_EXECUTION_STATE.md`의 각 섹션(§9, §13) 참고.

## 6. 요구 보존 상태 요약

`docs/SOURCE_COVERAGE.md`가 13개 필수 검색어(자동매매·엔화·당근·식물로봇·PhytoMotive·Scrapagotchi·음식물쓰레기·다마고치·산양게임·코리아타운·소설·God Eye·Grok)와 50개 canonical project 코드의 실제 registry 상태를 표로 유지한다. 전체 49+1 canonical project 목록 완전 반영과 §4.3/§4.4 나머지 intake 항목은 아직 범위 밖이다 — "전체"라고 주장하지 않는다.
