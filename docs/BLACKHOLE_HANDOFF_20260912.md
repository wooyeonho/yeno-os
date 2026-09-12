# BLACKHOLE OS 인수인계 — 2026-09-12

## 가장 최근 인계 — 14:11Z 운영실 검증

이 절과 최신 STATUS가 아래의 이전 기록보다 우선한다. 현재 실행 소스는 `018ac0adb7c1699b7d756786bbfa699060858bbc`, Koyeb `acfba09c-f55f-4e55-aa42-39753b417301` Healthy/Active, 이전 `51fa15e4` Stopped다. 기존 Micro Frankfurt·단일 볼륨·키 참조를 유지했다. 소유자가 하루4→20회 확대를 승인했고 실제 적용됐다. 현재5/20회, 이번 실검증1회·추가 재시도0회·신규 미확인0회다. 기존 미확인1회는 그대로 남긴다.

웹 **운영실**: 실제 한글 세로 MP4(무음·최대60초), For-Ai 공개 HTTPS/붙여 넣기 분석, 여기 장소 기록, 한끼안부 전용 수신자 응답 링크, 소설 설정/회차/이력/집필/내보내기. 세계 현황에 USGS+NASA EONET을 연결했다. 기존 프로젝트 계보49+신규1+보관20과 자료110행을 보존했다.

검증: 로컬285/285와 실제 Gemini 응답 형태로 재현한 가져오기 회귀7/7. 운영 MP4·For-Ai·공개 재난2출처·예시 장소·합성 수신자 왕복/폐기, Gemini원고811자의 회차 저장과 Markdown 내보내기, 수정 배포 뒤 동일 결과·동일 요청·추가 호출0회를 확인했다. 공개 HTTPS 다운로드200/동일해시와 실제 운영 백업2,585,454바이트의 별도 경로 복원도 확인했다. 작업50개/결과30개, 운영실5종기록 각1개다. 운영 상태는 교체하지 않았고 임시 복원본/검사키를 제거했다. 외부 지속 백업 저장은 별도 미완료다.

소설 작업 `4b3730be-49b8-4880-87ed-acba76d243cd`, 회차 `2fcb06df-7043-47f3-8cf6-4820cc149081`을 다시 만들지 않는다. 실제 응답은 본문 뒤 체크리스트에 인라인 표식을 반복했고, 독립된 표식줄 한 쌍만 가져오도록 수정했다. `scripts/verify-production-live.mjs --inspect`는읽기 전용이며 `--run`은 고정 `blackhole-studio-20260912-v1` 요청을 먼저 회수한다. 실패/미확인 유료작업에 새 요청 ID를 붙이지 않는다.

남은 연결: Grok Bot 공식 페이지 로그인 후 x.ai 접근 차단, 사용자 쪽 제품 로그인/사용권한 확인 필요. 기존 APK는 텍스트 결과창이라 새 운영실/MP4 사용은 휴대폰 브라우저와 기존 개인 연결 키를 사용한다. 폰 실기기·생성형 영상/음성·외부 연재/자동 게시·자동 메시지·안경·항공/선박 연결은 미완료다. 모든 제품 완성·무인 개발·자동 게시로 표시하지 않는다.

증거: [운영실](PRODUCTION_STUDIO_20260912.md), [실검증](PRODUCTION_STUDIO_LIVE_20260912.json), [상태](STATUS.md). 현재 작업 사본은 `/workspace/scratch/87919c3606ef/yeno-os`; Git 메타데이터가 없어 GitHub tree/commit/ref로 저장했다. 운영 브랜치 `yeno-koyeb-pilot`은 실행 소스, `codex`의 후속 문서 커밋은 별도로 구분한다. 기존 브라우저/콘솔의 인증을 사용하며 운영 키를 로그·소스·대화로 추출하지 않는다.

아래는 이전 인계 기록이다.

## 1. 현재 결론

상주 코어·명령/결과·자료/프로젝트 관리와 복구 기반은 구현·배포됐다. 실제 모델 API 인증과 첫 AI 산출물 검증은 진행 중이다. 코어가 스스로 코드를 개발·빌드·배포하는 상태는 아니다. 172개 검사 통과는 공급자 모의 응답을 포함한 소프트웨어 검사이며 실제 모델 연결·폰 실사용·49개 프로젝트 완성의 증거가 아니다.

사용자는 결과를 바로 써보고 싶어 한다. 개발·디자인·검증은 담당 에이전트가 직접 진행하며, 반복 계획/자료 탐색보다 실제 결과 생성과 앱 확인을 먼저 끝낸다. 불필요한 모델/도구 사용과 같은 승인 요청을 줄인다.

