# CODEX 지시서 — Builder 빈 응답 원인 분리와 로컬 모델 실측 조건 (2026-09-27)

작성: Claude(Cowork). §64까지 실측 4회에서 로컬 Builder가 한 번도 산출물을 내지 못했다. 입력 크기 가설은 §64에서 스스로 기각됐다. 아래는 코드가 아니라 **측정 순서**에 대한 지시다. 순서를 바꾸지 말 것 — 앞 단계가 원인을 확정하면 뒤 단계는 하지 않는다.

## 0. 유지 (완화 금지)
- 소유자 승인 게이트, 외부 코드 검토 게이트, `project_read` 범위 거부 경계 — 그대로.
- 실패한 원래 호출을 재시도해 기록을 덮지 않는다 (§64 방식 유지).

## 1. 먼저 확인할 사실 — Ollama 컨텍스트 창 (가장 유력, 비용 0)
근거: `runtime/lib/agent-engine.mjs:150`은 HTTP 200에 `content`가 공백일 때만 `empty_model_response`를 던진다. 즉 타임아웃이 아니라 **모델이 실제로 빈 문자열을 돌려줬다.** Ollama는 요청이 `num_ctx`를 넘으면 오류 없이 프롬프트 앞부분을 잘라내고 `server.log`에 `truncating input prompt` 한 줄만 남긴다. 저장소 어디에도 `num_ctx`/`OLLAMA_CONTEXT_LENGTH` 설정이 없고, Builder의 `inputTokens`는 1947·2063으로 기본값 2048 경계에 걸쳐 있다. Scout/Researcher(입력 더 작음)만 성공하는 패턴과 일치한다.
1. `%LOCALAPPDATA%\Ollama\server.log`에서 `truncating input prompt`를 찾아 Builder 호출 시각과 대조한다. 있으면 원인 확정.
2. `ollama --version`, `ollama show qwen2.5:3b`(num_ctx 유무), 환경변수 `OLLAMA_CONTEXT_LENGTH`를 기록한다.
3. 확정되면 수정은 두 가지 중 하나: (a) Ollama 서비스에 `OLLAMA_CONTEXT_LENGTH=8192` 설정, 또는 (b) `PARAMETER num_ctx 8192`를 넣은 파생 모델(`qwen2.5:3b-ctx8k`)을 만들어 `YENO_AI_MODEL`로 지정. OpenAI 호환 엔드포인트는 `options`를 받지 않으므로 코드 쪽 `payload`에 `num_ctx`를 넣지 말 것.
4. 부수 수정: `empty_model_response` 발생 시 응답 본문의 `usage`, `finish_reason`, `content` 길이를 저널의 실패 사유 옆에 남긴다(본문 자체는 저장하지 않음). 지금은 "비었다"만 남아 원인 추적이 안 된다.

## 2. 실측 전제조건 게이트 — 스크립트에 넣는다
`scripts/verify-source-shadow-live.mjs` 시작 시 Windows 여유 RAM을 읽어 **3 GiB 미만이면 실행하지 않고 `BLOCKED: insufficient_memory`로 종료**한다. §64의 Scout `request_failed_or_stopped`는 여유 RAM 0.19 GiB에서 나왔다. 그 상태의 실측은 제품 신호가 아니라 잡음이며, 시간만 태운다. 실행 전 `ollama ps` 결과와 여유 RAM을 `report.json`에 기록한다.

## 3. 그래도 비면 — 모델 능력과 파이프라인을 분리한다
§1 수정 후에도 Builder가 비거나 5항목을 못 채우면(수동 평가 0/5, 1/5 기록 있음) 그것은 파이프라인 결함이 아니라 3B 모델의 한계다. 이때는:
1. Builder 작업을 **5항목 각각 1회 호출**로 쪼개는 옵션(`builderSteps`)을 추가한다. 작은 모델은 한 번에 5조건 카드를 못 쓰지만 한 조건씩은 쓴다. 각 조각의 artifact를 합쳐 최종 카드로 만들고, 조각별 SHA를 남긴다. 원격 provider는 기존 단일 호출 유지.
2. 같은 입력을 `qwen2.5:7b`(RAM 확보 시)로 1회만 실측해 3B와 나란히 기록한다. 이 결과는 "모델 등급별 기대치" 표의 첫 행이 된다 — 로컬 독립 실행은 소유자 조건이므로 "3B로는 여기까지, 7B로는 여기까지"를 숫자로 남기는 것이 목표다.

## 4. 하지 말 것
- 같은 조건에서 5번째 실측을 돌리는 것. §1·§2 없이는 결과가 같다.
- Builder 프롬프트 문구를 손보며 재시도하는 것. 원인 확정 전의 프롬프트 튜닝은 측정을 오염시킨다.

## 5. Claude가 검증할 항목
1. `server.log`의 `truncating input prompt` 유무와 Builder 호출 시각 대조 결과가 실행 기록에 있는가.
2. `num_ctx` 수정이 코드 `payload`가 아니라 Ollama 설정/파생 모델에 있는가.
3. 여유 RAM 게이트가 스크립트에 있고, 게이트 미달 시 실측이 실제로 중단되는가(테스트 red→green).
4. §1 수정 후 실측 1회에서 Builder `content` 길이가 0이 아닌가 — 내용 품질은 별도 항목.
5. 5항목 분할 옵션이 로컬 provider에만 적용되고 원격 경로가 그대로인가.
