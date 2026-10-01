# BLACKHOLE Windows owner dialogs

Scope: `pair-blackhole-phone.ps1` and its owner-only modal dialogs. The JARVIS web surface has a separate contract in `runtime/public/DESIGN.md`.

The native window is a quiet setup utility, not a second cockpit. Use Windows system controls, system text scaling, Korean labels, and a clear owner action on every button. The first visible row after the QR image offers two distinct actions: create a phone QR or approve a browser request. Neither action silently triggers the other.

Browser approval requires the full 36-character reference visible in the requesting browser. It is not a credential. The owner must compare it before selecting **이 브라우저 연결 승인**. The approval modal never renders or asks for the owner bearer, phone invitation token, or remote provider key. Invalid and expired references have separate visible outcomes from success, and failed approval leaves the action retryable.

The QR must remain 360×360 for scanning; buttons are at least 42 px high. Controls use normal Windows focus order and a visible native focus indicator. Remote provider key entry remains masked and its one-shot model test remains an explicit, separate action with a cost warning. A synthetic screen capture proves layout only; actual owner clicks and physical phone acceptance require their own evidence.

## Connector panel

The same owner window has two native tabs: **기기 · 모델 설정** retains the existing setup controls; **커넥터 목록** presents the core's connector status. The window uses a 450×735 logical-pixel client area and system font scaling. Each tab scrolls vertically as needed. Content keeps the established 20 px side inset; the 360×360 QR is unchanged. No custom colors, typefaces, effects, or alternate credential form are introduced.

The connector list uses native full-row selection with a title and a textual status. Its height fits complete native rows, using the system font's measured row height so the final visible row is not cut off. The selected item expands below it into the full title, upstream name, license, pinned version, reason, and last-check evidence. Missing version or license evidence is shown as **미확인**. The status labels are **설치 안 됨 / 설치됨 / 내 입력 필요 / 연결됨 / 막힘 / 어댑터 미구현**. Synthetic success is **합성 검사 통과**, with evidence explicitly labeled **합성 시험**; it is never labeled as a real connection by the view. Expired receipts change to **검사 만료** locally without another network call, and known model-setting restarts clear the prior list.

**목록 새로고침** only reads registry status. **1회 시험 연결** is enabled only for a selected row with `canCheck:true`, and sends exactly one check. Both buttons are at least 42 px high. No check occurs when opening or switching tabs. Loading disables conflicting actions while keeping the window responsive; a fixed Korean error leaves the previous list labeled as stale and retryable. An empty response clears old selection and disables the check. Successful checks refresh only the selected row from the core response, display the actual evidence, and never enable AI or autonomous work. Owner bearer and connector keys never appear in a control or status message.
## Search credential staging dialog

A separate **검색 키 보관** button below model settings opens a 410×390 native modal. It uses the same 20 px inset, 370 px content width, system font and 42 px buttons. Provider selection starts empty. Key input is masked and cleared after every save attempt and on close. The credential status is only **저장됨 / 미설정**; errors are a separate fixed message. Saving never searches, restarts the core or activates code. A persistent notice says **공급자 어댑터 미연결 · 실검색 미검증**. This is storage preparation, not a working search connection. SearXNG requires no key and is not an option in this key-only dialog.
