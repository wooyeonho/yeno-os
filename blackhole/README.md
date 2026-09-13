# Black Hole OS — A단계 실행 기반

첨부된 `Black_Hole_Seven_Drives_Strategy.md`를 실제로 돌려보기 위한 Node.js 20+ 무의존성 MVP입니다.

현재 구현 범위는 다음과 같습니다.

- 일곱 욕망의 목표 후보 생성과 근거·비용·권한·성공 기준이 있는 퀘스트 계약
- 강욕·명예·인지도에 대응하는 `wealth / honor / fame` 성과 장부
- 승인 → 실행 → 증거 → 독립 평가 → 스킬 추출 → 제한 활성화 흐름
- E~S 승급 조건 계산. 호출 수나 문서 수만으로 승급하지 않음
- 원자적 상태 저장, 이벤트 로그, 재시작 시 실행 중 작업의 `interrupted` 복구
- 전체/개별 중단과 실패·중단 작업 재시도
- 휴대폰 브라우저에서 확인할 수 있는 최소 제어 화면과 HTTP API
- OpenAI-compatible, Anthropic, Code Astra-compatible endpoint의 안전한 상태 확인 경계

실제 API 키가 없는 상태에서는 공급자 호출을 성공으로 표시하지 않습니다. `check`는 설정 상태만 보고하고, `check --live`를 직접 실행했을 때만 짧은 연결 확인 호출을 합니다.

## 실행

```bash
npm test
npm run blackhole -- init
npm run blackhole -- status
npm start
```

기본 화면은 `http://127.0.0.1:8787`입니다. 같은 Wi-Fi의 휴대폰에서 쓰려면 먼저 원격 접근 토큰을 설정하고, 방화벽·VPN 범위를 확인한 뒤 명시적으로 바인딩합니다.

```bash
export BLACK_HOLE_ACCESS_TOKEN='16자 이상인 별도 토큰'
export BLACK_HOLE_HOST='0.0.0.0'
npm start
```

토큰 없이 비루프백 주소로 서버를 열 수 없게 되어 있습니다. 공개 인터넷에 직접 노출하지 말고 VPN 또는 안전한 터널을 사용하세요.

## 한 바퀴 실행 예시

```bash
# 1) 일곱 동기로 후보 생성
npm run blackhole -- propose "반복 보고서 작성 시간을 줄이기" --budget 0 --duration 60

# 2) 출력된 quest ID 하나를 승인·시작
npm run blackhole -- approve quest_<id>
npm run blackhole -- start quest_<id>

# 3) run ID에 증거 추가 후 완료
npm run blackhole -- evidence run_<id> --summary "산출물과 실행 기록을 독립 검토함" --verified
npm run blackhole -- complete run_<id> \
  --output artifacts/work-a.md \
  --independent --quality 0.9 --new-input \
  --regression-pass --recovery-pass

# 4) 재사용 스킬 후보 추출 → 별도 조건을 확인하고 제한 활성화
npm run blackhole -- extract run_<id> --name "보고서 검토 절차"
npm run blackhole -- activate skill_<id> \
  --approved-by "연호님" --tests-passed \
  --license-reviewed --secrets-removed --isolation-pass
npm run blackhole -- assess skill_<id>
```

`<id>`는 명령 출력의 실제 ID로 바꿔야 합니다. 승인·결제·게시·민감정보 전송은 이 MVP가 자동으로 수행하지 않습니다.

## 공급자 설정

`.env.example`을 참고해 환경변수를 설정합니다. 비밀값은 상태 화면이나 이벤트 로그에 기록하지 않습니다.

```bash
npm run blackhole -- providers       # 키를 사용하지 않는 설정 상태
npm run blackhole -- check           # 동일한 비실행 점검
npm run blackhole -- check --live    # 설정된 공급자에만 실제 짧은 연결 확인
```

기본적으로 OpenAI-compatible와 Anthropic을 2종 공급자 경계로 두고, Code Astra는 실제 엔드포인트와 키가 제공될 때만 활성화합니다. Codex·Claude Code는 이 저장소가 임의로 자동 실행하지 않으며, 승인된 실행 도구를 연결할 수 있는 공급자/작업 경계로 남겨두었습니다.

## 저장되는 것

`BLACK_HOLE_DATA_DIR` 아래에 다음 파일이 생성됩니다.

- `black-hole.state.json`: 현재 상태. 실행 중 재시작하면 해당 실행은 `interrupted`로 바뀝니다.
- `black-hole.events.jsonl`: 퀘스트·실행·증거·스킬·중단·복구의 감사 이벤트

기존 전략 문서는 수정하지 않았습니다. 이 구현은 전략의 A단계와 B단계의 최초 한 바퀴를 검수할 수 있게 만든 기반이며, 실제 고객 가치·유료 거래·외부 명예·인지도는 별도 증거가 쌓여야 완료로 인정합니다.
