# CODEX 지시서 — Shadow 실측을 원격 provider로 즉시 전환 (2026-09-27)

작성: Claude(Cowork). 소유자 정정: BLACKHOLE은 Ollama 전용이 아니라 **Ollama + Gemini/GPT/NVIDIA 등 API를 복합으로 쓰는 시스템**이다. 그런데 `build-artifacts/agent-scale-20260926/*/report.json` 16건 전부 `qwen2.5:3b`(로컬)였고, 그 결과 §62~§71 전체가 RAM 게이트에 막혀 있었다. 이것은 제품 한계가 아니라 **시험 설계 오류**다. 런타임은 이미 openai/anthropic/gemini/xai/moonshot/nvidia/local을 지원한다(`runtime/lib/agent-engine.mjs`, `runtime/desktop-ui/app.js` providerLabels).

## 0. 유지 (완화 금지)
- 소유자 승인 게이트, 외부 코드 검토 게이트, `project_read` 범위 경계, semantic PASS 인용 근거 검사(§67), EXTRA-136 내용 계약 5/5(§68) — 전부 그대로.
- API 키는 환경변수(`YENO_AI_API_KEY`)로만 읽는다. 로그·리포트·실행 기록에 키 값이나 그 일부를 절대 남기지 않는다. 키가 설정돼 있는지 여부(presence)만 기록한다.

## 1. RAM 게이트를 로컬 provider에만 적용
`scripts/verify-source-shadow-live.mjs`의 `memoryPreflight`는 provider가 `local`일 때만 차단한다. 원격 provider는 모델이 PC 메모리를 쓰지 않으므로 게이트 대상이 아니다. 리포트에는 provider와 게이트 적용 여부를 남긴다. 테스트 red→green.

## 2. 같은 격리 임무를 원격 provider로 1회 실측
- 이미 키가 설정된 provider 중 하나(NVIDIA / Gemini / OpenAI — 어느 것이든 현재 환경에 있는 것)로 §68과 **동일한 입력**(task spec `a6dff933…`, scene input `f2d9d453…`, 내용 계약 블록)을 돌린다.
- 로컬 전용이던 tool-free 단일 응답 경로는 원격에는 적용하지 않는다(기존 도구 경로 유지). 이미 코드가 그렇게 분기돼 있으니 바꾸지 말 것.
- 결과는 `m2-shadow-remote-<provider>-live-20260927/report.json` + `manual-evaluation.md`(5항목 수동 판정, §66과 같은 형식).
- 실패하면 그것도 그대로 기록한다. 원격에서도 5/5가 안 나오면 그건 프롬프트/계약 문제이고, 나오면 지금까지의 막힘은 모델 크기 문제였다는 게 확정된다. 어느 쪽이든 RAM 논쟁은 끝난다.

## 3. 그 다음 (2번 결과 나온 뒤에만)
- 원격이 5/5면: 로컬 3B는 "작은 역할 전용(Scout 요약, 짧은 대화)"으로 등급을 내리고, Builder/semanticVerifier처럼 판단이 필요한 역할은 원격 provider를 기본으로 하는 라우팅 규칙을 제안한다. 소유자가 provider 배분을 최종 승인한다.
- 원격도 실패면: 프롬프트·내용 계약 쪽으로 원인을 옮기고, 모델 크기 가설은 닫는다.

## 4. Claude가 검증할 항목
1. 16건 전부 로컬이었다는 사실이 실행 기록에 남고, 원격 실측 리포트가 새로 생겼는가.
2. RAM 게이트가 `provider==='local'`에만 걸리는가(코드+테스트).
3. 리포트·로그·기록 어디에도 API 키 값이 없는가.
4. 원격 실측의 `manual-evaluation.md` 5항목 판정과 §68 게이트 판정이 일치하는가.
