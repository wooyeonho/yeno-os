# 기존 구독 재사용·비용 정리 감사

확인일: 2026-09-09. 사용자는 기존 Koyeb·Supabase·Vercel을 재사용하고 불필요한 지출을 줄이도록 요청했다.

**실행 결과: 기존 Gyeol Koyeb 서비스를 Pause했고, 새 YENO Micro 코어의 실제 Docker 빌드·Healthy 배포와 첫 HTTP 명령·결과를 확인했다.** 기존 Supabase·Vercel 재사용은 후속 저장소·API 분리 구현으로 이어간다. YENO 재시작 후 같은 인증·작업·결과 보존까지 통과했으며 APK에서의 연결·명령은 아직 검증 전이다. 이 기록을 Supabase 통합이나 최종 청구액 확정으로 해석하지 않는다.

## 확인 범위와 현재 상태

- 소유자 계정의 서비스·결제 화면, 연결 도구의 프로젝트 메타데이터, 내용이 아닌 DB 건수·최신 시각·예약 작업 메타데이터, Gyeol 소스를 읽었다.
- 최초 감사 후 소유자 승인에 따라 Gyeol Koyeb을 Pause했고, YENO 1 GB 볼륨·연결 Secret·Micro 서비스를 생성·배포했다. DB 삭제·마이그레이션과 Supabase·Vercel 구독·설정 변경은 하지 않았다.
- 비밀키·개인 기록 본문·원시 운영 로그를 이 문서에 저장하지 않는다. 아래 프로젝트 식별자는 연결 대상을 구분하는 메타데이터다.
- 기존 Android APK와 `/api/v1` 계약을 보존한다. 직전 코어 검사 46/46 통과는 기존 구현의 증거이며, 이 감사에서 Supabase 저장소나 Vercel 배포를 시험했다는 뜻은 아니다.

## Supabase: 기존 프로젝트를 먼저 활용

실제 Supabase 로그인 계정은 `wooyeonho`이며, `prompt-market` Pro 조직의 프로젝트 3개와 `wooyeonho's Org` Free 조직의 프로젝트 1개를 확인했다. Free 조직 프로젝트의 상세 상태는 아직 조사하지 않았다. `prompt-market` / `cwyxlqqfhcpsipqjfcef`에서 확인한 세 프로젝트는 모두 Micro, `ACTIVE_HEALTHY`이고 데이터가 있다.

| 프로젝트 | 식별자·지역 | 읽기 전용 확인 | 우선 판단 |
| --- | --- | --- | --- |
| For-Ai | `gahjbktjwdeityjvfeet` / Tokyo | 9월 9일 rate-limit 기록, 1분 간격 알림 cron | 사용 흔적이 있어 유지. 알림의 실효성과 중복 실행 여부를 확인한 뒤 빈도 조정 검토 |
| hankki-anbu | `eigtgdnaejhjokuevnyl` / Seoul | 최근 메시지 8월 15일, checkins 0건 | 휴면 후보. 배포·사용자·예약 작업 연결과 백업 확인 전에는 중지하지 않음 |
| buzz-hq | `xgpznpdivxmeafpallhu` / Seoul | 실제 runs·artifacts 최근 기록 8월 17일. 최근 7일 감사 672건 모두 15분 간격 `operator_tick` | 기존 데이터를 보존하며 YENO 저장소 재사용 후보. 반복 tick 수는 실사용 성과와 구분 |

세 프로젝트에서 확인한 Auth 사용자·Storage bucket·object는 각각 0건이다. 다른 테이블과 외부 인증·서비스 계정 사용 가능성이 있으므로 미사용 증거로 삼지 않는다. 작은 실제 DB 크기도 청구되는 compute나 할당 디스크 크기와 같지 않다.

**실제 결제 화면: 8월 24일~9월 24일 주기의 현재 누적 $30.97, 예상 청구 $49.46.** 확인한 구성은 Pro $25 + 누적 compute $15.97 − compute credit $10 = $30.97이다. 8월 24일의 이전 청구 $33.92는 Paid였으며 현재 주기와 합산하지 않는다. Spend Cap은 켜져 있고, 확인한 화면에는 별도 add-on이 보이지 않았다. 예상 $49.46을 확정 청구나 항상 같은 월 요금으로 취급하지 않는다.

