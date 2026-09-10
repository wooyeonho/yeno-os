# YENO 오픈소스·스킬 흡수 — 2026-09-10

## 이번 구현

기존 공식 릴리스 5곳에 더해 공개 GitHub 저장소를 스스로 검색하고 원문을 보관한다. 모델 키 없이 동작하는 상주 코어 기능이다. 소유자가 위임한 YENO 개선 자료 조사 범위이며 여행 자료와 개인 피드/다른 대화 자동 열람은 포함하지 않는다.

`흡수 시작` → 24시간 일정 예약 → 공개 GitHub 검색 → 최대 3개 저장소 원문 접수 → `흡수 현황`에서 실제 결과 확인. `흡수 중지`와 전체 멈춤으로 끄며, 전체 정지 해제만으로 다시 시작하지 않는다. 기존 APK의 명령/결과 API로 사용한다. 코드 푸시와 폰 실기기 검증을 구분한다.

- 매회 **스킬·MCP·지속 기억·작업 복구·음성·화면 제어 6개 분야**의 topic과 stars>=100, archived=false, fork=false 조건으로 검색한다. 인기순은 발견 단서이며 품질·권리·안전의 보장이 아니다. 분야마다 5개 메타데이터, 정기 순환 시 검색 페이지 1~3으로 넓힌다.
- 공식 참고 저장소 2개를 순환 확인하고, 중복되지 않는 검색 결과 1개를 추가 확인한다. 첫 참고 대상은 NVIDIA/skills, anthropics/skills다. 이후 modelcontextprotocol/servers, langchain-ai/langgraph, mem0ai/mem0, MoonshotAI/kimi-cli를 순환한다. 고정 목록 이외 저장소도 실제 검색으로 발견한다.
- 저장소 공개/보관/포크 상태를 다시 확인하고 기본 브랜치의 커밋 SHA를 고정한다. 해당 커밋의 README, LICENSE, skills 폴더의 SKILL.md 최대 2개를 읽는다. 스킬 폴더는 연구·에이전트·검사·기억 등 YENO 관련 이름을 우선한다. 모든 비표준 스킬 배치와 모든 파일을 지원하는 것은 아니다.
- Git blob SHA와 실제 바이트를 비교하고 별도 SHA-256·경로·확인 시각·발췌·잘림 여부를 보존한다. README 발췌 6,000자, 라이선스 3,000자, 스킬 각각 4,000자다. GitHub 응답 2MiB, 개별 파일 64KiB, 각 요청 8초/전체 실행 90초 제한. 리디렉션·임의 호스트·비밀 값 전송은 허용하지 않는다.
- 기록은 **partial / pending**이다. 기존 소유자 검토를 덮어쓰지 않으며, 보관한 새 커밋의 검토 상태와 기존 자료 검토를 구분한다. 모호한 라이선스/원문 누락은 그 상태로 남긴다. SPDX 표기만으로 상용 사용 가능이라고 판정하지 않는다. 스크립트를 설치·실행하거나 SKILL.md의 allowed-tools로 권한을 추가하지 않는다.
- URL로 자료 중복을 막고 커밋이 같으면 원문을 다시 받지 않는다. 소유자가 바꾼 검토 기록은 보존한다. 원문 보관 카탈로그는 현재 60개, 자료 저장소는 5,000개 한도다. 용량이 차면 deferred/capacity로 기록하며 조용히 원본을 삭제하지 않는다. 보고서는 최근 30개를 표시한다.
- 일정/원문/출처는 기존 영속 저장과 암호화 백업에 포함한다. 예전 상태에는 비활성 카탈로그를 추가하는 보존형 마이그레이션을 적용한다. 복원·저장소 자동 복구 때 수집을 끈다. 원문을 포함한 새 상태는 구버전 백업 코드로 되돌리기 전에 호환성 확인이 필요하다.

## 모델을 연결한 다음

`ecosystem_list`와 `ecosystem_read` 도구를 추가했다. 모델은 필요한 발췌만 읽어 기존 기능 중복, 적용할 부분, 가장 작은 시험, 라이선스/권한/개인정보/비용 조건을 포함한 개선 초안을 만들 수 있다. 외부 문서는 근거 데이터로 전달되며 시스템 지시가 되지 않는다.

YENO_AGENT_AUTORUN=true, AI 모듈 켜짐, 실제 모델 인증과 호출 상한이 모두 있을 때만 새 자료/새 커밋 수집 실행마다 검토 작업 최대 1개를 만든다. 기존 릴리스 검토와 구분된 실행 식별자를 보존한다. 임무당 4회/하루 설정 한도를 공유하므로 후보가 많다고 모델을 무한 호출하지 않는다. API 키가 없으면 원문 수집까지만 동작한다.

