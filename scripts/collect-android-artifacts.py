"""Collect only built APKs and non-secret evidence; fail if the build produced none."""
from pathlib import Path
import hashlib
import json
import os
import re
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
config = json.loads((root / 'apps/controller/src-tauri/tauri.conf.json').read_text())
sdk_tools = Path(os.environ['ANDROID_HOME']) / 'build-tools/35.0.0'
# Public certificate parsed from the original delivered APK, whose file hash
# was independently rechecked. This is not a signing key.
reference_apk = '38de18459ef84735ef2d0c36f890cc3f4bb188d57d7b77eec6f369eb7d47ddd6'
reference_certificate = '6a9df77d9729f0b538fae81928fa32cc1eb70766cc36ad8ce039d73d8374ab00'
for index, apk in enumerate(apks, start=1):
    signing = subprocess.check_output([str(sdk_tools / 'apksigner'), 'verify', '--print-certs', str(apk)], text=True)
    certificates = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})$', signing, re.M)
    if not certificates:
        raise SystemExit('APK signature verification returned no signer certificate.')
    badging = subprocess.check_output([str(sdk_tools / 'aapt'), 'dump', 'badging', str(apk)], text=True)
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
    if not package or package[1] != config['identifier'] or int(package[2]) != config['bundle']['android']['versionCode'] or package[3] != config['version']:
        raise SystemExit('APK identity/version differs from the source configuration.')
    # Flatten paths without allowing equal filenames to overwrite one another.
    name = f'yeno-android-debug-{index}.apk'
    shutil.copyfile(apk, target / name)
    raw = apk.read_bytes()
    entries.append({'file': name, 'source': apk.relative_to(root).as_posix(),
                    'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
                    'package': package[1], 'version_code': int(package[2]), 'version_name': package[3],
                    'signature_verified': True, 'signer_sha256': [value.lower() for value in certificates],
                    'same_signer_as_original_apk': certificates == [reference_certificate]})
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
(target / 'build-info.json').write_text(json.dumps({
    'commit': revision, 'kind': 'Android ARM64 debug test build',
    'device_verified': False, 'persistent_core_deployed': False, 'artifacts': entries,
    'reference_apk_sha256': reference_apk,
    'reference_signer_sha256': reference_certificate,
    'installation_note': 'Do not uninstall an existing app to work around a signer mismatch. Preserve its connection and pending requests; the hosted web controller remains available.',
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(target / 'SHA256SUMS.txt').write_text(''.join(
    f"{entry['sha256']}  {entry['file']}\n" for entry in entries), encoding='utf-8')
print(f'Collected {len(entries)} APK(s) for commit {revision}')
