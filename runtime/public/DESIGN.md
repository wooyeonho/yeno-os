# Jarvis face design system

Scope: sections 1–7 apply to `/jarvis` only. The existing cockpit keeps its own styles. The growth-view addition at the end applies only to the cockpit growth screen. This contract adapts the cinematic, full-bleed restraint of the Runway reference and the `redesign-skill`'s hierarchy and state discipline; no Runway marks or assets are copied.

## 1. Atmosphere & identity

A quiet observatory with one living instrument at its center. The memorable material is a lit, layered core in a deep graphite field: light and fine engraved rings communicate state, while surrounding chrome almost disappears. The core reflects runtime facts rather than a canned animation. Work remains the default route; conversation is an explicit owner switch. It always uses `/api/voice` with `chatOnly:true`, so command-shaped text cannot enter the work/control or voice decision-dispatch path. A failed conversation is never silently saved as an executable goal.

## 2. Color

| Role | Token | Value |
| --- | --- | --- |
| Void | `--j-bg` | `#07090d` |
| Deep field | `--j-field` | `#111722` |
| Pale ink | `--j-ink` | `#f0f2f2` |
| Secondary ink | `--j-muted` | `#a9b1bb` |
| Hairline | `--j-line` | `#48535f` |
| Glass | `--j-glass` | `#151d29` |
| Focus | `--j-focus` | `#9dc8c7` |
| Caution | `--j-warn` | `#e7b76c` |
| Failure | `--j-fail` | `#de8080` |

`jarvis.css` is the single token source. The canvas reads the same custom properties via `getComputedStyle`, including RGB variants for translucency. `--j-field-light`, `--j-field-deep`, `--j-core-*`, and the named RGB material tokens describe the field, instrument, glass, and controls. Fixed Seven Drive colors come from `jarvis-scene-model.mjs` because they are runtime semantics, not a second visual theme. Spacing and timing primitives live in `--j-gutter`, `--j-touch`, and `--j-motion-*`.

`jarvis-orb.mjs` owns only the canvas renderer. `jarvis.mjs` supplies the current core scene, measured tint, and heartbeat time; the renderer cannot issue commands or approve actions. Keep the canvas and CSS material values in this contract when changing either module.

The primary scene uses the locally bundled, MIT-licensed Three.js r186 WebGL2 renderer (`jarvis-webgl.mjs`) with a Fresnel-lit sphere and three independently rotating torus rings. The exact vendor version, integrity, and license are recorded in `vendor/three/NOTICE.md`. The original 2D scene stays as the automatic fallback when WebGL2 is unavailable or lost. Geometry and shader intensity constants are renderer material values; the palette still comes only from the tokens above. Both renderers consume the same runtime scene and never make model or control requests.

Seven Drive colors are semantic values from the core contract. The central scene keeps its quiet composition; the owner drawer contains the seven hunger curves and their original names with territory labels (for example, `오만 — 명예의 영토`). A dominant drive tints the inner light only when its status is actually measured above zero; otherwise the neutral focus token remains. Curves use only version 2 debate hunger snapshots. Old records without snapshots remain gaps, and a single recorded point remains a point. The graph has a fixed 0–100 scale, seven labeled values, and a text description of the recorded range; no value is extrapolated or generated in the browser.

Jarvis uses precise formal Korean, with an owner-configurable address (default `주인님`). Failure reports retain `숨기지 않겠습니다.` and never joke about failure or uncertainty. A recorded version 2 debate may appear during idle as two explicitly quoted lines: the leading push and one opposing contest. The quoted drives keep their own voices; Jarvis's narration remains formal. A separate cautious anticipation sentence uses only the persisted hungry voice identity, actual current hunger, and available roster/event counts. It authorizes no action. Completed results, failures, owner approval, active work, emergency stop, and offline speech take precedence.

In the existing owner drawer job list, a Shadow mission may append one named participant to the status line only when the durable assignment carries a preferred shadow whose evidence-derived rank is D or higher. This is identity text within the existing small metadata style; it changes no button, authority, concurrency, or scene animation.

## 3. Typography

Display and Korean body: `Segoe UI Light`, `Segoe UI`, `Malgun Gothic`, system sans; 300–400 weight. Data: `Cascadia Mono`, `Consolas`, monospace. The display speech is 22–40px, line-height 1.4; failure speech uses the quieter 22–30px band so its fixed Korean sentence remains readable without separating subject and predicate. Regular body is 16px/1.5; labels 12–14px/1.4; data 11.5–12px/1.4. Uppercase chrome is widely tracked, speech is not. No network fonts.

## 4. Spacing & layout

