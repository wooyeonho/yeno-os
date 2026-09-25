# PC 기준 브랜치와 Codex 후보의 중복 구현 검토

작성일: 2026-09-24
비교 기준: PC 이식 후보 `6c942c3` + JEV 슬라이스 `9fa7b2a`; 비교 대상 Codex 코드 `be486da`
범위: `cost-ledger.mjs`, `shadow-growth.mjs`, `memory-embeddings.mjs`

## 결정 요약

| 모듈 | 기준 구현 | 이번 이식 결정 | 쉽게 말하면 |
|---|---|---|---|
| 비용 원장 | PC 구현 유지 | Codex 구현은 보류 | 현재 동작 중인 계산을 유지하고, 더 강한 사전 예약 방식은 별도 설계로 다룬다. |
| Shadow 성장 | PC 구현 유지 | Codex 규칙으로 XP 계산을 바꾸지 않음 | 지금은 역할별 기여도와 실패·보류 기록을 보존한다. |
| 임베딩 기억 | PC 구현 유지 | Codex 저장소로 교체하지 않음 | PC의 Ollama 저장·수정·삭제 경로와 실사용 근거를 보존한다. |

이 결정은 PC 코드와 사용자의 실사용 증거를 기준으로 한 선택이다. 별도 Codex 모듈을 더 우수하거나 안전하다고 단정하는 것은 아니다. Codex 쪽 장점 중 데이터 형식·정책 변경 없이 가져올 수 있는 것은 후속 검토 대상으로 남긴다.

## 1. 비용 원장

### PC 구현

- 고정 가격표를 provider 단위로 적용하고, 저장된 실제 입력·출력 token 수에서 일일 USD 지출을 **추정**한다.
- 가격을 알 수 없는 완료 호출이 있으면 한도를 설정한 경우 fail-closed로 막는다. 처리 중인 예약 호출도 비용을 모르는 상태로 간주해 추가 호출을 막는다.
- 비용 한도는 선택 사항이다. 기존 호출 횟수 한도는 별도로 계속 적용된다.

### Codex 구현

- 가격 출처·모델·버전·만료가 붙은 모델별 가격 스냅샷을 요구한다.
- 네트워크 요청 전에 입력/출력 최대 토큰으로 금액을 예약하고, 일일 한도와 호출별 한도를 모두 적용한다. 불명 결과와 한도 초과도 영속 영수증에 기록한다.
- 외부 provider는 명시한 가격/예산 설정이 없으면 차단하고, local 모델은 provider 비용 0으로 기록한다.

### 선택과 한계

PC 구현을 유지한다. Codex 방식을 그대로 옮기려면 기존 agent 호출 영수증과 저장 스키마, 모델별 가격·최대 token 수, 일일/호출별 한도 설정을 함께 바꾸고 마이그레이션·복구 시험을 해야 한다. 파일 하나만 교체하면 실제 호출 경로와 저장 형식이 어긋난다.

PC의 현재 비용 한도는 **정확한 청구액 보장이나 엄격한 단일 호출 상한이 아니다.** 가격표는 provider 단위 추정치이고 한 번의 진행 중 호출은 최대 비용을 미리 예약하지 않는다. 이 구현을 hard spend cap으로 설명하지 않는다. 외부 provider에 엄격한 지출 제한이 필요해질 때 Codex 설계를 기준으로 설정·마이그레이션·동시성 시험을 포함한 별도 F14 변경을 한다.

## 2. Shadow 성장

### PC 구현

- 독립 의미 검증을 통과하고, `resolveVerifiedResult`가 현재도 유효하다고 판단하는 미션만 XP를 준다.
- 역할별 차등 XP: scout 10, researcher 10, builder 20, verifier 5, semantic verifier 5.
- `(missionId, jobId)`로 중복을 막는다. 검증이 취소되거나 근거가 사라지면 XP에서 제외하고 held/failed 상태와 이유를 보여준다.
- E~S 등급 엔진과 실행 권한을 바꾸지 않는다.

### Codex 구현

- `(검증된 mission, role)`마다 25 XP를 주고 100 XP 단위로 레벨을 올린다.
- scout/researcher는 해당 작업 산출물이 의미 검증의 근거 목록에 실제 들어간 경우에만 기여자로 계산한다. 검증된 mission evidence와 등록된 artifact를 확인한다.
- 통과 미션을 기준으로 한 projection이라 PC 쪽처럼 failed/held 사건 이력을 자세히 보여주지 않는다.

### 선택과 한계

