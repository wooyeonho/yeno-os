# BLACKHOLE 폰 실연결 수락시험 — 2026-09-21

이 문서는 PR #52의 현재 Android APK 후보를 **실제 코어와 연결해 확인하는 절차**다. APK가 만들어졌다는 사실만으로 폰 연결이나 결과 재접속이 끝난 것으로 표시하지 않는다.

## 전제

- APK는 이 PR의 exact head에서 GitHub Actions가 만든 ARM64 debug artifact여야 한다.
- 폰과 PC는 같은 **owner가 선택한 HTTPS 코어**에 접근해야 한다. Windows의 `127.0.0.1`/로컬 코어 주소는 폰에서 접근할 수 없다.
- 코어 주소는 공개/사설 HTTPS 경로 중 owner가 직접 운영·승인한 것만 사용한다. TLS 인증서와 방화벽은 먼저 확인한다.
- 연결 키와 보관소 암호는 채팅·이슈·로그에 붙여넣지 않는다. 앱 입력란에서만 입력한다.
- Koyeb/Vercel/Supabase/기존 운영 DB를 이 PR이 자동으로 바꾸거나 마이그레이션하지 않는다.

## 설치

1. Android Actions run의 `yeno-android-debug-<exact-head>` artifact를 내려받아 APK를 설치한다.
2. 앱을 열고 코어 주소에 `https://...`를 입력한다.
3. owner pairing/연결 키를 입력하고, Stronghold 보관소 암호를 새로 정한다.
4. **이 기기 연결**을 눌러 기기 등록이 성공했는지 확인한다. 상단 상태가 연결됨이고 오류가 없어야 한다.
5. 앱을 닫았다가 다시 열어 같은 코어 주소와 보관된 기기 토큰으로 재접속되는지 확인한다.

## 한 번의 명령→결과 시험

1. 명령에 `문서 만들어: 폰 실연결 수락시험 <현재시각>`을 입력한다.
2. 명령 접수를 누른 뒤 작업 ID와 접수 상태를 기록한다.
3. 새로고침/재접속 후 같은 작업이 중복으로 생기지 않는지 확인한다.
4. 작업이 완료되면 결과 파일을 열고 다운로드 바이트와 서버가 보고한 SHA-256이 일치하는지 확인한다.
5. 앱을 종료·재실행한 뒤 같은 작업과 결과를 다시 조회한다.
6. **pause/resume/cancel/전체 멈춤** 중 하나를 공개/합성 문서 작업에서 시험한다. 외부 발송·결제·게시 작업에는 사용하지 않는다.

## 실제 모델 호출 시험

모델 공급자 키는 앱이나 저장소에 넣는 기능이 아니다. 현재 앱의 명령 시험은 코어의 provider/router와 기존 AI 설정을 사용한다.

1. PC 운영실에서 owner가 선택한 한 공급자의 실제 모델 ID와 API 키를 **직접** 설정한다.
2. 일일 호출 한도와 예산 한도를 먼저 낮게 설정한다.
3. AI 모듈을 owner가 명시적으로 켠다.
4. 공개/합성 문서에 한정해 `자율 임무: 연결 시험. 외부 전송 없이 BLACKHOLE_PROVIDER_OK만 반환`을 한 번 보낸다.
5. provider 상태가 `available`이고 결과에 실제 provider/model, request ID, 비용/호출 기록이 남는지 확인한다.
6. 실패·rate limit·unknown outcome이면 자동 재전송하지 말고 작업을 보류한다.

이 시험이 실행되기 전까지 PR/앱은 provider를 연결됨 또는 모델 품질 검증됨으로 표시하면 안 된다.

## 증거 기록 양식

- APK artifact URL:
- exact head:
- APK SHA-256:
- core origin:
- device enrollment time:
- request ID / job ID:
- result artifact SHA-256:
- close/reopen readback:
- pause/resume/cancel/stop:
- provider/model live status:
- failure or blocker:

실제 폰과 owner가 선택한 HTTPS 코어의 증거가 없으면 상태는 `physical acceptance pending`으로 유지한다.