Base unit 4px. Reusable increments: 8, 12, 16, 24, 32, 40, 48, 64px. The canvas fills the viewport; header is anchored at the top, input at the bottom, speech just above it. The core stays optical center with room for speech. Desktop gutter 40px, mobile gutter 20px. At 400px the status cluster can wrap below the brand and the input remains within the viewport.

The result dialog shares `--j-space-2/4/6`, `--j-touch`, palette and type tokens with the face. `--j-dialog-width`, `--j-dialog-radius`, and `--j-dialog-shadow` define its reusable surface. Korean prose and lists keep words intact; only code and machine identifiers may wrap within a token.

## 5. Components and states

- **Scene canvas:** actual runtime-driven core, internal drive tint, satellites, waiting ring. States: offline desaturated, idle breathing, planning inner rotation, executing faster satellites, waiting fixed amber ring, reduced-motion static. The WebGL renderer uses the same state input; its three depth rings change speed with activity. The 2D fallback retains satellites and the waiting ring. Canvas has a text alternative in adjacent DOM.
- **Status cluster:** activity, provider/model, heartbeat time. Online/offline indicator is paired with text; it never conveys status by color alone.
- **Speech:** a formal report from a completed artifact or core state. A completed document shows its title and completion sentence; other text artifacts remain explicitly quoted previews at 120 characters. Idle anticipation requires a recorded debate and a correctly identified hungriest drive above 50. The two persisted debate quotations use 12–14px body text below the main sentence, with a short formal introduction, and disappear on result/failure/approval/active/offline states. A separate `전체 결과 보기` link reads the authenticated full artifact through the browser session and opens it in a dialog. The dialog renders document headings, paragraphs, lists, and fenced code as real text-only DOM elements; unsupported Markdown remains visible as text and is never injected as HTML. The same scrollable dialog fits a 400px viewport. On reconnect or page reopen, show the newest completed result once and keep it visible until a newer request or an offline transition. New text fades upward by 6px; error and fallback are announced with `aria-live`.
- **Command pill:** work/conversation mode, input, and submit button in one layered glass material: tinted fill, rim, soft sheen, deep shadow. Hover/press/focus/disabled/error are distinct; 44px minimum touch targets.
- **Connection gate:** owner-approved browser-device connection, with status and a visible approval reference. The legacy credential form remains in the DOM for `connectBrowser()` compatibility but is hidden; this face never asks someone to copy an owner secret.
- **Owner control drawer:** opened from the top status cluster. It shows real `core.autonomyMode`-related state, last heartbeat and pending approvals, plus the name-only Shadow roster from `/api/state.shadowArmy.roster` (zero entries are stated as zero; E means a registered shadow, not proven D-level execution). It controls the existing `/api/autopilot`, `/api/control`, and job action endpoints. Closed by Escape or its button. Actions are disabled while disconnected or in flight, server refusals are shown inline, and approval itself remains in the full owner cockpit.
- **Address setting:** labeled text field and 44px save button within the owner drawer, using the existing glass, hairline, focus, failure, and spacing tokens. Read/write uses authenticated `/api/jarvis/settings`; no chat command changes it. The field accepts up to 32 Unicode characters, normalizes NFC, rejects control characters, and reports validation, saving, saved, and server-error states inline. It stays disabled while disconnected or loading, preserves unsubmitted edits across polling, and reports completion only after the server accepts the setting.
- **Hunger history:** one accessible SVG chart in the owner drawer, with a seven-row text legend/value list using the canonical drive colors from `DRIVE_COLOR`. Reuse `--j-space-2/4/6`, `--j-line`, `--j-muted`, `--j-ink`, and the 12–14px data/body type scale. Plot dimensions are `--j-chart-height: 180px`; graph geometry has 28px left and 12px top/right/bottom in a 320×180 viewBox. Lines use 2px strokes plus endpoint dots, not filled areas, and remain static under reduced motion. Missing history displays a clear empty state, not a synthetic flat line. Disconnection removes stale curves and reports that history could not be verified.
- **Hunger history data:** a native `details` disclosure labeled `결정별 수치 보기` provides a color-independent alternative to the graph. Its semantic table uses exactly the same valid recorded snapshots, one dated row per decision and seven labeled numeric columns. Row/column headers and a caption explain the 0–100 scale and omitted unrecorded values. The disclosure retains its open state across polling. A labeled, keyboard-focusable scroll region contains horizontal overflow inside the drawer; no historical value is filled in. Use existing 12px data type, 8/16px spacing, hairline, ink, muted, and focus tokens.
- **System report:** the owner drawer reads `state.systemNotices` as plain quoted system records beneath a formal report introduction. No absent event is invented and no unchanged event is announced as new. Anticipation calls the generic `state.events` count `운영 기록`, because it also includes connection and settings audit events, not just failures or jobs.
- **Result actions:** completed results stay visible until a new request, disconnection, or the owner's explicit `실시간 상태로 돌아가기` button. This action uses the existing outlined result-link primitive, leaves the saved artifact untouched, and restores live speech without replaying previously seen results. The full result link remains available beside it while the result is shown.
- **Failure recovery:** hydration compares recorded terminal-job timestamps before choosing a report. A newer failure, cancellation, or stop blocks an older completed result from resurfacing. Its formal report and original error code remain together across polling until the owner uses the state-return button or sends a new request. The same action primitive is shown without an artifact link for a failed job. Connection loss reports its own state; reconnection rebuilds the report from the actual newest terminal record.

