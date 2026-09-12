"""Show the uploaded test APK and its existing build evidence in Actions."""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

info = json.loads(Path('build-artifacts/android/build-info.json').read_text())
url = os.environ['APK_DOWNLOAD_URL']
parts = urlsplit(url)
prefix = '/' + os.environ['GITHUB_REPOSITORY'] + '/actions/runs/'
if parts.scheme != 'https' or parts.netloc != 'github.com' or not parts.path.startswith(prefix):
    raise SystemExit('APK upload did not return the expected GitHub artifact URL')
lines = ['## BLACKHOLE Android APK', '', f'[APK 다운로드]({url})', '',
         f"빌드 소스: `{info['commit']}`", '',
         'ARM64 개발용 APK입니다. 설치·실기기 확인은 별도이며 서버 배포를 변경하지 않습니다.', '',
         '| 파일 | bytes | SHA-256 |', '| --- | ---: | --- |']
for item in info['artifacts']:
    lines.append(f"| {item['file']} | {item['bytes']} | `{item['sha256']}` |")
for item in info['artifacts']:
    if item.get('same_signer_as_original_apk') is False:
        lines.extend(['', '**기존 배포 APK와 서명이 다릅니다. 기존 앱을 삭제해 설치하지 마세요.** 기존 앱 연결·접수 기록을 보존하고 웹 운영실을 사용하세요. 신규 설치와 기존 설치 위 업데이트는 다릅니다.', ''])
    if item.get('signer_sha256'):
        lines.append('검증한 공개 서명 인증서 SHA-256: ' + ', '.join(f'`{value}`' for value in item['signer_sha256']))
lines.extend(['', '다운로드 묶음에 APK·build-info.json·SHA256SUMS.txt가 포함됩니다. 보관 기간은 7일입니다.', ''])
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as out:
    out.write('\n'.join(lines))
