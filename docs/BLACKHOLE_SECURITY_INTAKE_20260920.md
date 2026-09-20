# BLACKHOLE 보안 흡수·오픈소스 분류 기록 — 2026-09-20

## 이번 링크에서 실제로 확인한 것

Instagram 공개 게시물(https://www.instagram.com/reel/Ddhruw6iaPW/?stkn=dzhpamEwdmNkOXZz)의 본문은 gittrend.io의 OpenStock 소개였습니다. “실시간 가격, 개인 알림, 기업 정보”를 제공하는 오픈소스 주식 시장 앱이라는 설명과 함께 원 저장소를 확인했습니다.

원 저장소: https://github.com/Open-Dev-Society/OpenStock
- 공개 저장소, 기본 브랜치 main, TypeScript/Next.js 기반
- 저장소 설명과 README를 실제로 읽음
- AGPL-3.0 원문과 웹서비스 배포 시 소스 제공 의무를 확인
- 원 저장소를 BLACKHOLE에 복사하거나 배포하지 않음
- 금융 데이터 지연·공급자 약관·정확성 한계가 있어 자동매매나 투자 조언으로 승격하지 않음

## BLACKHOLE에 들어가는 형태

OpenStock 전체를 한 덩어리로 합치지 않는다.

1. market-data-research capability 후보: 시세·알림·근거표를 읽기 전용 연구로 분리한다.
2. market-data-research는 공개 데이터·공급자 약관·지연 여부·출처 시각을 저장한다.
3. AGPL-3.0은 라이선스 호환성 검토 전까지 readingStatus=read, decision=pending, implementationStatus=blocked다.
4. 실거래·자동 주문·브로커 로그인은 이 링크에서 흡수하지 않는다. 모의투자·백테스트·손실 한도·소유자 승인 이후 별도 단계다.
5. 이미 있는 Kirby qualifyCandidate에 새 qualifyExternalCandidate 보안 게이트를 합쳐, 검증·샌드박스·라이선스·소유자 승인 없이 활성화할 수 없게 했다.

## 이번 링크의 다른 주장

같은 게시물·연관 자료에서 보이는 “탈옥”, 광고·소재 우회, 무제한 사용 등의 주장은 기능으로 흡수하지 않는다. 탈옥·보호조치 우회·자격 증명 추출·플랫폼 약관 회피는 BLACKHOLE의 자동 작업이 될 수 없다.

대신 허용되는 일반 원칙만 남긴다.

- Planner / worker / critic / verifier 역할 분리
- 공개 자료 읽기와 방어적 보안 검토
- 네트워크 기본 차단·비밀값 미전달·샌드박스·실시간 감시·즉시 중단
- 외부 효과는 소유자 승인 후에만 수행

## 분류 상태

| 자료 | readingStatus | decision | implementationStatus | 상태 |
|---|---|---|---|---|
| Instagram 게시물 | read | pending | blocked | 원문은 읽었지만 혼합 주장·원권리 불명확 |
| Open-Dev-Society/OpenStock | read | pending | blocked | AGPL-3.0 호환성·데이터 제공자 약관 검토 필요 |
| 방어적 보안/다중 모델 원칙 | partial | pending | queued | 공식 원자료와 격리 시험을 더 연결해야 함 |

후속 구현은 반드시 discover → license/security review → sandbox → fixture benchmark → independent verification → owner approval → canary 순서로 진행한다. 이 PR은 source intake·qualification과 테스트만 추가했으며 OpenStock 복사·실거래 연결·배포·자동 실행은 하지 않았다.

## 현재 검증 범위

- 정적 보안 intake가 jailbreak·광고 우회·자격 증명 추출을 거부한다.
- prompt injection·tool poisoning·외부 효과·미확인 라이선스는 pending으로 닫힌다.
- 읽지 않은 자료는 candidate가 될 수 없다.
- 기존 Kirby qualification과 결합해 security candidate가 아니면 eligible=false가 된다.
- 테스트는 synthetic/local 구조 검증이다. 실제 OpenStock 실행, 금융 데이터 live 호출, 실제 브로커 연결, 실제 모델 호출, 사용자 기기 설치는 하지 않았다.
