# Android controller build and connection

## Implemented source path

`apps/controller` is a Tauri 2 application. It calls only the versioned `/api/v1` contract, requires an explicit core origin, rejects cleartext remote origins, exchanges the owner pairing token for a revocable device token, and stores that connection in a password-protected native Stronghold vault. The command request ID remains stable until the server acknowledges it.

The core must be a **single process** using one persistent `YENO_DATA_DIR`. Put it behind an HTTPS reverse proxy whose public hostname is included in `YENO_ALLOWED_HOSTS`. Do not copy `pairing-token`, provider keys, or signing keys into the app or repository.

## Pinned build inputs

- Node: 24 (`.node-version`)
- Rust/Cargo: stable toolchain
- JDK: 17 or newer compatible with the installed Android Gradle plugin
- Android SDK Platform and Build Tools
- Android NDK with `ANDROID_HOME` and `NDK_HOME`/`ANDROID_NDK_HOME`
- Rust target: `aarch64-linux-android`

```bash
cd apps/controller
npm ci
npm run build
npm run tauri android init
rustup target add aarch64-linux-android
npm run tauri android build -- --apk --target aarch64
```

No signing secret is committed. A debug APK is only a test artifact. A durable owner signing key and protected CI secret are required before treating repeat updates as a release channel.

## Device acceptance (not yet executed)

1. Start the persistent HTTPS core and note its pairing token locally.
2. Install the generated APK and enter the core origin, pairing token, and an owner vault password.
3. Submit `문서 만들어: Android 재접속 확인` and record the returned job ID.
4. Wait for completion, open the artifact, and compare its server `X-Content-SHA256` to the downloaded bytes.
5. Force-close the app, reopen it, unlock the native vault, and confirm the same job/result.
6. Submit a second document, pause it, close/reopen, and resume it explicitly.
7. Revoke this controller and confirm subsequent `/api/v1/state` calls return 401.

Record installation, Android version/device, APK SHA-256, each job ID, artifact SHA-256, and observed failures in `docs/DEVICE_ACCEPTANCE.md`.
