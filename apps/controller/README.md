# YENO controller

Tauri 2 controller for the versioned `/api/v1` core. The API origin is explicit; remote cleartext HTTP is rejected. Pairing exchanges the one-time owner token for a device credential, which is kept in the native Stronghold vault rather than browser storage. Unacknowledged command bodies retain their request ID in local storage so transport retries do not create another job.

## Build

```bash
npm ci
npm run build
npm run tauri android init
npm run tauri android build -- --apk --target aarch64
```

Android builds require the SDK/NDK variables described in `docs/ANDROID_BUILD.md`. The committed source contains no core, provider, or signing secret.
