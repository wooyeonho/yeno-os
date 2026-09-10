# 참조 계보 복구와 영상 시제품 — 2026-09-10

사용자의 Grok Bot 참조를 xAI API로 단정했던 해석을 정정한다. 예전 자료에서 아래 원 링크와 역할을 복구했다. 옛 설계 기록과 현재 운영 증거를 분리한다. 여행 자료는 제외했다.

## 복구한 자료

| 참조 | 원 링크와 확인 범위 | YENO에 복구할 역할 |
|---|---|---|
| Grok Bot 분석·재구성 | [Instagram](https://www.instagram.com/reel/Dck62Csjn8E/), YENO_OS_CONTENT_MAP_DRAFT.html YST-0636~0639. 이번 원문 열람 제한, 실제 GitHub 저장소 미식별 | 공용 추론 라우터·MCP 도구·coordinator·격리 실행·사용량 회계. 옛 버전/제작자/아카이브 주장은 재검증 전 보류 |
| Grok Bot God Mode | [X](https://x.com/dravenip/status/2091688351942508876), 같은 파일 YST-0356~0359. 이번 X 403 | 총괄·분야 담당·검토 역할과 증거 있는 결과 인계. xAI 연결과 별개 |
| Buzz Block | [원 X](https://x.com/Nozelcode/status/2090823539158839718), YST-0097. X 원문은 못 읽었으나 [Block 공식 저장소](https://github.com/block/buzz)의 협업 워크스페이스 설명 확인 | Buzz HQ의 사업 기회→고객 문제/근거→작은 제품→콘텐츠 초안→실제 결과 기록. 현재 프로젝트 등록은 Buzz 제품 설치 증거가 아님 |
| 링크 기반 영상 | [Instagram](https://www.instagram.com/reel/DbFm9uWz5hF/), JARVIS_CORRECTED_MASTER_CONFIRMATION_20260825_KO.md CHAT-013/INT-006. 원문 열람 실패 | 링크 접수→내용 확보→사실/권리 확인→대본→소재→영상→미리보기 |
| MoneyPrinterTurbo | YST-0079/0095의 Claude 쇼츠·영상 자동화 계보, [공식 README](https://github.com/harry0703/MoneyPrinterTurbo)를 이번에 확인 | 영상 제작 엔진의 참고 구현. URL 내용을 자동 검증하는 완성 기능으로 간주하지 않음 |
| EUREKA | YST-0134: 8월 29일 당시 AMR-001 후보0·scientific claim NONE·ECDC 원자료 미확보 | 원문·데이터 확보→재현 가능한 분석→반증/독립 검토. 옛 결과0을 현재 전체 연구 성과로 확대하지 않음 |
| 이번 Threads | [공유 링크](https://www.threads.com/share/BAVbqbnjbv/), 원문 미해결 | unavailable/pending으로 보존. 영상 내용 추측 없음 |

다른 대화/개인 피드에 포괄적으로 자동 접근한 것이 아니다. 이번에는 이용 가능한 과거 파일을 검색해 해당 참조를 찾았다. 과거 HTML의 725개 기록·49개 프로젝트는 문서 이력이며 현재 코어 프로젝트 수가 아니다.

## 적용 후보는 세 개

구조화된 내용·적용 방법·권리/개인정보/조건·최소 검증은 [자료 접수 JSON](../examples/capability-review-20260910.json)에 있다. 세 후보는 지정한 공식 README/문서를 읽었다는 의미의 readingStatus=read이며 전체 코드 감사를 뜻하지 않는다. 모두 신규 출시가 아닌 현재 부족 기능에 대한 검토다.

1. **Hermes Agent**: 성공 경험에서 재사용 절차 후보를 만드는 구조. 기존 기억·수집기를 유지하고, 별도 재현을 통과한 절차만 채택한다. [스킬 문서](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills), [보안 문서](https://hermes-agent.nousresearch.com/docs/user-guide/security).
2. **OpenHands SDK**: 현재 초안 봇 다음에 필요한 격리 코드 작업자. 첫 실행은 비밀 없는 작은 저장소 하나, 동시 1개, diff·검사·종료 증거가 결과다. [공식 개요](https://docs.openhands.dev/overview/introduction). Docker 실행 환경과 모델 인증이 없어 아직 설치/실행 검증하지 않았다.
3. **MoneyPrinterTurbo**: 영상 파이프라인 참고. 기존 소형 서버에 무거운 영상 스택을 상주시키지 않는다. 자체 렌더러부터 실제 출력물을 검증했다. 기존 기록에서 복구한 도구이며 이번 신규 발견 제품이라고 표시하지 않는다.

**보류**: [Block Buzz](https://github.com/block/buzz)의 별도 relay/workspace는 코어·앱 중복 및 운영 부담 때문에 설치 보류. [OpenClaw](https://github.com/openclaw/openclaw) 전체 gateway 추가도 같은 이유로 보류. [short-video-maker](https://github.com/gyoridavid/short-video-maker)의 MCP/REST 제작 흐름은 확인했으나 영어 음성 중심·최소 3GB RAM·외부 소재 조건 때문에 현재 배치 보류. SNS의 인기·홍보·수익 주장은 채택 근거가 아니다.

## 실제 만든 영상 시제품

[render-video-draft.py](../scripts/render-video-draft.py)는 외부 프레임워크를 복사하지 않고 작성한 독립 CLI다. 신뢰하는 로컬 폰트와 검토한 장면 JSON으로 창작 글·도형을 렌더링한다. 임의 URL의 열람/다운로드·모델 호출·TTS·음악·게시 기능은 없다. sourceUrl은 출처 메타데이터이며 렌더러가 읽었다는 뜻이 아니다. rights 선언만으로 권리를 증명할 수 없다.

의존성: Python, Pillow, fonttools, ffmpeg/ffprobe, 사용 권한과 한글 글리프를 확인한 로컬 TTF. 검증 환경 Pillow 12.3.0. 폰트 파일이나 제3자 영상·음악을 저장소에 포함하지 않는다. 폰트 재배포를 추가하면 별도 조건을 확인한다.

```bash
python scripts/render-video-draft.py examples/video-draft.json /absolute/new-output-directory --font /absolute/trusted-korean-font.ttf
```

출력은 video.mp4·preview.png·scenes.json·receipt.json. 기존 디렉터리에는 쓰지 않는다. ffprobe의 코덱/크기/길이 검사와 전체 디코딩 후에만 성공 receipt를 남긴다. 실패하면 성공으로 표시하지 않는다. subprocess는 shell 없이 실행하며 텍스트를 ffmpeg 필터 식으로 해석하지 않는다. 운영 비밀 환경 변수를 전달하지 않는다. 이 CLI 자체가 비신뢰 코드를 격리하는 sandbox는 아니다.

검증 결과: 검토한 한국어 6장면, 24초, 720×1280, H.264, 무음 영상 생성. 전체 디코딩과 여섯 장면 시각 확인. 권리 선언 누락/불일치 입력 거부 및 기존 결과 디렉터리 보존 확인. API 비용0·외부 공개 게시0. 마지막 URL 타입 검사 보완 후 최종 영상 재렌더링/전체 디코딩도 통과했다. 최종 145,554 bytes, SHA-256: 7a96098a01b7128eb77520be0372faf77fed0eb62f0e447aadf3aca49c38f119.

현재 단계는 **로컬 영상 렌더링 검사 통과**다. YENO 코어 영상 job 연결·URL 본문 수집·음성·APK에서 MP4 받기는 미구현이다. 이번 변경은 앱 UI/네이티브 빌드 입력을 바꾸지 않으며 APK·EXE를 새로 빌드하지 않았다.

## 다음 실행 순서

1. 기존 코어에 준비된 프로젝트 봇 소스를 배포하고 공급자 Secret을 연결한 뒤, 실제 호출 1개와 결과·한도·중단을 확인한다. 키 발급/관리 화면 문제가 해결되기 전 AI 가동을 주장하지 않는다.
2. 위 영상 렌더러를 별도 제한된 작업자로 연결하고 source→script→artifact ID와 비용/취소/실패를 영속 기록한다. 폰에서 첫 실제 MP4를 받는 흐름을 검증한다.
3. 비밀 없는 코드 fixture 1개에서 개발 작업자의 수정→시험→diff 반환을 검증한다. 격리 환경 확보가 전제다.
4. 성공한 작업의 절차 후보를 만들고 별도 재실행을 통과시킨다. 후보 생성과 운영 승격을 분리한다.

사업과 연구는 목적을 유지한다. Buzz는 보고서 수보다 고객 문제의 근거·실제 제작 결과·매출/비용 증빙을, 콘텐츠는 게시 승인 후 관찰한 반응을, EUREKA는 원 데이터·재현·반증을 본다. 아직 측정하지 않은 수익/유명세/과학 성과를 만들었다고 표시하지 않는다. 라이선스·권한·비용 제한·복구 검사는 위험을 낮추는 구현 기준이며 법적 무문제나 완벽한 보안을 보장하지 않는다.