## 2. 이어받을 위치와 운영 버전

| 항목 | 마지막 확인값 |
| --- | --- |
| 제품명 | 블랙홀 / BLACKHOLE, 이전 이름 YENO |
| 저장소 | https://github.com/wooyeonho/yeno-os |
| 개발/문서 브랜치 | `codex` |
| 이 문서 작성 전 문서 HEAD | `207df2ba1c60f188dae0182cc508a491a18ab039` |
| 운영 소스 브랜치 | `yeno-koyeb-pilot` |
| 실제 운영 소스 | `2b14d03f53cd1d03234c789e2cedf895be9546e3` |
| 운영 주소 | https://global-iris-gyeol-98386a17.koyeb.app/ |
| Koyeb 서비스 | `global-iris/yeno-core` |
| 서비스 ID | `7fb597dd-726e-45ee-bfde-7f695f6dc8ba` |
| 확인한 배포 | `ec5c4ece-51d1-4bb0-9c4d-7cd9ad5be272`, Healthy / Active |
| 코어 기반 | Node24, 0.2.2 계열의 확장 코드, 단일 프로세스 JSON 저장소 |
| 최근 자료 반영 | revision262, 자료110개, 프로젝트70행 |
| Windows 기존 설치 | 별도 로컬0.2.3. 이 클라우드 소스와 동일하다고 가정하지 말 것 |

위 값은 확인 시점의 기록이다. 재개 시 `codex/docs/STATUS.md`, `docs/LIVE_ACCEPTANCE.md`와 실제 배포/상태를 다시 대조한다. 문서 브랜치가 앞선 것은 서버가 그 문서 커밋까지 배포됐다는 뜻이 아니다. 기존 서비스의 자동 배포는 꺼져 있으며 재배포는 별도 실행이다.

## 3. 완료·진행·미완료 범위

| 범위 | 실제 완료한 부분 | 남은 부분 |
| --- | --- | --- |
| 앱/코어 | Tauri Android 소스·APK 빌드, 기기 등록·인증, 소유자 캡처의 최초 코어 연결 | 최신 APK 설치와 폰 명령→결과→종료/재접속 전체 인수시험 |
| 명령/결과 | 기억 저장·검색, 문서 생성, 작업/결과 조회, 일시정지·재개·취소·전체 멈춤, 요청 중복 방지 | 임의 코드 실행과 실제 개발 도구 연결 |
| 자료 | 접수·수정·원자적 가져오기·검색/페이지·후보 준비서, 읽기와 결정 상태 분리 | 모든 SNS 원문 열람, 임의 코드/스킬 자동 설치 |
| 자동 수집 | 고정 공식 GitHub 릴리스, 공개 GitHub 주제의 제한된 README/라이선스/SKILL 수집 코드 | X/Reddit/Product Hunt/Instagram 전체 자동 연결, 예약 조사와 코어 자동 동기화 |
| 프로젝트 | 원본49개 계보 복원, 잘못 만든20개 보관·잘못 배정한 봇 취소, V11 신규1개 구분 | 모든 프로젝트가 병렬 개발/출시된 상태가 아님 |
| AI | GPT·Gemini·Kimi·Grok·Claude·NVIDIA 고정 엔드포인트, 제공자별 키/모델 격리, 설정된 제공자 자동 선택, 호출 기록/중단 | 실제 계정별 API 키·사용 가능 모델·응답 확인, 복수 제공자의 동시 실행/스마트 라우팅 |
| 프로젝트 봇 | 배정된 프로젝트만 읽는 초안 작업, 동시2개 제한, 중단·예산·기록 | 무인 개발 실행기, xAI의 별도 Grok Bot 제품 연결 |
| World | 공개 USGS 재난 데이터 기반 상태 문서·지도·필터와 출처/해시 | God Eye 소개의 모든 항공/선박/위성·음성·영상 기능 |
| 복구 | 암호화 백업·별도 경로 복원, 실제 데이터의 독립 로컬 복원 검사 | 외부의 지속 백업 저장 성공과 장기 운영 자동 복구 |
| Windows/음성/미디어 | 설계·후보·일부 프로젝트 원형 | 새 Windows EXE 배포/실기기 시험, 음성·알림·화면 제어·Higgsfield 실제 연결 |

Supabase/Vercel 구독 해지·비용 절감 완료 증거는 없다. 사용자의 과거 요청만으로 완료 표시하지 않는다.

## 4. 가장 최근 실제 수정

