# BLACKHOLE 요구·수락 원장 (2026-09-23, 통합 후보 기준)

브랜치 `blackhole/g1-integration-claude-20260922` · 최신 코드 SHA는 `docs/CLAUDE_EXECUTION_STATE.md` 재개 기록 참조.
상태값: `implementationStatus` idea/planned/in_progress/candidate(코드+자동검사)/…, `verificationStatus` NOT_RUN/PASS(synthetic)/PASS(live)/FAIL/BLOCKED, `liveStatus` NOT_RUN/BLOCKED/PASS.
`PASS(synthetic)`는 fixture/모의 transport 자동 검사이며 실제 외부 연결·실기기 증거가 아니다. 완성률은 테스트 수로 계산하지 않는다.

## 결함 원장 F01~F14

| ID | 상태 | 코드/검사 | 남은 것 |
|---|---|---|---|
| F01 | candidate | #39 STAGE2+3 cherry-pick(`ceef5bd`,`771d1c2`), homunculus-heartbeat·jarvis-shadow-closed-loop·G1 통합 검사 PASS(synthetic) | 실기기·실모델 증거 |
| F02 | candidate | #22 코드 6커밋 통합 + 기억 fabric 브리지(`0730614`), persistent-bots 5 검사 PASS | routine 실행기는 원래 #22에도 없음(execution.routineExecutor:false 유지) |
| F03 | candidate | `fd75003`, 재현 실패→수정 통과 | — |
| F04 | candidate | `7e5cdbb`, 단위+통합(/api/core, 재시작) PASS | UI 상세 화면의 verifiedResult 표시(Home 요약은 core.verifiedResult로 노출됨) |
| F05 | candidate | `4068f5e`, 수정 전 2/3 실패→3/3 통과, fabric/migration 회귀 PASS | 실제 Supabase/Obsidian 목적지 전송은 자격증명 필요(BLOCKED) |
| F06 | candidate | `1624721`, 단위+UI+통합 PASS | v2: 임무당 역할 1회 키 여부 결정 |
| F07 | candidate(회수) | `f1094c7` 기억 회수+회수 id/사유 job에 기록, 라벨된 데이터로만 프롬프트 전달; 검사 2건 PASS | 의도→기존 작업 계약 자동 변환은 미착수(G2) |
| F08 | planned | 미착수(9/23 조사만: 어댑터 계약·JEV 결정 권한은 이미 있음, 구현체 없음) | 실제 브라우저 worker/transport 연결(G3) — 다음 재개 1순위 |
| F09 | candidate | `0e0c55a` identity 노출+Home 표시 + `9437dac` 점검 도구가 실제 `/api/v1/state.runtimeIdentity`를 읽어 대조(isolated 종단 검증됨) | 실제 Koyeb 배포 SHA와의 라이브 대조는 YENO_TOKEN 필요(BLOCKED, 소유자 게이트) |
| F10 | planned | 미착수 | 서명키·버전 원장·기존 설치 위 업데이트 검증(G5) — 소유자 서명키 필요 |
| F11 | planned | 미착수 | 독립 보관 백업 회수→빈 환경 복원 실증(G5) |
| F12 | candidate | `59bd320` 점검 도구 + 검사 3건 PASS, 실제 Koyeb basic PASS | live 모드 실행(YENO_TOKEN) — 소유자 게이트 |
| F13 | candidate | `7c7a091` 소유 하위트리 01_DRAFTS/BLACKHOLE 기본·00_INBOX_RAW 금지, 검사 PASS | 실제 Vault 연결은 소유자 활성화 결정(기본 OFF) |
| F14 | candidate | `9437dac` `lib/cost-ledger.mjs` + `agent-engine.mjs` runAgent 게이트, 단위 5건+기존 agent 회귀 PASS(synthetic) | 단가는 provider당 1개 수동 스냅샷(모델별 아님) — 실제 청구서 대조는 다음 단계 |

## 필수 요구 R01~R52

