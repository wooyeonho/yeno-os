# Device acceptance record

Status: **installation and initial screen observed; core pairing pending** (2026-09-09).

The owner supplied an Android screenshot showing YENO's initial `본체 연결` screen, the `연결 안 됨` status, and empty core URL / pairing key / vault password fields. This is evidence that the app was installed and opened on the owner's phone. It is not evidence of server connectivity, successful Stronghold storage, or command execution. No sensitive field values appear in the supplied screenshot.

| Acceptance step | Evidence |
| --- | --- |
| Install APK and open app | Owner screenshot received 2026-09-09; initial connection screen visible |
| Pair with persistent HTTPS core | Pending: no deployed core URL or pairing key yet |
| Store and unlock native credentials | Pending |
| Send command and read actual result | Pending |
| Close/reopen app and reconnect | Pending |
| Server restart preserves device/memory/jobs/results | Local process tests passed; actual host and phone still pending |
| Pause/resume/stop and device revocation | Core tests passed; phone interaction still pending |

Build results remain in `STATUS.md`. Use `RENDER_SETUP.md` for the prepared managed-host candidate and `ANDROID_BUILD.md` for the full phone acceptance procedure. Record only newly observed results; do not mark all device checks complete because the first screen opened.
