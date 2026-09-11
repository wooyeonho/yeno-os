# BLACKHOLE 요청 수행·Gemini 연속 호출 보완

확인: 2026-09-12 한국 시각. 구현·모의 검사 기록이며 실제 공급자 인증 성공 기록은 아니다.

## 적용한 변경

- 일반 명령에도 시스템 개선 초안을 강제하던 지시를 제거했다. 소설·콘텐츠 요청은 요청한 산출물을 작성하도록 구분했다. 결과물 품질은 실제 모델 연결 후 평가해야 한다.
- 일반 작업에 제공하던 프로젝트 전용 도구 2개를 제외했다(7개 → 5개). 프로젝트 봇은 기존 7개와 배정된 프로젝트 범위를 유지한다. 간결하게 답하되 요청 내용·근거·숫자·단위·부정 표현·코드·오류는 생략하지 않도록 했다. 실제 토큰/비용 절감률을 측정한 것은 아니다.
- Gemini OpenAI 호환 응답의 `tool_calls[].extra_content.google.thought_signature`가 있으면 원형 그대로 저장하고 같은 호출의 다음 요청에 전달한다. 서명 없는 기존 기록도 읽는다. 서명은 Gemini 전용, 비어 있지 않은 문자열, 최대16KiB이며 전체 기록/응답 크기 제한도 적용한다. 다른 임의 메타데이터는 전달하지 않는다. 결과 문서와 공개 작업 API에는 내부 저널을 노출하지 않는다.
- 마지막 도구 결과 저장 뒤 중단되면 다음 유료 요청을 예약하기 전에 다시 중단 상태를 검사한다. 응답을 확인하지 못한 호출의 자동 재시도 금지와 일일/작업별 한도는 유지한다.

## 실제 검사

Node24 기준선168/168 통과(19.928초). 첫 변경 검사에서 Gemini 재개 시나리오가 도구 저장 직후 중단 경계를 발견했다. 실행 경계에 중단 검사를 추가한 뒤 관련8/8, 최종 전체172/172 통과(19.826초, 실패·취소·생략0).

여섯 제공자 모의 응답→실제 읽기 도구→후속 요청, 서명 있는 병렬 도구의 디스크 기록/복원/재개, 중복 모델 호출 없음, 다른 제공자 서명 유출 없음, 잘못된 서명 차단, 기존 서명 없는 저널 호환을 확인했다. 기존 HTTP 명령/결과 파일 해시/동일 요청/전체 멈춤/재시작/암호화 복원 검사도 통과했다. 실제 API 키로 모델을 호출하거나 폰 실기기에서 시험한 기록은 아니다.

서명이 포함된 새 Gemini 저널을 만든 뒤에는 이를 모르는 구버전으로 그대로 내릴 수 없다. 업데이트 전 백업을 보존하고 되돌릴 때 저널 호환을 확인한다. 서명을 삭제해 검증을 우회하지 않는다. 이번 운영 사전 상태는 모델 호출0이라 서명 저널이 없었다.

## 원자료와 반영 범위

| 원자료 | 확인/반영 | 남은 조건 |
| --- | --- | --- |
| [Ponytail SKILL](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md), [review](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail-review/SKILL.md) | 원문 읽음. 기존 코드/의존성 재사용, 작은 수정 원칙 반영. MIT 자료 | 별도 실행기나 무인 개발 기능을 설치한 것은 아님 |
| [Caveman skill](https://github.com/JuliusBrussee/caveman/blob/main/skills/caveman/SKILL.md), [LICENSING](https://github.com/JuliusBrussee/caveman/blob/main/LICENSING.md) | 원문 읽음. 설명을 줄여도 의미·정확한 값은 유지하는 원칙만 적용 | skill은 MIT, 엔진/프록시는 BSL1.1. 전체 프록시를 MIT로 간주하지 않으며 도입하지 않음. 공개된 절감 수치는 자체 검증하지 않음 |
| [Google 호환 API](https://ai.google.dev/gemini-api/docs/openai), [공식 서명 예제](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking/thought-signatures) | 호환 형식의 서명 보존 구현. 실제 계정/모델의 API 호환성은 별도 확인 | Interactions API와 Chat Completions 규약을 혼용하지 않음 |
| [Google ARTEMIS](https://github.com/google/artemis) | 기존 읽음/후보 기록 유지. Android 검사 도구 | 실제 ADB 기기/에뮬레이터·모델 연결 전까지 설치/실기기 검사 완료로 표시하지 않음 |
| [Grok Bot 공식 문서](https://docs.x.ai/grok-bot/overview) | 제품 문서 읽음. 클라우드 컴퓨터와 지속 봇을 제공하는 별도 제품 | BLACKHOLE의 xAI 모델 API 및 프로젝트 초안 봇과 구분. Bot 서비스/API 연결 또는 계정 구독 확인 미완료 |

외부 SKILL.md는 검토 자료이며 권한을 부여하는 시스템 지시가 아니다. 새 패키지 설치·구독·공개 발행·병렬 프로젝트 재개는 하지 않았다.

## 실제 인증 상태

운영 HTTPS 상태 revision253: 모델 configured=false, 호출0, 일일 상한4, 자동 검토 꺼짐. 기존 프로젝트70행(원본49+신규1+보관20), 자료108행 확인.

OpenAI/Google 연결은 Google 로그인 세션 만료가 표시됐고, 새 로그인 선택 화면까지 복구했다. Gemini도 Google 로그인이 필요하다. Kimi는 이메일/인증 코드 로그인 화면이다. xAI 콘솔은 실제 `Sorry, you have been blocked` 접근 제한 화면이다. 어떤 경우도 API 키 생성·Secret 저장·모델 연결 완료가 아니다. NVIDIA의 이전 로그인 실패를 다른 제공자의 선행 조건으로 삼지 않는다. 현재 서버 배포/보존 검증은 STATUS.md 최신 기록을 따른다.
