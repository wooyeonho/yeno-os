# Windows EXE build boundary

`.github/workflows/windows-debug.yml` builds the existing Tauri controller on a
native GitHub Windows runner and uploads the unsigned NSIS installer (`.exe`,
and any `.msi` produced by the bundle). The workflow records the exact source
commit, byte count, and SHA-256 in `manifest.json`.

This is a test artifact, not a production release. It does not contain a core
address, pairing key, provider credential, or developer-worker permission.
Installing it on a physical Windows machine and connecting it to the owner's
core is a separate acceptance step. The current controller is a mobile/desktop
control surface; this workflow does **not** claim that a resident Windows
developer worker, arbitrary file editing, or unattended deployment is enabled.

## Acceptance order

1. Download the CI artifact and verify `manifest.json` against the artifact
   bytes.
2. Install on a disposable Windows profile and confirm the publisher is shown
   as unsigned (until an owner signing certificate is deliberately configured).
3. Enter the existing HTTPS core origin and device credential; do not paste a
   pairing key into a log or issue.
4. Run one harmless read-only state query, close the app, reopen it, and confirm
   the same request/result identity.
5. Only after that acceptance may a separate, explicitly approved Windows
   developer-worker slice be connected. The worker must remain sandboxed and
   owner-approved; it is not bundled into this controller artifact.
