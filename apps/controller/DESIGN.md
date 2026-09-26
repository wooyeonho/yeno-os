# BLACKHOLE controller design contract

## 1. Scope
Preserve the existing native controller and its Korean interface. Add safe enrollment to the existing auth card, without redesigning other screens.
## 2. Tokens
Reuse src/style.css: --bg, --panel, --panel-2, --line, --accent, --text, --muted, --danger, --warning, --shadow. Existing Inter/system-ui typography and spacing remain authoritative.
## 3. Layout
Use existing app-shell/auth-card/form/label/button primitives. Android uses QR scan; Windows also offers its installed local resident through native IPC; selected private core address and invitation expiry are visible before enrollment.
## 4. Typography
Reuse current heading, muted paragraph and label styles. Error and expiry messages are plain Korean.
## 5. Components and states
Auth card: idle, scanning, invitation selected, enrolling, failed/expired, connected. Existing button disabled state prevents duplicates. Starting another scan clears the previous selection so cancellation cannot connect to an old PC. Password inputs retain existing Stronghold protection. Never render secret text or log scanned contents.
## 6. Interaction and accessibility
Explicit scan and connect actions. aria-live status, visible labels, keyboard buttons. No auto-camera access on page load. Existing saved connections reopen without scanning. PC owner pairing uses native Windows controls with an expiring QR and cancel action.
## 7. Verification
Test parser and enrollment identity, compile TypeScript, inspect actual browser at mobile/tablet/desktop sizes. Native camera/Stronghold require Android build/device verification separately; browser mocks cannot verify them.