PC의 기존 규칙·화면 계약을 유지한다. Codex의 근거 참조 기준은 유용하지만 적용하면 XP 산식과 참가 자격이 바뀌어 과거 레벨도 달라질 수 있다. 이를 원한다면 `SHADOW_GROWTH_VERSION` 변경, 이전 기록 표시 규칙, 기존 XP 전환 정책을 별도로 정하고 테스트한다. 지금은 Codex XP 수치를 PC 사용자에게 적용하지 않는다.

## 3. 임베딩 기억

### PC 구현

- 사실 텍스트와 float embedding을 같은 기억 레코드에 저장하며, 생성·수정·soft-delete를 지원한다.
- Ollama loopback endpoint만 허용한다. 실제 PC에서 `qwen2.5:3b`와 `bge-m3`로 저장→재시작→다른 표현 질의→수정→삭제 제외→인터넷 차단을 확인한 보고가 있다.
- 이 실사용 증거는 그 테스트를 실행한 SHA에만 귀속한다. 이번 후보 SHA에서 재검증 전에는 새 코드의 live 증거로 취급하지 않는다.

### Codex 구현

- 기존 기억 ID에 연결한 별도 int8 압축 인덱스를 저장한다.
- 기억 본문 SHA, embedding model/revision, 차원, fingerprint를 검사해 본문이 바뀐 오래된 인덱스를 거부한다. 응답 크기·시간·인덱스 개수도 제한한다.
- PC의 CRUD/soft-delete 저장 구조와 다른 schema이며, PC가 검증한 Ollama 요청 계약과도 차이가 있다.

### 선택과 한계

PC의 기억/embedding 저장 구조와 live 검증 경로를 기준으로 유지한다. Codex 구현으로 통째 교체하지 않는다. 이후 본문 해시 연결, 차원·크기 제한, timeout 같은 방어 기능을 옮기려면 현재 레코드에 additive migration을 설계하고 Ollama 실제 요청·백업/복원·수정/삭제를 새 최종 SHA에서 다시 검증한다.

## 코드 변경과 별도 처리한 항목

- 이번 코드 슬라이스는 세 중복 모듈의 규칙이나 저장 형식을 바꾸지 않는다.
- 별도 변경으로 `/api/voice`의 `expectedQuestId` 사전조건 게이트와 living-loop live check를 PC API 계약에 맞춰 이식한다.
- live check는 loopback 주소만 허용한다. 기본 실행은 읽기 전용 사전 점검이고, `--run`은 명시적으로 요청할 때 기존 프로젝트 목표 하나를 대상으로 voice 요청 하나만 보낸다. 응답이 불명확하면 새 요청 ID로 재시도하지 않는다.
- live check가 정상 완료되어도 OS 전체의 네트워크 송신 0건, 서버 재시작 지속성, JEV의 실사용 복구까지 증명하지 않는다.

## live check 실행 순서

패치를 PC 브랜치에 적용해 커밋한 다음, 그 커밋의 코드로 YENO를 재시작한다. 기존 owner token은 PC의 로컬 PowerShell 프로세스 환경에서만 `YENO_TOKEN`으로 설정하고 채팅이나 로그에 출력하지 않는다.

```powershell
cd $env:USERPROFILE\Documents\Projects\yeno-os\runtime
$env:YENO_ORIGIN = 'http://127.0.0.1:8790'
$env:YENO_LIVING_LOOP_EXPECTED_SHA = (git -C .. rev-parse HEAD).Trim()
$env:YENO_LIVING_LOOP_EXPECTED_MODEL = 'qwen2.5:3b'
npm run check:living-loop
```

첫 실행은 읽기 전용이다. `PREFLIGHT_READY`와 목표 ID가 확인된 뒤에만 소유자가 원하면 실제 한 번의 임무를 실행할 수 있다. 새 고유 실행 ID를 정하고 목표 ID를 사용한다.

```powershell
$env:YENO_LIVING_LOOP_QUEST_ID = '<사전 점검이 표시한 목표 ID>'
$env:YENO_LIVING_LOOP_CHECK_ID = '20260924-01'
npm run check:living-loop -- --run
```

`VERIFIED`는 해당 미션에서 local model receipt, 필수 Shadow 역할, 두 검증기, JEV 관찰이 이어졌다는 뜻이다. `UNKNOWN`이면 요청이 서버에 도착했는지 불분명하므로 새 ID로 재실행하지 말고 기존 request/mission을 먼저 확인한다. token은 결과에 포함하지 않도록 구현되어 있다.
