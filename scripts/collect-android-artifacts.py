"""Collect only built APKs and non-secret evidence; fail if the build produced none."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
outputs = root / 'apps/controller/src-tauri/gen/android/app/build/outputs/apk'
apks = sorted(outputs.rglob('*.apk'))
if not apks:
    raise SystemExit('No APK produced; this build cannot be reported as successful.')
target = root / 'build-artifacts/android'
target.mkdir(parents=True, exist_ok=True)
entries = []
for index, apk in enumerate(apks, start=1):
    # Flatten paths without allowing equal filenames to overwrite one another.
    name = f'yeno-android-debug-{index}.apk'
    shutil.copyfile(apk, target / name)
    raw = apk.read_bytes()
    entries.append({'file': name, 'source': apk.relative_to(root).as_posix(),
                    'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
(target / 'build-info.json').write_text(json.dumps({
    'commit': revision, 'kind': 'Android ARM64 debug test build',
    'device_verified': False, 'persistent_core_deployed': False, 'artifacts': entries,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(target / 'SHA256SUMS.txt').write_text(''.join(
    f"{entry['sha256']}  {entry['file']}\n" for entry in entries), encoding='utf-8')
print(f'Collected {len(entries)} APK(s) for commit {revision}')
