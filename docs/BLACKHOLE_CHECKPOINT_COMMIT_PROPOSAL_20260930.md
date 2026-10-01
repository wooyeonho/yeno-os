# BLACKHOLE 체크포인트 커밋 제안 — 2026-09-30

상태: **제안만 작성, staging·commit·push 없음**. 기준 HEAD `e7b6dfef772665b2e7f237c0cc9f51f4663ee211`, 브랜치 `blackhole/p3-jev-recovery-port-20260924`. 작업 트리에는 이미 여러 작업의 미커밋 변경이 섞여 있으므로 전체 파일을 한 번에 담는 커밋은 제안하지 않는다. 정확한 당시 경로 목록은 `build-artifacts/concept-20260930/p1-checkpoint-working-tree.txt`에 보존한다. 이 목록은 현재 상태의 스냅샷이며 파일 소유권이나 안전한 커밋 범위를 자동 판정하지 않는다.

| 제안 단위 | 검토할 파일군 | 수락 근거 | 상태 |
| --- | --- | --- | --- |
| P0 개념·인수 | G1 근거 검증, C1~C5, 욕망 v3, L5 관련 `runtime/lib/`, `runtime/test/`, `runtime/server.mjs`, `runtime/public/`, `scripts/verify-*-live.mjs` | §140~§150, 체크포인트 전체 회귀 최종 1424/1403/0/21, L5 인과 체인 및 화면 산출물 | 승인 대기; 기존 변경과 정확한 파일 경계 재검토 필요 |
| P1 검증 도구 | `scripts/run-tests.mjs`, `scripts/test-tiers.mjs`, `scripts/test-tiers.test.mjs`, `scripts/status-from-log.mjs`, `scripts/status-from-log.test.mjs`, `package.json`, `docs/STATUS.json`, P1 문서·기록 | fast <60초, 분할·변경 파일 선택 시험, 상태 생성 반복·해시 검사 | 승인 대기 |
| 그 외 작업 트리 | 위 두 묶음에 속하지 않는 기존 변경·신규 파일 | 별도 출처·검증 필요 | 이번 제안의 자동 포함 대상 아님 |

제안 실행 전에는 소유자가 두 단위의 정확한 diff와 경계를 검토해야 한다. 동결 3파일은 어느 제안 단위에도 포함하지 않는다. 승인 여부가 결정되기 전에도 독립적인 구현·시험은 계속할 수 있다.
