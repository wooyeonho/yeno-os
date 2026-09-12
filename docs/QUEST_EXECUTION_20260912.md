# 블랙홀 목표 실행 — 2026-09-12

기존 Koyeb 코어·API v1·기기 인증·원본 프로젝트를 유지한 A단계 통합이다. 별도 ZIP 서버나 새 데이터 저장소를 실행하지 않는다.

## 사용

웹 조종석의 **목표 실행**에서 목표·성공 기준·현재 기준값·동기·프로젝트·모델을 선택하고 저장한다. **이 목표 실행**은 그 목표의 실제 모델 작업 하나를 만든다. 앱을 닫아도 상주 서버에서 계속 처리하고, 결과 파일을 작업 이력에 저장한다. 저장된 목표를 다시 실행 요청해도 기존 작업을 반환한다.

완료 결과에서 다른 제공자를 선택해 **교차 검토**하면 원본 파일의 SHA-256을 확인하고 별도의 목표·작업을 만든다. 모델 간 동의는 외부 사실 검증으로 승격하지 않는다. **성과 기록**은 실제 결과 파일에 연결된 소유자 보고이며 매출·명예·인지도 검증 점수를 자동 생성하지 않는다.

기존 Android 앱에서도 다음 명령을 사용할 수 있다.

```text
목표: 제공한 기능 설명으로 45초 소개 영상의 장면별 대본과 자막을 완성해줘
목표 현황
목표 저장: 다음에 실행할 구체적인 목표
목표 실행: 목표 ID
교차 검토: 목표 ID | openai
성과 장부
```

기존 작업 화면의 결과 열기·일시정지·재개·전체 멈춤을 사용한다. 이번 변경에 APK 재설치는 필요하지 않다. 이는 API 호환성 판단이며 실기기에서 직접 확인했다는 뜻은 아니다.

## 실행 경계

- 목표당 모델 호출 1~4회와 1~120분의 경과 시간 제한. 전체 일일 호출 원장도 적용한다. 시간 만료 후 자동 재개하지 않는다.
- 개별 목표 실행은 전역 AI 설정·자동 자료 검토 설정을 바꾸지 않는다. 전체 멈춤과 명시적 AI 끄기는 진행 중 목표를 중단한다.
- 모델 요청 전에 호출 ID를 저장한다. 응답 미확인 호출은 재전송하거나 다른 제공자로 우회하지 않는다.
- 전체 멈춤 해제는 작업 전체를 재개하지 않는다. 재시작 후 미완료 작업은 개별 재개가 필요하다.
- 목표의 완료는 실제 작업 상태와 결과 파일에서, 사용량은 제공자 응답의 토큰 수에서 계산한다. 결제 금액은 미확인으로 표시하며 호출 수를 달러 한도로 오인하지 않는다.
- 목표·성과·작업·요청 ID·결과 해시를 기존 암호화 백업에 포함한다. 실제 운영 백업을 외부에 지속 보관한 상태는 별도 검증이 필요하다.
- 임의 코드 실행·PC 조작·자동 결제·게시·운영 기능 활성화는 이 단계에 포함하지 않는다. 현재 실제 실행 도구는 기존 읽기 도구와 결과 문서 생성이다.

## API 연결

현재 Koyeb에서 Gemini 3.8 Flash와 OpenAI GPT-4.1 mini의 키 참조 및 모델 설정을 확인했다. Gemini의 실제 완료 작업 이력이 있고 OpenAI API credit balance는 $0.00이다. OpenAI 크레딧 추가 구매는 수행하지 않았다.

| 제공자 | 키 환경 변수 | 모델 환경 변수 |
|---|---|---|
| GPT | YENO_OPENAI_API_KEY | YENO_OPENAI_MODEL |
| Gemini | YENO_GEMINI_API_KEY | YENO_GEMINI_MODEL |
| Kimi 직접 | YENO_MOONSHOT_API_KEY | YENO_MOONSHOT_MODEL |
| NVIDIA | YENO_NVIDIA_API_KEY | YENO_NVIDIA_MODEL |
| Grok API | YENO_XAI_API_KEY | YENO_XAI_MODEL |
| Claude | YENO_ANTHROPIC_API_KEY | YENO_ANTHROPIC_MODEL |

키는 서비스 비밀값으로만 연결하며 채팅·코드·앱 입력에 넣지 않는다. 개별 제공자를 고르면 그 제공자 자신의 키만 사용한다. Perplexity Search/Agent API와 Grok Bot 제품은 별도 연결이 필요하며 연결된 것으로 표시하지 않는다.

공식 참고: [Gemini 호환 API](https://ai.google.dev/gemini-api/docs/openai), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Kimi 규약](https://platform.kimi.ai/docs/guide/use-thinking-models), [Grok API](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions), [Perplexity Search](https://docs.perplexity.ai/docs/search/quickstart).

## 첨부 출처와 보완

전략 문서는 같은 이름으로 두 번 업로드됐으며 제공된 로컬 경로는 하나다. 전략 원문은 BLACK_HOLE_SEVEN_DRIVES_STRATEGY_20260912.md에 그대로 보존했다.

- 전략 SHA-256: 046234ce4ca2c13f16a40c833ce8c0485d1d88abb64ad8547ad54738dc94f94b
- ZIP SHA-256: 6e880e202628a0c6b92871cc2951a79968506b9d9ecd43802659b0321baac547
- ZIP 감사: 상태만 바꾸는 start, 없는 파일도 완료·S등급 가능, 중단 상태 오류, 두 저장 인스턴스의 데이터 유실, HTML200 연결 성공 오인, 오류 원문 노출을 재현했다. 독립 서버/저장소/자가 검증 플래그는 가져오지 않았다.
- 도입: 일곱 동기, 목표 계약, 증거와 성과의 구분. 기존 durable job/요청 원장/실제 artifact 검증에 연결했다.

## 운영 검사

컨테이너에서 `node scripts/verify-quest-live.mjs --inspect`는 읽기 검사만 한다. `--run`은 고정 요청 ID로 Gemini 목표 하나를 실행하며 호출 상한 1회, 동일 요청의 같은 작업, 파일 해시, 기존 데이터·전역 AI 설정 보존을 확인한다. 같은 스크립트를 다시 실행해도 새 유료 작업을 만들지 않는다. 실제 결과는 STATUS.md에 별도로 기록한다.