`runtime/lib/agent.mjs`와 `runtime/test/agent.test.mjs`를 수정했다.

- 소설 등 일반 요청에도 시스템 개선 초안을 강제하던 지시를 수정했다. 요청한 산출물을 만들도록 했지만 실제 모델 품질 검증은 별도다.
- 일반 작업에 사용할 수 없는 프로젝트 전용 도구2개를 제외했다(7→5). 프로젝트 봇은7개 유지. 간결한 출력에서도 숫자·단위·부정문·코드·오류·요청 내용을 보존하도록 했다. 실제 비용 절감률은 측정하지 않았다.
- Gemini `tool_calls[].extra_content.google.thought_signature`를 불투명 문자열로 보존하고 후속 요청으로 전달한다. Gemini 전용16KiB 제한, 기존 서명 없는 저널 호환, 다른 메타데이터 제외.
- 마지막 도구 결과 저장 직후 중단되면 다음 모델 요청을 예약하기 전에 중단 상태를 재검사한다.
- `runtime/lib/provider-config.mjs`의 이전 변경은 여섯 제공자의 키/모델 분리와 `auto` 선택이다. 응답 미확인 호출을 다른 제공자에게 재전송하지 않는다.

기준선168/168, 수정 중 발견한 중단 경계 오류를 고친 후 최종172/172 통과(19.826초). 명령은 `npm test`. 모의 공급자·실제 로컬 파일/HTTP/디스크 재개/복원 검사다.

운영 HTTPS 검증: `2026-09-11T23:00:36Z`(한국9/12), 같은 requestId의 같은 job, 실제 결과 다운로드와 `X-Content-SHA256` 일치, 이전 데이터 보존. job `5073aac7-e385-47da-8df1-e7f22efcb428`, artifact `84848996-d0e7-4c2f-8b7c-330edbd29af2`, SHA-256 `4a944675a4cb3199fb180ff4152546ca17b37331e91573445f2929a5f60b756b`.

검증 스크립트에서 공개 artifact 참조에 없는 sha256 필드를 읽던 오류는 서버 응답 헤더 대조로 수정했다. 같은 접수 요청을 재사용했고 중복 작업을 만들지 않았다. 이후 자료2개 추가/1개 갱신으로 revision262·110개를 확인했다.

## 5. 원래 진행하던 프로젝트

원본49에는 C00 총괄이 포함된다. 실행기49개나 완제품49개가 아니다. 현재70행은 원본49 + V11 신규1 + 잘못 만들어 보관한20이다.

| 사용자 표현 | 기존 계보 |
| --- | --- |
| 소설쓰기 | B04 HQ, B04-01~13 |
| 인류 난제 | E01~E09 EUREKA |
| For AI | A01 For-Ai |
| 스마트글래스 SNS / 여기 | A02 Yeogie |
| 한끼안부 | A03 |
| 결 / GYEOL | A05 |
| Buzz | C01 |
| 링크 기반 영상 제작 | B02-4 AI Shorts Production Engine |
| 새 플레이 가능한 사례 원형 | V11 BLACKHOLE casebook |

