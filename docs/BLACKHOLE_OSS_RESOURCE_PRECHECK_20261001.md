# BLACKHOLE OSS 재설계 자원·계약 사전 대조 (2026-10-01)

이 문서는 `BLACKHOLE_REDESIGN_OSS_FUSION_20260930.md`의 가설을 현재 PC·코드·공식 원문과 대조한 **사전 점검**이다. AUD-1의 전수 모듈 감사표나 AUD-4의 최종 목표 구조가 아니다. 외부 후보는 설치·다운로드·기동하지 않았고, 실제 메모리 사용량도 측정하지 않았다.

## 현재 PC와 저장소에서 직접 관측한 값

| 항목 | 관측값 | 범위 |
| --- | --- | --- |
| 저장소 | `C:\Users\우연호\Documents\Projects\yeno-os`, origin `wooyeonho/yeno-os`, branch `blackhole/p3-jev-recovery-port-20260924`, HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211` | 2026-10-01 현재 로컬 Git 조회. 미커밋 변경을 보존한다. |
| 물리 메모리 | 7.731 GiB 전체, 0.813 GiB 여유 | 2026-10-01 12:28 KST `Win32_OperatingSystem`의 단일 순간 관측. 최소/평균이 아니다. |
| `runtime/lib` | `.mjs` 137개 | `rg --files runtime/lib` 기준. 설계안의 126개는 현재 작업 트리와 다르다. |
| `runtime/public` | 전체 파일 84개: `.mjs` 38, `.css` 10, `.html` 4, 기타 32 | vendor/asset 포함. 감사표에서 포함/제외 기준을 먼저 고정한다. |
| 동결 파일 | `solo-leveling.mjs` `14c1d6ac8a0bb6cd3cedf33cb8cf1b819bc23fc1331bcaaca56cca2ae67c683e`; `recovery-one-of-qpu.mjs` `452ef8efc922f471bf33ec925969a690d371faba87e80db308303d3d38dc01d9`; `static-guard.mjs` `3efd4eb231ade444fc684ddc714e6c441f325330ea7b69ba8a1ac899b0de8337` | SHA-256 재대조, 기존 기준과 일치. |

현재 `shadow-roster.mjs`는 하나의 성공 임무에서 그림자를 만들되, 이후 임무를 같은 그림자의 `missions`에 추가한다. 그림자 ID/이름/역할/출생 임무는 **지속되는 정체성**이고, 임무/job은 별도의 내구 기록이다. 재설계안의 “그림자 = 내구 작업 기록 하나”는 둘을 합쳐 설명하므로 AUD-4에서 분리해야 한다. `shadowRank()`는 `levelingHistoriesFromState()`를 통해 증거에서 등급을 다시 계산한다. OSS 러너를 붙일 때 이 ID·임무·증거 관계를 보존한다.

`brain-routing.mjs`는 현재 provider 선택·transport 결과를 기록하고, `browser-harness.mjs`는 URL/주소/행동 제한을 집행하며, `mission-receipts.mjs`는 로컬 영수증을 만든다. 이 기능의 **존재**는 확인했지만 외부 후보가 이를 대체해도 같은 재시작·거부·증거 계약을 보존하는지는 아직 시험하지 않았다. `jev-calibration.mjs`는 실제로 `wilson-score-interval`을 호출하고 `authorizesDispatch:false`를 유지한다.

## 외부 후보의 공식 원문 대조

| 후보 | 공식 문서/라이선스에서 확인한 사실 | 현재 판정 |
| --- | --- | --- |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md) | Python 3.9+ 필요. 공식 small CPU 표는 int8 RAM 1,477 MB, fp32 2,257 MB(특정 CPU·입력 벤치마크). 실제 이 PC의 최소 요구량은 아니다. | 현 여유 0.813 GiB에서 “가볍다”는 주장 불가. 더 작은 모델을 포함한 실제 측정 전까지 B 기동 보류. |
| [OpenHands](https://github.com/OpenHands/docs/blob/main/openhands/usage/run-openhands/local-setup.mdx) | Windows는 WSL+Docker Desktop 경로; 공식 안내는 최소 4GB RAM을 권장한다. | 이 PC에서 BLACKHOLE와 동시 기동 가능성 미측정. 설치·기동 보류. |
| [LiveKit Agents](https://docs.livekit.io/agents/), [배포 가이드](https://docs.livekit.io/deploy/custom/deployments/) | 에이전트 서버는 LiveKit Cloud 또는 자체 호스팅 서버에 연결한다. 공식 배포 가이드는 일반 음성 앱의 시작 기준으로 서버당 4코어/8GB를 권한다. | 현재 PC의 7.731 GiB 전체 RAM과 맞지 않는 출발 기준. 실제 요구량은 구성별로 달라 미측정; 채택 보류. |
| [Temporal](https://docs.temporal.io/self-hosted-guide) | 로컬 개발 서버는 외부 의존성이 없는 단일 바이너리로 시작할 수 있다. 운영 자체 호스팅은 별도 인프라 설계가 필요하다. | “항상 무거운 별도 서버”는 과도한 단정. 그래도 기존 로컬 저장소 대체는 재시작·자원 실측 전까지 보류. |
| [DBOS](https://docs.dbos.dev/typescript/integrating-dbos) | Node 20+와 PostgreSQL이 필요하다. | 로컬·오프라인 우선 및 현재 저장/복구 계약과 충돌 가능. PostgreSQL 의존을 승인·설계하기 전까지 보류. |
| [SearXNG](https://docs.searxng.org/admin/installation-searxng.html), [컨테이너 설치](https://docs.searxng.org/admin/installation-docker) | 공식 설치는 Python 환경 또는 Docker/Podman을 요구한다. 이 PC용 공식 최소 RAM 수치는 확인하지 못했다. | “상대적으로 가볍다”는 측정 결과가 아니다. 기존 G1 검색 어댑터는 유지하고 기동 보류. |
| [LiteLLM LICENSE](https://github.com/BerriAI/litellm/blob/main/LICENSE) | 저장소 루트 LICENSE는 `enterprise/` 제외 영역을 MIT로, `enterprise/`는 별도 라이선스로 구분한다. | 루트 LICENSE를 직접 확인했다. 사용할 정확한 패키지/디렉터리와 고정 버전은 별도 검토 필요. |
| [in-toto LICENSE](https://github.com/in-toto/in-toto/blob/develop/LICENSE) | 저장소 LICENSE는 Apache-2.0이다. | 라이선스 미확인 표기는 이 원문으로 해소. 영수증 형식 적합성과 채택은 미검증. |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/persistence.md) | JS판은 존재하고 checkpointer를 통한 thread별 저장을 지원한다. | 후보 지도에서 “JS판 여부 미확인”은 갱신 필요. BLACKHOLE job ID/멈춤/복구 계약과의 일치는 미검증. |
| [MAPIE](https://mapie.readthedocs.io/en/stable/content/getting-started/choosing-algorithm/) | 방법 선택에 보정 데이터 크기와 관측값의 교환가능성 등이 필요하다. | JEV의 표본·실제 결과 라벨 없이 기권 문턱을 자동 산출할 수 있다는 뜻이 아니다. 현 Wilson 경계 유지. |

SearXNG의 [AGPL-3.0 원문](https://www.gnu.org/licenses/agpl-3.0.en.html)은 수정된 네트워크 서비스의 소스 제공 의무를 규정한다. 별도 프로세스 구성은 코드 경계를 나누는 설계일 뿐 면책 증명이 아니다. 재배포·수정·네트워크 제공 형태를 특정해 라이선스 조건을 확인해야 한다. 이 문서는 법률 판단이 아니다.

## 후속 경계

1. AUD-1은 `runtime/lib` 137개와 `runtime/public` 84개를 동일한 포함 기준으로 전수 분류한다. 지금은 일부 핵심 모듈만 코드 읽기를 했다.
2. 후보 메타데이터의 stars/archived/최신 commit은 이 점검에서 다시 관측하지 않았다. 기존 지도 값을 최신 검증값처럼 쓰지 않는다.
3. 실제 채택 전 고정 버전/해시·라이선스·공식 실행 조건·대기/기동/호출 중 메모리와 CPU·기존 테스트를 같은 PC에서 확인한다. 설치 스크립트 자동 실행, 자격정보 입력, 외부 코드 활성화는 하지 않는다. 실패한 후보는 서비스의 기존 경로를 유지하고 그 후보만 C/BLOCKED로 기록한다.
4. AUD-4 목표 구조는 이 관측값과 AUD-1 전체 감사가 완성된 뒤 작성한다. AUD-3 교체와 소유자 확인 단계는 아직 시작하지 않는다.