**아직 없는 단계:** 스킬 활성화/실행, 격리된 코드 수정과 비교 시험, 효과 평가 후 설치·배포 승격. 수집기가 성장한 것과 실제 사용 가능한 기능이 늘어난 것을 같은 상태로 표시하지 않는다. 구현/테스트는 현재 Codex 개발 환경에서 계속 수행한다.

## NVIDIA와 Kimi 연결 준비

2026-09-10 공식 확인: [NVIDIA 카탈로그](https://build.nvidia.com/explore/discover)는 개발용 무료 서버리스 API를 안내하고, [Kimi K3 페이지](https://build.nvidia.com/moonshotai/kimi-k3)는 무료 시험 endpoint와 API 키 발급을 제공한다. [API 설명](https://docs.api.nvidia.com/nim/reference/moonshotai-kimi-k3)은 시험 서비스 약관과 모델별 라이선스를 구분한다. 계정의 실제 호출 한도/이용 가능 여부는 키를 연결한 뒤 확인하며 무제한·영구 무료로 보장하지 않는다.

첫 연결은 **NVIDIA 하나**를 준비한다. Kimi 직접 API가 꼭 필요한 상황이 생기면 [Kimi API](https://platform.kimi.ai/docs/overview)를 추가한다. 동일 모델을 NVIDIA에서 시험하기 위해 두 제공자의 키를 동시에 요구하지 않는다. 현재 NVIDIA/Moonshot 연결 규약과 reasoning_content 보존은 모의 응답으로만 검증했다.

| 설정 | NVIDIA 시험 연결 준비값 |
| --- | --- |
| YENO_AGENT_PROVIDER | nvidia |
| YENO_AGENT_MODEL | moonshotai/kimi-k3 |
| YENO_AGENT_DAILY_CALL_LIMIT | 4 |
| YENO_AGENT_AUTORUN | false: 실제 첫 임무 확인 후 자동 검토를 별도로 켬 |
| YENO_AGENT_API_KEY | 소유자가 NVIDIA에서 발급한 키를 Koyeb Secret으로 연결. 실제 키를 문서·채팅·git·앱에 넣지 않음 |

API 키 생성 페이지: 위 NVIDIA Kimi 페이지의 **Generate API Key**. 기존 Koyeb 서비스의 Environment variables and files에서 YENO_AGENT_API_KEY를 해당 Secret에 연결한다. 나머지 준비값의 실제 적용 여부는 STATUS 최상단 기록을 따른다. 초기 AI 모듈은 꺼져 있다. 설정 충족 후 한 임무의 실제 요청·도구·결과·사용량을 먼저 검사한다. 새 결제나 자동으로 다른 유료 공급자로 전환하는 동작은 없다.

Kimi 직접 연결은 provider=moonshot, endpoint=https://api.moonshot.ai/v1/chat/completions, 모델은 계정에서 접근 가능한 ID를 사용한다. NVIDIA는 https://integrate.api.nvidia.com/v1/chat/completions다. [Kimi 도구 호출/추론 보존 규약](https://platform.kimi.ai/docs/guide/use-thinking-models)을 따라 반환된 reasoning_content를 내부 체크포인트에 보관해 후속 도구 응답에 되돌려준다. 공개 작업 상태와 최종 문서에는 추론 원문을 노출하지 않는다. K3는 low reasoning / 응답 최대 4,096토큰으로 시험한다. 실제 모델 호환성은 인증 연결 후 검증해야 한다.

## 참고한 원자료

- [Agent Skills 규격](https://agentskills.io/specification): SKILL.md 메타데이터·선택적 파일·필요할 때 읽는 구조. 이번에는 형식을 읽는 수집기를 구현했으며 정식 스킬 실행기/전체 규격 검증기는 아니다.
- [Anthropic Skills](https://github.com/anthropics/skills): 개별 기능 예제. 문서 도구에는 별도 source-available 조건이 있으므로 저장소 전체를 같은 오픈소스 라이선스로 취급하지 않는다.
- [NVIDIA Skills](https://build.nvidia.com/skills): NVIDIA 공식 스킬 목록과 GitHub 원 제작자 저장소. GPU/서비스 의존 기능은 현재 Micro 서버에 설치했다고 표시하지 않는다.

실제 배포·수집 결과와 테스트 수는 [STATUS](STATUS.md), [LIVE_ACCEPTANCE](LIVE_ACCEPTANCE.md)의 최신 기록을 따른다.
