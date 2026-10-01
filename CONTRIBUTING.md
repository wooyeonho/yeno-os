# BLACKHOLE 기여 규칙

기여 전에 [실행 기록](docs/CLAUDE_EXECUTION_STATE.md), [상태 등록부](docs/STATUS.json), [개념 정전](docs/BLACKHOLE_CONCEPT_CANON_20260928.md)을 읽어 주세요. 기능 주장에는 재현 명령, 실제 실행 로그, 산출물 해시와 합성/실증 구분을 남깁니다. 테스트를 약화해 회귀를 통과시키지 않습니다.

`runtime/lib/solo-leveling.mjs`, `runtime/lib/recovery-one-of-qpu.mjs`, `workers/developer/static-guard.mjs`는 현재 동결된 파일입니다. JEV의 `authorizesDispatch:false`, 소유자의 최종 활성화 승인, 자격정보 비노출, Vault 원문 불변을 지킵니다. 외부 코드는 출처·라이선스·고정 버전·해시를 확인하고 격리 시험을 거칩니다. 제안만으로 코드를 실행 경로에 붙이지 않습니다.

저장소 전체의 공개 라이선스는 소유자 결정 대기 중입니다. 현재 파일의 공개 열람이나 PR 제출이 재배포 허가를 뜻하지 않습니다. 공개 배포·외부 테스터 접촉은 별도 승인 후 진행합니다.