전체49개 이름/목적은 [PROJECT_SCOPE_CORRECTION.md](https://github.com/wooyeonho/yeno-os/blob/codex/docs/PROJECT_SCOPE_CORRECTION.md), 전체 작업 배정은 [ALL_PROJECTS_AND_SOURCES_20260911.md](https://github.com/wooyeonho/yeno-os/blob/codex/docs/ALL_PROJECTS_AND_SOURCES_20260911.md)를 사용한다. 새 프로젝트를 임의로 다시 만들거나 GitHub 저장소 이름으로 포트폴리오를 대체하지 않는다. V11 원형은 `projects/blackhole-casebook/BLACKHOLE_CASEBOOK.html`이다.

## 6. 링크·스킬 반영 상태

- Ponytail: 기존 일부읽음/대기 기록을 보존하며 SKILL 원문 확인 후 읽음/후보로 갱신. 재사용·작은 수정 원칙을 코드 작업에 적용. 별도 스킬 실행기 설치는 아님.
- Caveman: 원문 읽음/후보로 신규 등록. 의미 보존과 간결화 원칙만 적용. skill은 MIT, 엔진/프록시는 BSL1.1로 구분하고 프록시는 미설치. 제작자 절감률을 블랙홀 성능으로 인용하지 않는다.
- Google ARTEMIS: Android ADB 시험 후보. 실제 기기/에뮬레이터·보조 앱·모델 미연결.
- Grok Bot: 공식 제품 개요 읽음/보류. 별도 클라우드 컴퓨터를 쓰는 제품으로 xAI 모델 API나 현재 프로젝트 초안 봇과 다르다. 콘솔의 이 브라우저 접근 차단을 확인했으며 우회하지 않았다.
- God Eye: 기존 참고 링크/계보를 복구했고 World의 USGS 기능을 구현했다. 소개 영상의 모든 기능을 구현한 것은 아니다.
- 사용자 릴스 `DdHacqZz412`: 일부 화면/캡션 확인. Higgsfield 공식 통합 문서는 읽음/후보로 등록. 원 영상 전체/오디오 검증, 플러그인 연결·영상 생성은 미완료.
- 전체 자료110개는 구현 기능110개가 아니다. 여행 링크는 개선 후보에서 제외한다. 볼 수 없는 SNS는 미확인 상태를 보존하며 다른 대화·개인 저장함의 전체 접근을 가정하지 않는다.

## 7. API 연결과 인증 상태

최종 운영 검증 시 `configured=false`, 실제 모델 호출0, 일일 요청 상한4, `YENO_AGENT_AUTORUN=false`. 사용자가 명시적으로 여섯 제공자 연결을 요청했으며 NVIDIA만 필수로 삼지 않는다. `auto`는 서버 시작 때 설정이 완성된 첫 제공자를 고르는 기능이며 모든 모델을 동시에 실행하지 않는다.

현재 이 세션에서 OpenAI의 Google 로그인과 비밀번호 인증 후 API Keys 관리 화면 진입을 확인했다. 로그인 성공은 API 키 생성·Koyeb 저장·실제 모델 응답 성공과 다르다. 이 문서 뒤에 인증/연결 검증이 추가되면 그 기록을 우선한다.

| 제공자 | Koyeb Secret에 연결할 환경 변수 | 별도로 지정할 모델 |
| --- | --- | --- |
| OpenAI | `YENO_OPENAI_API_KEY` | `YENO_OPENAI_MODEL` |
| Gemini | `YENO_GEMINI_API_KEY` | `YENO_GEMINI_MODEL` |
| Kimi 직접 | `YENO_MOONSHOT_API_KEY` | `YENO_MOONSHOT_MODEL` |
| Grok API | `YENO_XAI_API_KEY` | `YENO_XAI_MODEL` |
| Claude | `YENO_ANTHROPIC_API_KEY` | `YENO_ANTHROPIC_MODEL` |
| NVIDIA | `YENO_NVIDIA_API_KEY` | `YENO_NVIDIA_MODEL` |

기존 앱 연결 Secret `yeno-core-pairing`/`YENO_TOKEN`은 모델 키가 아니다. 앱 연결 키·모델 키·보관소 암호를 섞지 않는다. `auto`에서 공용 `YENO_AGENT_API_KEY`만 설정하면 공급자가 선택되지 않는다. 과거 명시적 제공자 모드의 공용 키 호환과 구분한다. 키 원문·비밀번호·OTP는 이 파일, GitHub, 앱 번들, 로그에 넣지 않는다.

현재 자동 검토 off와 일일4회 상한을 임의로 늘리지 않는다. 호출 수 상한은 정확한 금액 상한이 아니다. 기존 프로젝트 본문을 외부 모델에 보내기 전 계정/데이터 처리 조건과 작업 범위를 확인한다. 계정 로그인, 키 저장, 모델 응답, 앱 확인을 별도 증거로 남긴다.

## 8. 다음 담당자가 바로 할 일

1. `AGENTS.md`, 최신 `STATUS.md`, `LIVE_ACCEPTANCE.md`를 읽고 개발 브랜치/운영 배포/실제 상태를 대조한다. 원본49·신규1·보관20과 기존 자료를 유지한다.
2. 이어지는 인증 기록을 확인하고 이미 성공한 로그인/키 발급을 중복 요청하지 않는다. 기존 권한 범위의 전용 모델 키를 Koyeb Secret에 연결하고 접근 가능한 모델 이름을 지정한다. 결제/구독 생성은 따로 필요한 경우만 확인한다.
3. 공급자 인증을 합성/공개 내용의 작은 작업으로 검증한다. 실제 요청/응답·사용량·오류를 기록하고, 응답 불명확한 유료 호출은 자동 재전송하지 않는다.
4. 원래 프로젝트의 한 실행 흐름을 완성한다. 예: B04 소설의 장면 한 편 또는 B02-4의 영상 기획/스크립트. 초안과 실제 렌더링/빌드 산출물을 구분한다. 전체 병렬 실행은 계정·예산·실행기·복구가 검증된 범위에서 늘린다.
5. 폰에서 명령→동일 결과→앱 종료/재접속을 확인하고 중단/서버 재시작 때 중복 실행과 추가 과금이 없는지 검증한다. 서버 API 검사만으로 폰 확인을 완료 처리하지 않는다.
6. 다음 확장은 격리된 개발 실행기, 테스트/빌드 산출물, 승인과 복원 지점이다. 그 뒤 알림·음성·ARTEMIS·미디어·기능 흡수를 늘린다. 별도 개발 작업자는 현재 담당자의 코딩을 시작하기 위한 필수 조건이 아니다.

## 9. 복구·운영 주의점

- JSON 저장소 단일 작성자 제한. 동일 볼륨에 코어를 여러 개 띄우지 않는다. 기본 코어 동시 작업3, 프로젝트 봇2 제한을 무턱대고49로 바꾸지 않는다.
- 전체 멈춤 해제는 모든 작업 자동 재개가 아니다. 이미 중단/보류한 작업을 일괄 재시작하지 않는다.
- Gemini 서명이 들어간 새 저널은 구버전에서 읽지 못할 수 있다. 배포 전 백업과 호환 복원 절차를 확인하고 서명을 삭제해 검증을 우회하지 않는다.
- 독립 복원 검사는 통과했지만 외부의 지속 백업 파일/키 저장은 성공 확인이 남아 있다. 운영 데이터·백업키·서명키는 소스 아카이브에 포함하지 않는다.
- Koyeb API 읽기/쓰기에서 간헐적 시간 초과가 있었다. 쓰기는 같은 requestId로 결과를 확인한다. 이 관찰만으로 폰 UI가 느린 원인을 확정하지 않는다.
- 새 표시명 APK의 빌드 성공과 설치 성공은 별개다. 최근 서버 수정은 기존 명령 API를 사용하므로 서버 수정만을 위해 APK 재설치를 강제하지 않는다.
- 장기 설계는 `BLACKHOLE_ARCHITECTURE.md`와 `BLACKHOLE_BLUEPRINT_REVIEW_20260911.md`에 있다. 설계의5개 서비스/보안 계약이 전부 구현됐다고 표시하지 않는다.

## 10. 근거 파일과 실행 시작점

- [최신 상태](https://github.com/wooyeonho/yeno-os/blob/codex/docs/STATUS.md)
- [실사용 인수 기록](https://github.com/wooyeonho/yeno-os/blob/codex/docs/LIVE_ACCEPTANCE.md)
- [최근 배포·파일 해시 검증](https://github.com/wooyeonho/yeno-os/blob/codex/docs/AGENT_COMPATIBILITY_LIVE_20260912.json)
- [최근 구현/검사 상세](https://github.com/wooyeonho/yeno-os/blob/codex/docs/AGENT_COMPATIBILITY_20260912.md)
- [제공자 설정](https://github.com/wooyeonho/yeno-os/blob/codex/docs/PROVIDER_SELECTION.md)
- [백업/복원](https://github.com/wooyeonho/yeno-os/blob/codex/docs/BACKUP_RECOVERY.md)
- [Android 빌드](https://github.com/wooyeonho/yeno-os/blob/codex/docs/ANDROID_BUILD.md)

개발 소스: `runtime/`, `apps/controller/`, `scripts/`, `projects/`. 이 세션의 작업 사본은 `/workspace/scratch/f833dd027516/yeno-os-pr1-fix`이며 로컬 `.git`이 없어 GitHub 커넥터의 tree→commit→ref 갱신으로 저장했다. 다른 환경에서는 저장소를 정상 checkout하고 진행한다. 임시 작업 경로나 이 브라우저의 로그인 세션이 다른 세션으로 자동 이전된다고 가정하지 않는다.

```text
BLACKHOLE 인수인계 문서와 AGENTS/STATUS/LIVE_ACCEPTANCE를 읽고 이어서 개발하라.
완료한 서버/인증/자료/프로젝트를 다시 만들지 말고 실제 현황을 먼저 확인하라.
최우선은 모델 API의 실제 연결→기존 프로젝트 산출물→폰 확인→중단/재시작이다.
계정 인증이 필요한 부분만 사용자에게 요청하고 구현/검사는 직접 수행하라.
후보·코드·모의 검사·배포·실기기 검증·실제 수익을 구분하고 간결하게 보고하라.
비밀값과 실제 운영 데이터를 코드/문서/로그에 넣지 마라.
```
