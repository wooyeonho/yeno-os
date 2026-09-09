# YENO controller

Tauri 2 controller for the versioned `/api/v1` core. The owner selects an HTTPS API origin; HTTP is limited to local development. The reusable owner pairing key enrolls a device, whose credential is stored in a password-protected Stronghold vault with an Argon2-derived key. Enrollment does not consume or invalidate the owner pairing key.

Pending commands and the last command receipt are stored in origin/device-scoped localStorage, without credentials. This command content is not encrypted by Stronghold. Uncertain responses retain the exact request identity; definitive rejections free the command slot. Memory search results and command receipts remain visible through polling.

## Build

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run tauri -- android init --ci --skip-targets-install
npm run tauri -- android build --debug --apk --target aarch64 --ci
```

Android builds require the Rust/SDK/NDK setup in [the build guide](../../docs/ANDROID_BUILD.md). The manual GitHub workflow can build the selected source ref and upload an APK only after compilation succeeds. Frontend build success does not verify native behavior. The committed source contains no core, provider, or signing secret.
