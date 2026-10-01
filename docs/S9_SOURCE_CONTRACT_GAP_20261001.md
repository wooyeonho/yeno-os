# S9 실측 출처 계약 대조

`outcome-verification.mjs`의 기존 지표와 출처 허용표를 실제 코드에서 다시 읽었다. 현재 `adoption.installs`는 `package_registry`·`app_store` 설치 수이고, `fame.followers`는 `publication_platform`·`analytics_platform` 팔로워 수다. GitHub 저장소의 `stargazers_count`나 `watchers_count`는 설치 수도 팔로워 수도 아니다. 따라서 지시서의 “GitHub stars/watchers를 adoption 최소 출처로 재사용”이라는 문장을 현 계약에 억지로 연결하지 않았다. 별도의 지표나 권한 유형도 만들지 않았다.

소유자가 공식 읽기 전용 API를 제공하는 실제 분석·게시·정산 플랫폼을 고르기 전까지 세 커넥터는 `not_implemented`이다. 실제 수익·청중 값은 null/미측정이며 송금·결제 코드는 없다. `external_verified`는 S15의 제3자 attestation 없이는 0건이다.

1–5점 소유자 평가는 `resultRatings`에 `self_reported`·`owner_report`로만 저장한다. 성과 지표 `METRICS`에 별점을 새로 넣지 않고 욕망 v3 정산이나 독립 성과 검증으로 올리지 않는다. `motivation.mjs`의 버전 1 검증은 고정 `MISSING_MEASUREMENTS` 목록을 요구하므로 이 필드를 조용히 제거하지 않았다. 결정별 측정 가능 여부를 표시하려면 기존 기록의 하위 호환 스키마 전환과 같은 목표·산출물 연결 규칙이 먼저 필요하다. 미평가와 다른 목표의 평가를 측정 완료로 채우지 않는다.
