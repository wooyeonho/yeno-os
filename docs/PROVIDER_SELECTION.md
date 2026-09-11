# BLACKHOLE 제공자 선택 — NVIDIA는 필수 조건이 아님

2026-09-12 한국 시각. 소유자는 GPT·Gemini·Kimi·Grok·NVIDIA를 함께 선택지로 유지하도록 지시했다. 먼저 연결된 제공자로 실제 결과를 만들고, 다른 제공자의 가입 실패가 전체 개발을 막지 않게 한다.

## 구현

서버 시작 시 키·모델·호출 상한이 갖춰진 제공자를 선택한다. NVIDIA 기본 설정과 API 키 하나를 모든 제공자에게 돌려 쓰는 방식 대신, 제공자별 키/모델 쌍을 분리했다. 기존 명시적 `YENO_AGENT_PROVIDER`와 `YENO_AGENT_MODEL`/`YENO_AGENT_API_KEY` 쌍은 호환된다. 모델 API의 실제 인증 성공은 설정만으로 판정하지 않는다.

| 제공자 | 서버 Secret에 연결할 환경 변수 | 서버 모델 설정 |
| --- | --- | --- |
| GPT / OpenAI | `YENO_OPENAI_API_KEY` | `YENO_OPENAI_MODEL` |
| Gemini | `YENO_GEMINI_API_KEY` | `YENO_GEMINI_MODEL` |
| Kimi / Moonshot 직접 연결 | `YENO_MOONSHOT_API_KEY` | `YENO_MOONSHOT_MODEL` |
| Grok / xAI | `YENO_XAI_API_KEY` | `YENO_XAI_MODEL` |
| Claude / Anthropic | `YENO_ANTHROPIC_API_KEY` | `YENO_ANTHROPIC_MODEL` |
| NVIDIA 경유 모델 | `YENO_NVIDIA_API_KEY` | `YENO_NVIDIA_MODEL` |

모델 이름은 그 계정에서 접근 가능한 Chat Completions/도구 호출 호환 모델을 지정한다. 모든 모델 버전의 호환성을 보장하지 않는다. 특히 Gemini thought signatures 같은 모델 고유 연속 호출 요구는 실제 선택한 모델로 확인해야 한다. OpenAI 출력 한도는 `max_completion_tokens`를 사용한다. API 규약 참고: [OpenAI](https://developers.openai.com/api/reference/resources/chat), [Gemini OpenAI 호환 API](https://ai.google.dev/gemini-api/docs/openai), 2026-09-12 확인.

선택 모드:

```text
YENO_AGENT_PROVIDER=auto
YENO_AGENT_PROVIDER_ORDER=openai,gemini,moonshot,xai,anthropic,nvidia
YENO_AGENT_DAILY_CALL_LIMIT=4
YENO_AGENT_AUTORUN=false
```

위 순서는 조정 가능한 연결 우선순위이며 품질/가격 순위가 아니다. 목록 안에서 설정이 완성된 첫 제공자 하나를 선택한다. 빠진 키·모델과 잘못된 설정은 건너뛰며 모두 준비되지 않으면 실행하지 않는다. 명시적 `YENO_AGENT_PROVIDER=gemini` 등은 지정한 제공자만 사용한다. `auto`에서는 정체를 구분할 수 없는 공용 `YENO_AGENT_API_KEY`와 `YENO_AGENT_MODEL`을 사용하지 않는다. 새 제공자별 키와 공용 모델(또는 반대)을 섞지 않는다. 키가 있다는 이유만으로 모델 이름을 추측하거나 비용 상한을 올리지 않는다.

기존 별도 Grok 봇은 `YENO_GROK_*`을 유지하고, 키/모델이 없을 때 해당 xAI 전용 설정을 사용할 수 있다. 별도 `YENO_GROK_DAILY_CALL_LIMIT`는 계속 필요하며 전체 한도보다 커지지 않는다. Grok Bot 제품을 설치하거나 API로 제어하는 기능을 뜻하지 않는다.

## 폰에서 확인

기존 명령창에 `자율 점검`을 보내면 선택된 제공자와 여섯 제공자의 설정 준비 상태·부족한 항목이 결과 문서에 표시된다. 키 값은 결과·공개 API에 포함하지 않는다. 동일 서버 명령 계약을 사용하며 새로운 APK가 필수인 변경은 아니다. 폰 실기기 검증은 별도로 기록한다.

## 실행과 복구 조건

- 자동 선택은 서버 시작 때 한 번 수행한다. 이미 접수한 작업은 제공자/모델 체크포인트를 유지하며 제공자가 바뀌면 보류/오류로 남는다.
- 타임아웃·응답 미확인·HTTP 오류를 다른 공급자에게 재전송하지 않는다. 새 작업 선택과 이미 과금됐을 수 있는 호출의 재실행은 구분한다.
- 기본 일일 상한 0, 설정 예시는 4회다. 기존 전체 호출 예약 원장을 공유하고 AI 모듈·전체 멈춤·90초 실행 창·임무당 4회 제한을 유지한다. 호출 수는 금액 상한의 대체물이 아니다.
- 외부 제공자에게는 허용한 작업 입력과 제한된 도구 결과만 보낸다. 계정의 가격·데이터 처리 조건과 실제 모델 접근을 확인한 뒤 첫 공개/합성 임무 하나로 검증한다.
- 새로운 결제·자동 자료 검토·프로젝트 일괄 재개는 이 설정 변경으로 실행하지 않는다.

## 확인 범위

기존 164개 기준선은 통과했다. 추가 검사는 여섯 제공자별 키 격리, NVIDIA 없는 선택, 허용 목록/상한, 응답 미확인 재전송 차단, 실제 로컬 HTTP 명령/결과 파일 해시/동일 요청/재시작/전체 멈춤을 다룬다. 모델 응답은 합성 입력이다. 첫 검사에서 합성 응답의 Content-Type 누락을 발견해 fixture를 수정했다. 실제 공급자 호출 성공으로 표시하지 않는다.

Koyeb 확인 당시 Secret은 앱 연결용 1개뿐이며 서비스의 5개 환경 변수에도 AI API 키가 없었다. 기존 NVIDIA 선택과 모델 준비값만 있었다. 실제 호출은 제공자 API 키 연결 후 검증한다. 최종 검사·운영 반영 상태는 [STATUS](STATUS.md)를 따른다.