프로젝트별 compute는 DB 사용량과 독립적으로 청구된다. 정리 효과는 실제 인스턴스·시간·청구 항목으로 계산해야 하며, 작은 DB나 켜진 Spend Cap만으로 compute 지출이 없어지는 것은 아니다. [공식 compute 과금](https://supabase.com/docs/guides/platform/manage-your-usage/compute)

**유료 플랜 프로젝트는 바로 Pause할 수 없다.** 공식 문서상 먼저 Free 조직으로 이전해야 한다. `hankki-anbu` 등의 절감 후보는 Free 조직의 존재·허용량·이전 조건과 백업을 확인한 뒤 구체화한다. 전체 Pro 조직을 내려서 다른 프로젝트까지 영향을 주거나, 중지를 위해 데이터를 삭제하지 않는다. Free 이전 이후의 복원 기간도 영구 보존과 다르다. [공식 프로젝트 중지 조건](https://supabase.com/docs/guides/platform/free-project-pausing)

`buzz-hq` 재사용은 기존 테이블을 YENO 테이블로 바꾸는 작업이 아니다. 노출되지 않는 별도 schema와 비공개 결과 bucket, 최소 권한의 서버 접근을 후보로 삼는다. API에 노출하는 테이블은 권한과 RLS를 함께 설계한다. 이 분리·저장소 어댑터는 아직 구현하지 않았다.

## Vercel: 결제 계정은 유지하고 중복 배포부터 검토

연결 도구는 Pro 팀 `team_AnGlu4VxnDH9CxGYCCAFo7MQ` / `yeonhos-projects-691c1aa2`에서 프로젝트 0개, `gyeol` 조회 404를 반환했다. 그러나 실제 계정 브라우저에는 **최소 12개 프로젝트 카드와 Show More**가 보였다. 도구의 0개 결과를 계정이 비었다는 뜻으로 해석하지 않으며 전체 프로젝트 수는 미확정이다.

| 관찰한 프로젝트 | 소스·배포 증거 | 정리 후보 |
| --- | --- | --- |
| `gyeol`, `gyeol-ai` | 같은 Gyeol 저장소 연결 | 실제 운영 도메인·배포·cron·환경 참조를 대조해 대표 프로젝트 선정 |
| `for-ai`, `for-ai-e4mm` | 같은 ForAi 저장소 연결 | 같은 방식으로 중복 자동 빌드·배포 여부 확인 |
| `hankkianbu-app`, `yeogie-app`, `jeolgi-app`, `deureojulge-app`, `syoppingshorts-app` | No Production Deployment 표시 | preview·도메인·외부 호출을 확인한 뒤 정리 후보로 분류 |
| `gyeol-ai-origin` | Gyeol_ai 저장소 연결 | Gyeol과 저장소가 다르므로 이름만 보고 합치지 않음 |
| `gyeol-linker-83f9de9b`, `prompt-jeongeum-market` | 카드 존재 확인 | 역할·의존성 추가 확인 대상 |

실제 결제 화면에서 예정 청구 **$20**, 포함 크레딧 사용 **$3.14 / $20**, on-demand **$0**를 확인했다. 이는 확인 시점 값이며 최종 청구 확약이 아니다. 지출 알림은 $200, Auto Pause는 Off였다. 설정은 변경하지 않았다.

중복 프로젝트의 자동 빌드를 줄이면 사용량 낭비를 줄일 수 있다. 그러나 다른 프로젝트가 Pro를 계속 사용한다면 프로젝트 하나를 지워도 기본 Pro 비용 $20가 사라지지 않는다. 우선 기존 Pro에서 YENO 웹/API를 재사용하고, 상용 사용·cron·실사용량을 확인한 뒤 플랜 변경을 판단한다. [Vercel 과금 구조](https://vercel.com/docs/pricing)

## Koyeb: 기존 Gyeol은 자동 활동 실행기

기존 `gyeol-openclaw/gyeol-gateway`는 감사 시점 Frankfurt Nano 1개로 운영 중이었다. 최근 배포는 실패했지만 이전 Healthy 배포가 살아 있었다. 이후 소유자 승인으로 **서비스 Pause 완료, 이전 배포 `9b2c4c0b`는 Stopped, 0 of 1 running**을 실제 화면에서 확인했다. 배포와 연결 설정을 보존했고 연결된 Supabase DB는 삭제하지 않았다.

YENO 추가 비용이 아직 반영되기 전 9월 결제 화면은 기존 Nano 204시간 38분 48초 = $0.74, credit $1, estimated $0, Starter 기본료 $0였다. 지출 알림은 $20로 표시됐다. Nano를 계속 중지하면 규격 견적상 한 달 상시 가동의 compute 약 $2.68를 피할 수 있고, 새 Micro의 한 달 상시 가동 견적은 $5.36다. 시간 비례 계산·credit·세금 등에 따라 청구가 달라지므로 차액을 실제 확정 순지출로 보고하지 않는다.

| YENO 배포 항목 | 확인 결과 |
| --- | --- |
| 앱 / 서비스 ID | `global-iris` / `7fb597dd-726e-45ee-bfde-7f695f6dc8ba` |
| 공개 HTTPS | [YENO 코어](https://global-iris-gyeol-98386a17.koyeb.app/) |
| 소스 | `yeno-koyeb-pilot`, 커밋 `481d6ea` |
| 실제 배포 | Docker 빌드 성공, `153770e4-d07d-4896-8c86-96acf1f87d9a` Healthy |
| 저장소·키 | 새 1 GB 볼륨 및 `yeno-core-pairing` Secret 생성. 키 원문은 기록하지 않음 |
| 재시작 전 실제 HTTP 검사 | health 200, 인증 없는 요청 401, 기기 등록 API 201, 실제 569-byte 결과 파일 생성, 같은 요청 재전송의 중복 방지 통과 |
| 재시작 실검사 | 새 배포 `86051e67-c4f7-4390-b3e8-870a8828322c` Healthy. 같은 인증·작업·요청·결과 해시 보존, 시험 기기 폐기 후 401. APK 등록/명령/재접속과 독립 백업 복원은 남음 |

실제 서버 HTTP 시험은 사용자 Android 실기기 시험과 구분한다. 시험용 볼륨을 장기 기억의 유일한 저장소로 취급하지 않는다. 상세 설정은 `KOYEB_SETUP.md`를 따른다.

- Gyeol 중지 전 실행 버전: `92176c907ea01dd503a542cd84117b669c28ece2`.
- 소스 확인 당시 main: `6d474dd3736da8410b4ef1445b245a7ab488c212`. 실행 버전과 다르다.
- Gyeol은 AI 동반자 제품이고 YENO는 개인 작업 OS다. 기존 서비스를 YENO로 바꾸면 별도 제품을 대체하는 변경이다. [실행 버전 README](https://github.com/wooyeonho/Gyeol/blob/92176c907ea01dd503a542cd84117b669c28ece2/README.md)

| 구성 | 실행 버전의 근거 | 중지 영향 |
| --- | --- | --- |
| Koyeb 스케줄러 | 직접 실행 13개 + lifeline HTTP 1개 | 자동 학습·기억 생성·시간캡슐·소셜·푸시·복구 감시 등의 해당 실행 중단 |
| Supabase | memories·agent_state·chats·autonomous_logs·research_tasks 등에 직접 기록 | Koyeb 중지 자체가 DB 기록 삭제를 수행하지는 않음 |
| Vercel 웹/API | `GYEOL_APP_URL`로 lifeline·일부 동작 연결 | 웹·대화는 별도 실행 경로. 운영 연결 검증 없이 정상 지속을 보장하지 않음 |
| 대체 예약 실행 | 실행 버전 Vercel cron 없음, GitHub cron 수동 실행만 | Koyeb을 끄면 같은 자동 실행이 다른 곳에서 보장되지 않음 |

근거: [스케줄러](https://github.com/wooyeonho/Gyeol/blob/92176c907ea01dd503a542cd84117b669c28ece2/openclaw/src/scheduler.ts), [Supabase 클라이언트](https://github.com/wooyeonho/Gyeol/blob/92176c907ea01dd503a542cd84117b669c28ece2/lib/supabase/service.ts), [기억·상태 기록](https://github.com/wooyeonho/Gyeol/blob/92176c907ea01dd503a542cd84117b669c28ece2/lib/cron-core/heartbeat.ts), [수동 GitHub cron](https://github.com/wooyeonho/Gyeol/blob/92176c907ea01dd503a542cd84117b669c28ece2/.github/workflows/cron.yml).

현재 main의 [vercel.json](https://github.com/wooyeonho/Gyeol/blob/6d474dd3736da8410b4ef1445b245a7ab488c212/vercel.json)에는 6개 cron이 있지만 실제 Vercel 운영 배포 반영 여부는 확인하지 않았다. 이를 기존 Koyeb의 완전한 대체로 취급하지 않는다.

로그의 `agents_total: 0`도 미사용 증거가 아니다. [실행 버전 health.ts](https://github.com/wooyeonho/Gyeol/blob/92176c907ea01dd503a542cd84117b669c28ece2/lib/cron-core/health.ts)는 DB 조회 오류를 확인하지 않고 누락 count/data를 0/빈 배열로 처리한다. 조회 실패도 빈 상태처럼 보일 수 있다.

최초 소스 검색에서는 연결 대상을 확정하지 못했지만, 이후 기존 Koyeb의 비밀값이 아닌 URL 설정을 실제로 확인했다.

| 설정 | 확인한 연결 대상 | 의미 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qobzxoamlmcuwxibqomd.supabase.co` | 위 연결 도구에서 보인 세 프로젝트와 다른 프로젝트 ref다. 해당 프로젝트의 계정·플랜·접근·데이터 상태는 미확인 |
| `GYEOL_APP_URL` | `https://gyeol-ai.vercel.app` | 기존 Koyeb이 참조하는 Vercel 앱이다. `gyeol-ai`를 이름만 보고 중복 삭제하지 않음 |

이 설정 확인은 해당 Supabase 프로젝트가 접근 가능하거나 미사용이라는 증거가 아니다. Koyeb Pause는 연결된 Supabase·Vercel 프로젝트 삭제와 구분한다. 비밀값을 포함할 수 있는 자동 생성 배포 링크나 원시 설정 화면은 기록하지 않는다.

## YENO에 재사용할 구성과 남은 구현

| 역할 | 우선 후보 | 완료 조건 |
| --- | --- | --- |
| 기억·기기 인증·작업·결과 메타데이터 | 기존 Supabase의 분리된 YENO schema | 트랜잭션, 요청 ID 중복 방지, 단일 작업 소유권, 백업·복원 검사 |
| 결과 파일 | 같은 프로젝트의 비공개 YENO bucket | 소유자 범위 접근, 파일 무결성, DB와 파일의 함께 복원 |
| 폰·노트북 웹 화면 및 API | 기존 Vercel Pro | APK `/api/v1` 호환·인증·재접속 검사, 포함 사용량 추적 |
| 첫 코어 연결·상주 실행 | 실제 Healthy Koyeb Micro + 1 GB 볼륨 | HTTP 첫 명령·결과·재시작 보존 확인. APK 검증 남음. 후속 분리 후 규모 재평가 |

현재 YENO의 단일 프로세스 JSON 저장소와 로컬 `flock`을 Vercel Functions에 그대로 옮길 수 없다. Functions의 파일시스템은 읽기 전용이고 `/tmp`는 임시 공간이다. Supabase URL을 넣는 것만으로 DB 저장이 생기지도 않는다. 저장소·작업 실행 경계를 실제로 분리해야 한다. [Vercel 런타임 파일시스템](https://vercel.com/docs/functions/runtimes)

Koyeb 코어는 실제 배포·첫 HTTP 결과·재시작 보존을 확인했다. 세부 증거는 [LIVE_ACCEPTANCE.md](LIVE_ACCEPTANCE.md)에 있으며 APK 실기기 확인은 남아 있다. 후속 재사용 구현은 저장소 어댑터와 기존 JSON의 읽기·검증·이관 후보부터 만든다. 시험 데이터로 명령 → 결과 → 서버 재시작 → 같은 요청 재전송 → 같은 결과 조회, 기기 폐기, 전체 정지를 검증한다. 실제 데이터 이관과 운영 전환은 복원 가능한 후보가 준비된 뒤 수행한다. 기존 APK를 불필요하게 다시 만들지 않는다.

## 비용 정리 실행 순서

1. 확인한 Supabase 현재 누적·예상 청구와 Micro 3개를 기준으로 절감 후보를 계산한다. Free 조직의 기존 프로젝트와 이전 조건, Vercel 전체 프로젝트·운영 도메인은 추가 확인한다.
2. **완료:** Gyeol Koyeb Pause와 0개 실행을 확인했다. 연결된 Supabase URL·Vercel 앱과 직전 정상 배포 `92176c90`을 보존했다. 연결된 DB·웹앱을 중지·삭제 대상으로 확대하지 않았다.
3. 중복 Vercel 프로젝트의 도메인·웹훅·cron·빌드를 비교해 중복 실행부터 줄이는 후보를 만든다. 운영 프로젝트를 이름만으로 삭제하지 않는다.
4. For-Ai 알림 cron, buzz-hq operator tick의 실제 처리 성과를 확인한다. 빈 예약 실행의 빈도 조정은 compute 기본료 절감과 구분한다.
5. hankki-anbu 등 휴면 후보는 데이터·설정 보존과 복원 경로, Free 조직 이전 가능성을 확인한 뒤 이전·중지 여부를 결정한다. Pro 프로젝트에 바로 Pause를 실행할 수 있다고 안내하지 않는다. DB 백업에는 Storage의 실제 파일이 포함되지 않으므로 각각 확인한다. [Supabase 백업 범위](https://supabase.com/docs/guides/platform/backups)
6. 승인된 YENO Micro의 첫 연결·복구 시험을 완료한 뒤 기존 Supabase·Vercel 재사용 후보를 구현·검증한다. 같은 역할의 Render 서버를 함께 추가하지 않고, 분리 이후 Koyeb의 필요한 규모를 다시 판단한다.

Gyeol Pause와 YENO 배포의 대상·직전 상태·복원 정보·검사 결과는 `CHANGELOG.md`에도 기록한다. 이후 구독 변경·이관도 같은 방식으로 기록하며, 추정 절감액과 실제 청구를 합치거나 남은 APK·저장소 통합을 완료로 보고하지 않는다.
