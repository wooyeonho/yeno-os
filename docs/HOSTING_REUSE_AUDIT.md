# 기존 구독 재사용·비용 정리 감사

확인일: 2026-09-09. 사용자는 기존 Koyeb·Supabase·Vercel을 재사용하고 불필요한 지출을 줄이도록 요청했다.

**결정: 기존 Supabase에 YENO 기억·작업·결과를, 기존 Vercel에 웹 화면·API를 두는 후보를 우선 검토한다.** 상주 실행기는 실제 필요가 확인될 때 최소 규모로 둔다. 새 Koyeb Micro 비용 동의는 받았지만 재사용 감사로 생성을 보류했다. 이 문서는 구성과 정리 후보를 기록하며 통합 완료나 비용 절감 완료를 뜻하지 않는다.

## 확인 범위와 현재 상태

- 소유자 계정의 서비스·결제 화면, 연결 도구의 프로젝트 메타데이터, 내용이 아닌 DB 건수·최신 시각·예약 작업 메타데이터, Gyeol 소스를 읽었다.
- 서비스 중지·삭제, 구독 취소·변경, DB 마이그레이션, cron 수정, 새 리소스 생성은 하지 않았다.
- 비밀키·개인 기록 본문·원시 운영 로그를 이 문서에 저장하지 않는다. 아래 프로젝트 식별자는 연결 대상을 구분하는 메타데이터다.
- 기존 Android APK와 `/api/v1` 계약을 보존한다. 직전 코어 검사 46/46 통과는 기존 구현의 증거이며, 이 감사에서 Supabase 저장소나 Vercel 배포를 시험했다는 뜻은 아니다.

## Supabase: 기존 프로젝트를 먼저 활용

조직 `prompt-market` / `cwyxlqqfhcpsipqjfcef`, Pro. 확인한 세 프로젝트 모두 `ACTIVE_HEALTHY`이고 데이터가 있다.

| 프로젝트 | 식별자·지역 | 읽기 전용 확인 | 우선 판단 |
| --- | --- | --- | --- |
| For-Ai | `gahjbktjwdeityjvfeet` / Tokyo | 9월 9일 rate-limit 기록, 1분 간격 알림 cron | 사용 흔적이 있어 유지. 알림의 실효성과 중복 실행 여부를 확인한 뒤 빈도 조정 검토 |
| hankki-anbu | `eigtgdnaejhjokuevnyl` / Seoul | 최근 메시지 8월 15일, checkins 0건 | 휴면 후보. 배포·사용자·예약 작업 연결과 백업 확인 전에는 중지하지 않음 |
| buzz-hq | `xgpznpdivxmeafpallhu` / Seoul | 실제 runs·artifacts 최근 기록 8월 17일. 최근 7일 감사 672건 모두 15분 간격 `operator_tick` | 기존 데이터를 보존하며 YENO 저장소 재사용 후보. 반복 tick 수는 실사용 성과와 구분 |

세 프로젝트에서 확인한 Auth 사용자·Storage bucket·object는 각각 0건이다. 다른 테이블과 외부 인증·서비스 계정 사용 가능성이 있으므로 미사용 증거로 삼지 않는다. 작은 실제 DB 크기도 청구되는 compute나 할당 디스크 크기와 같지 않다.

