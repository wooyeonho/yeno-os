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
lines = ['## YENO Android APK', '', f'[APK 다운로드]({url})', '',
         f"빌드 소스: `{info['commit']}`", '',
         'ARM64 개발용 APK입니다. 설치·실기기 확인은 별도이며 서버 배포를 변경하지 않습니다.', '',
         '| 파일 | bytes | SHA-256 |', '| --- | ---: | --- |']
for item in info['artifacts']:
    lines.append(f"| {item['file']} | {item['bytes']} | `{item['sha256']}` |")
lines.extend(['', '다운로드 묶음에 APK·build-info.json·SHA256SUMS.txt가 포함됩니다. 보관 기간은 7일입니다.', ''])
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as out:
    out.write('\n'.join(lines))