| ID | 요구 | implementationStatus | verificationStatus | liveStatus | 이번 후보에서의 근거 / 차단 |
|---|---|---|---|---|---|
| R01 | Persistent Self | candidate | PASS(synthetic) | NOT_RUN | blackhole-core identity 재시작 검사(기존) |
| R02 | Heartbeat | candidate | PASS(synthetic) | NOT_RUN | #39 STAGE2 통합, homunculus-heartbeat 검사 |
| R03 | Seven Drives·Homunculus | candidate | PASS(synthetic) | NOT_RUN | measuredDrivePressure/currentGoalId 연결, G1 통합 검사 |
| R04 | Jarvis 계획·실행 | candidate | PASS(synthetic) | NOT_RUN | 결정→dispatchShadowMission(#39 STAGE3), G1 |
| R05 | 내부 JEV | 기존(shadow mode) | PASS(synthetic) | NOT_RUN | 권한 승격 없음(변경 없음) |
| R06 | Brain Pool | 기존 | PASS(synthetic) | NOT_RUN | 변경 없음 |
| R07 | 실제 모델 호출 | 기존 코드 | NOT_RUN | BLOCKED | provider 키 없음 → `providerMissing`. 합성 transport만 |
| R08 | 금액·토큰 한도 | candidate | PASS(synthetic) | NOT_RUN | F14: 추정 USD 한도 + 실패 닫힘(unpriced 시 차단) |
| R09 | Shadow 역할 동시 실행 | candidate | PASS(synthetic) | BLOCKED | 실모델 2역할은 키 필요 |
| R10 | Shadow 기억·routine·handoff | candidate | PASS(synthetic) | NOT_RUN | #22 통합 + fabric 브리지 |
| R11 | 검증·성과 구분 | candidate | PASS(synthetic) | NOT_RUN | F04: semantic pass만 verified; 사업 성과는 별도 원장 |
| R12 | 작업·요청 원장·재접속 | candidate | PASS(synthetic) | PASS(basic만) | 점검 도구 isolated PASS; Koyeb health/401 PASS; live 루프는 토큰 게이트 |
| R13 | 지속 기억·맥락 검색 | candidate | PASS(synthetic) | NOT_RUN | F07 회수 경로; 의도→작업 변환은 G2 |
| R14 | 결과→기억 동기화 | candidate | PASS(synthetic) | BLOCKED | F05; 실제 목적지 자격증명 없음 |
| R15 | 관계·결정·에피소드 기억 | 기존 | PASS(synthetic) | NOT_RUN | memory-events 검사(기존) |
| R16 | Obsidian 초안 출력 | candidate | PASS(synthetic) | NOT_RUN | F13; 실제 Vault 활성화는 소유자 결정 |
| R17 | Project Universe | 기존 | PASS(synthetic) | NOT_RUN | 변경 없음 |
| R18 | 프로젝트 완료 판정 | candidate | PASS(synthetic) | NOT_RUN | 독립 검증 뒤에만 milestone(F05/G1) |
| R19 | Kirby 입력 접수 | 기존 | PASS(synthetic) | NOT_RUN | sources 검사(기존) |
| R20 | 자료 다중 목적지 | planned | NOT_RUN | NOT_RUN | G2 |
| R21 | 자료 감시 | 기존 일부 | PASS(synthetic) | NOT_RUN | 대상별 확인 필요 |
| R22 | Kirby 검증된 기능 획득 | 기존 | PASS(synthetic) | NOT_RUN | capability 검사(기존) |
| R23 | 실제 브라우저 읽기 | planned | NOT_RUN | BLOCKED | F08(G3) |
| R24 | 외부 사이트 행동 | planned | NOT_RUN | BLOCKED | 행동별 권한(G3) |
| R25 | Studio·영상 | 기존 | PASS(synthetic, 7건 env-skip) | NOT_RUN | 이 VM에 PIL/fonttools/Nanum 없음 |
| R26 | 개발 worker | 기존 코드 | NOT_RUN | BLOCKED | runtime 미연결(G3) |
| R27 | 자기 개선·롤백 | 기존 일부 | PASS(synthetic) | NOT_RUN | — |
| R28 | Solo Leveling·XP·레벨·E~S | candidate | PASS(synthetic) | NOT_RUN | F06 XP/레벨 + 기존 E~S 유지, UI 반영 |
| R29 | 텍스트 자연어 명령 | candidate | PASS(synthetic) | NOT_RUN | G1: "알아서 진행해" → 임무 |
| R30 | 실제 음성 | 기존 코드 | NOT_RUN | BLOCKED | 실기기·audio model |
| R31 | Android 사용성 | 기존 | PASS(CI, #55) | BLOCKED | 후보 SHA APK 미빌드(push 게이트), 실기기 미확인 |
| R32 | Windows 사용성 | 기존 | PASS(CI, #55) | NOT_RUN | 후보 SHA 미빌드 |
| R33 | PC 파일·화면 | planned | NOT_RUN | NOT_RUN | G3 |
| R34 | Living Core UI | candidate | PASS(synthetic) | NOT_RUN | F03/F04/F06 화면 일치 검사 |
| R35 | 단일 주 코어·버전 식별 | candidate | PASS(synthetic, isolated 종단) | BLOCKED | F09: 점검 도구가 실제 runtimeIdentity를 대조; 실 Koyeb 대조는 YENO_TOKEN 필요 |
| R36 | 인증·기기 등록·폐기 | candidate | PASS(synthetic)+PASS(basic live) | 부분 | 점검 도구: enroll/revoke/401 PASS(격리), Koyeb 401 PASS |
| R37 | 비상 정지 | 기존 | PASS(synthetic) | NOT_RUN | 변경 없음 |
| R38 | 비밀·격리 | 기존+점검 도구 | PASS(synthetic) | NOT_RUN | 보고서 토큰 미포함 검사 |
| R39 | 백업·복구 | 기존 | PASS(synthetic) | BLOCKED | F11 실증 필요 |
| R40 | 릴리스 서명 | planned | NOT_RUN | BLOCKED | F10 서명키 |
| R41 | 배포·migration·rollback | planned | NOT_RUN | BLOCKED | G5 |
| R42 | 관측·진단 | candidate | PASS(synthetic) | PASS(basic) | 점검 도구 |
| R43 | 성능·품질 비교 | planned | NOT_RUN | NOT_RUN | G5 |
| R44~R49 | 확장(God Eye·Grok·Buzz·연구·50개 제품·추가 요구) | 접수 유지 | NOT_RUN | NOT_RUN | 본체 접수·조회·위임 가능; 제품별 수락은 G6 |
| R50 | 저개입·최종 결정 | 운영 원칙 | — | — | 남은 소유자 행동은 실행 상태 문서에 묶음 제시 |
| R51 | 요구 변경·이력 | candidate | — | — | 이 원장 + 설계 기록 + CHANGELOG |
| R52 | 개인정보·보존·내보내기 | planned | NOT_RUN | NOT_RUN | G5 |

50개 프로젝트(C00~V11)와 추가 요구(자동매매/엔화, 당근, PhytoMotive, Scrapagotchi, 산양게임, 코리아타운 청소게임, God Eye/Grok/영상/Buzz, 스마트안경, SNS 갱신 확인)는 `BLACKHOLE_OS_COMPLETION_GUIDE_20260923.md` 부록 A/B 그대로 보존·추적한다(이번 후보에서 어떤 제품도 완료로 바꾸지 않음).