**Supabase의 실제 청구 총액은 아직 결제 화면 확인 전이다.** Pro 요금과 프로젝트 수를 곱한 추정액을 실제 청구로 적지 않는다. 프로젝트별 compute는 DB 사용량과 독립적으로 청구된다. 따라서 정리 효과는 실제 인스턴스·시간·청구 항목으로 계산해야 한다. [공식 compute 과금](https://supabase.com/docs/guides/platform/manage-your-usage/compute)

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

기존 `gyeol-openclaw/gyeol-gateway`는 Frankfurt Nano 1개로 운영 중이다. 최근 배포는 실패했지만 이전 Healthy 배포가 살아 있다. Nano $2.68/월은 확인한 규격의 견적이며 실제 결제 내역으로 확정한 금액은 아니다. 새 YENO Micro $5.36/월 후보는 만들지 않았고 기존 Gyeol도 중지하지 않았다.

- 실제 실행 버전: `92176c907ea01dd503a542cd84117b669c28ece2`.
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

Gyeol 소스의 제한된 검색에서 위 세 Supabase 프로젝트 ref와 실제 Koyeb 도메인 일치를 찾지 못했다. 연결 프로젝트 확정에는 운영 설정의 비밀값이 아닌 `NEXT_PUBLIC_SUPABASE_URL`·`GYEOL_APP_URL`과 실제 배포를 대조해야 한다.

## YENO에 재사용할 구성과 남은 구현

| 역할 | 우선 후보 | 완료 조건 |
| --- | --- | --- |
| 기억·기기 인증·작업·결과 메타데이터 | 기존 Supabase의 분리된 YENO schema | 트랜잭션, 요청 ID 중복 방지, 단일 작업 소유권, 백업·복원 검사 |
| 결과 파일 | 같은 프로젝트의 비공개 YENO bucket | 소유자 범위 접근, 파일 무결성, DB와 파일의 함께 복원 |
| 폰·노트북 웹 화면 및 API | 기존 Vercel Pro | APK `/api/v1` 호환·인증·재접속 검사, 포함 사용량 추적 |
| 긴 파일/코드 작업 실행 | 필요할 때만 최소 상주 실행기 | 작업 lease·중단·재시도·비용 제한 검증 후 호스트 선택 |

현재 YENO의 단일 프로세스 JSON 저장소와 로컬 `flock`을 Vercel Functions에 그대로 옮길 수 없다. Functions의 파일시스템은 읽기 전용이고 `/tmp`는 임시 공간이다. Supabase URL을 넣는 것만으로 DB 저장이 생기지도 않는다. 저장소·작업 실행 경계를 실제로 분리해야 한다. [Vercel 런타임 파일시스템](https://vercel.com/docs/functions/runtimes)

다음 구현은 저장소 어댑터와 기존 JSON의 읽기·검증·이관 후보부터 만든다. 시험 데이터로 명령 → 결과 → 서버 재시작 → 같은 요청 재전송 → 같은 결과 조회, 기기 폐기, 전체 정지를 검증한다. 실제 데이터 이관과 운영 전환은 복원 가능한 후보가 준비된 뒤 수행한다. 기존 APK를 불필요하게 다시 만들지 않는다.

## 비용 정리 실행 순서

1. Supabase 실제 청구·인스턴스 규모와 Vercel 전체 프로젝트·운영 도메인을 확인해 월 고정비와 사용량을 분리한다.
2. Gyeol의 실제 Supabase·Vercel 연결 및 정상 배포 복귀 경로를 확정한다. 기존 결을 유지할지 불명확하면 그 용도만 소유자에게 확인한다.
3. 중복 Vercel 프로젝트의 도메인·웹훅·cron·빌드를 비교해 중복 실행부터 줄이는 후보를 만든다. 운영 프로젝트를 이름만으로 삭제하지 않는다.
4. For-Ai 알림 cron, buzz-hq operator tick의 실제 처리 성과를 확인한다. 빈 예약 실행의 빈도 조정은 compute 기본료 절감과 구분한다.
5. hankki-anbu 등 휴면 후보는 데이터·설정 보존과 복원 경로, Free 조직 이전 가능성을 확인한 뒤 이전·중지 여부를 결정한다. Pro 프로젝트에 바로 Pause를 실행할 수 있다고 안내하지 않는다. DB 백업에는 Storage의 실제 파일이 포함되지 않으므로 각각 확인한다. [Supabase 백업 범위](https://supabase.com/docs/guides/platform/backups)
6. YENO 저장소·API 재사용을 검증한 뒤 필요한 상주 실행기만 적용한다. 새 Koyeb/Render와 같은 역할의 서버를 동시에 추가하지 않는다.

실제 중지·구독 변경·이관 시 대상, 직전 상태, 예상 절감액과 근거, 복원 방법, 검사 결과를 `CHANGELOG.md`에 별도로 기록한다. 이번 감사만으로 절감액을 합산하거나 OS 연결 완료로 보고하지 않는다.