## 6. Motion & interaction

Micro 140ms ease-out; speech 320ms ease-out; orbit slow and continuous only when motion is allowed. Core breath is 4% radius amplitude. One outward wave is tied to a *changed* `lastHeartbeatAt`; it is not restarted by polling the same value. Reduced motion stops waves and orbital movement and retains only short opacity fades. Canvas drawing runs at bounded frame rate and pauses when the document is hidden.

## 7. Depth & surface

Mixed strategy, reserved for the input and central instrument: field uses radial light and engraved grid; core uses multiple concentric radial gradients and rings; input uses translucent graphite, `backdrop-filter`, a hairline rim, inset highlight, and a deep tinted shadow. Other chrome stays flat. This light stack is the signature material, not a generic gradient card.

## 8. Growth screen: verified execution trend

The cockpit growth screen uses its existing cards, typography, spacing and status tokens. A skill card may add one compact warning row when durable evidence contains at least ten terminal executions for that same skill. Show the exact verified counts for the previous five and latest five jobs, the window size, and an explicit statement that this is an execution-verification rate, not output quality or business outcome. A decline of two or more verified successes out of five is the warning threshold; one fewer is a watch state. With fewer than ten records, show no trend badge and do not imply stability. The warning is text-first, uses the existing failure status color only as reinforcement, remains readable at 400px, and never provides an auto-disable control. This display never changes the skill grade, execution rights, or approval flow.

## 9. Concept records (C1–C5)

Reuse the existing owner drawer and plain system report. Self-beautification displays a short measured-defect description; hashes and artifact identifiers remain in the evidence record. Shadow names use the existing button primitive to open a read-only mission summary in the result dialog. Beside the name show its evidence-derived rank title and active/stored status. Missing mission records are stated explicitly. These controls never dispatch work. Keyboard focus, text-only rendering, reduced motion and the 400px overflow contract remain mandatory.

The status cluster may show one equipped Kirby ability as plain text (`커비: glyph name`) using the existing status typography. The glyph is a deterministic identity marker, not a grade or power score; keep its full name readable through wrapping. An inactive or missing selection hides the marker. Star rejection reports actual recorded failed jobs in the drawer and never implies automatic reactivation.

## 10. Small evidence orbs

A 24px header orb may echo a stored core activity beside its text label. The source is the authenticated state response, with owner wait and verification taking precedence over work. Offline, idle, paused, stopped, emergency stop, or missing source yields a still dot. The existing central orb remains the visual focus. The small orb uses the pinned MIT Thinking Orbs geometry and palette-neutral dots; the adjacent Korean text carries the state. All small instances share one animation frame, stop when offscreen or the tab is hidden, and become static with reduced motion. The design must remain legible at 400, 768, and 1440px. Drive and shadow rows receive an orb only when their own durable activity source exists; no movement is inferred from a hunger value, roster membership, or decorative timing.

## 11. Owner result rating

The completed result area offers five numbered 44px controls with explicit 1–5 point labels. A recorded rating replaces the buttons with a plain self-reported status; an unrated result stays empty. The rating never appears for failure, offline, or approval wait, and never changes verified outcome, drive settlement, or model judgment. It is stored only after the owner-approved browser posts the actual completed artifact link. The main speech and full-result link remain primary; rating is a secondary line that wraps at 400px.

## 12. Stored-event stage (S17)

The public brand token defaults to `BLACKHOLE` until the owner chooses another name. Internal concept names stay in code and evidence. Beneath speech, a restrained three-row event surface shows only server-projected saved system notices for drive settlement, shadow changes and Kirby actions. It creates no event or command. Empty or disconnected state hides the surface. Each row carries a text category, so its color is never the sole cue. Glass, spacing and type use the existing dark tokens; no network font or sound plays. At 400/768/1440 pixels it stays inside the stage, and reduced-motion changes no information.
