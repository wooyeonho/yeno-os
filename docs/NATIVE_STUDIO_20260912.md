# BLACKHOLE Android 운영실 0.2.0

## 구현과 실행 범위

기존 `kr.yeno.controller` 앱에 운영실, God Eye, 명령·결과 화면을 연결했다. 운영실은 배포된 웹과 같은 화면 모듈을 번들에 포함한다. For-Ai 분석, 여기 장소, 동의 기반 한끼안부, 소설 시리즈/원고/AI 집필, 자막 MP4를 기존 `/api/v1`과 기기 인증으로 사용한다. God Eye는 USGS·NASA 공개 재난 범위다. Grok Bot은 기존 공식 링크와 계정 연결 대기 상태를 표시한다.

기존 코어 `018ac0ad` API와 호환된다. 이 앱 변경으로 운영 코어를 교체하거나 새 모델을 호출하지 않는다. Gemini의 기존 하루20회 한도와 전체 멈춤은 코어가 집행한다.

## 데이터와 결과

- 운영실의 미확인 요청은 origin/기기별 Stronghold 레코드다. 요청을 암호화 보관소에 저장한 뒤 서버에 전송한다. 보관소 저장 실패 시 전송하지 않고, 응답 유실이나 접수 기록 삭제 실패 시 같은 요청 ID를 유지한다. 이 새 요청 본문을 localStorage로 복사하지 않는다. 이전 일반 명령의 localStorage 보존 방식은 별도다.
- MP4를 바이너리로 받아 SHA-256·크기·형식을 확인하고 앱의 영상 요소에 연결한다. 텍스트는 원문으로 표시한다. HTML을 실행하지 않는다. 다운로드는 최대8MiB다.
- 원고·장소·안부 내보내기와 작업 파일은 Android 파일 저장 창으로 내보내고 같은 파일을 다시 읽어 해시를 확인한다. 취소나 쓰기/읽기 실패를 저장 성공으로 표시하지 않는다.
- HTTPS 외부 링크는 시스템 브라우저에서 열고 기기 인증을 링크에 넣지 않는다. 연결 변경·폐기 때 이전 결과와 영상 객체 URL을 지운다.

Android 저장은 Tauri [Dialog 2.4.0의 ACTION_CREATE_DOCUMENT](https://github.com/tauri-apps/plugins-workspace/blob/dialog-v2.4.0/plugins/dialog/android/src/main/java/DialogPlugin.kt)와 [FS 2.4.2의 Android content URI 처리](https://github.com/tauri-apps/plugins-workspace/blob/fs-v2.4.2/plugins/fs/src/commands.rs)를 사용한다. OS가 선택한 파일의 접근 권한을 사용하며 전체 디스크 쓰기 범위를 추가하지 않았다.

## 검증

Node24.19.0 회귀 검사 **293/293**, 실패·취소·생략0,29.012초. 실제 ffmpeg/Pillow/한글 폰트 렌더링을 필수로 실행했다. 네이티브 저장소·파일 선택/쓰기/읽기 오류는 주입한 I/O로 검사했으며 Android OS의 실행 증거와 구분한다.

빌드된 HTML/JS를 JSDOM에서 실제 임시 코어와 연결했다. 기기 등록→장소 저장→시리즈/회차 저장→파일 내보내기/동일 내용 재읽기→For-Ai 실제 작업→결과 열기/복사→실제 한글 MP4 생성→영상 요소 연결/파일 내보내기→UI 종료/재실행→기기 폐기를 통과했다. MP4 38,632바이트, SHA-256 `8f25374f6db6676c945ae31a574ab23332bcad59299d74f7e9959da698772173`. **Rust IPC/보관소/파일 선택기/영상 플레이어는 이 UI 검사에서 모의 구현이다. Android 설치·암호화 실행·실제 화면/재생 검증은 아니다.**

재현:

```sh
npm ci --prefix apps/controller --ignore-scripts --no-audit --no-fund
npm run build:controller
npm --prefix apps/controller run verify:ui
npm test
```

UI 검사에서 실제 영상 렌더러를 사용할 수 없으면 영상 단계만 명시적으로 빠진다. 위 실제 영상 증거는 로컬에 ffmpeg/Pillow/한글 폰트를 준비한 실행이다.

## APK 설치와 서명

앱 버전0.2.0, versionCode2000, ARM64, Android9 이상. 기존 앱 식별자·보관소 이름을 유지한다. 디버그 심볼을 제외해 시험 APK 전송 용량을 줄인다. CI는 실제 패키지/버전·서명·APK SHA-256을 검사하고 결과를 build-info.json에 기록한다. 앱이 참조하는 공통 화면 파일도 자동 빌드 입력에 포함했다.

원래 전달한 APK SHA-256 `38de18459ef84735ef2d0c36f890cc3f4bb188d57d7b77eec6f369eb7d47ddd6`를 재확인하고 공개 서명 인증서 SHA-256 `6a9df77d9729f0b538fae81928fa32cc1eb70766cc36ad8ce039d73d8374ab00`을 추출했다. 새 APK가 같은 인증서인지 실제 빌드 후 비교한다. **기존 앱의 서명 키는 이 작업 공간에 제공되지 않았다. 서명이 다른 APK를 설치하려고 기존 앱을 삭제하지 않는다.** 기존 연결과 접수 대기 기록을 유지해야 한다. 지속적인 앱 업데이트에는 소유자 관리 서명 키가 필요하다.

APK 빌드 성공과 휴대폰 설치/재생/파일 저장 검증의 실제 상태는 STATUS.md의 최신 기록을 따른다. 실행 전 문서나 프런트엔드 빌드만으로 APK 완성을 표시하지 않는다.
