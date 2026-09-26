# Jarvis face design system

Scope: `/jarvis` only. The existing cockpit keeps its own styles. This contract adapts the cinematic, full-bleed restraint of the Runway reference and the `redesign-skill`'s hierarchy and state discipline; no Runway marks or assets are copied.

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

Seven Drive colors are internal semantic values from the core contract. No drive arc, table, number, label, or legend appears on the Jarvis face. A dominant drive tints the inner light only when its status is actually measured above zero; otherwise the neutral focus token remains.

## 3. Typography

Display and Korean body: `Segoe UI Light`, `Segoe UI`, `Malgun Gothic`, system sans; 300–400 weight. Data: `Cascadia Mono`, `Consolas`, monospace. The display speech is 22–40px, line-height 1.4; regular body 16px/1.5; labels 12–14px/1.4; data 11.5–12px/1.4. Uppercase chrome is widely tracked, speech is not. No network fonts.

## 4. Spacing & layout

Base unit 4px. Reusable increments: 8, 12, 16, 24, 32, 40, 48, 64px. The canvas fills the viewport; header is anchored at the top, input at the bottom, speech just above it. The core stays optical center with room for speech. Desktop gutter 40px, mobile gutter 20px. At 400px the status cluster can wrap below the brand and the input remains within the viewport.

## 5. Components and states

- **Scene canvas:** actual runtime-driven core, internal drive tint, satellites, waiting ring. States: offline desaturated, idle breathing, planning inner rotation, executing faster satellites, waiting fixed amber ring, reduced-motion static. Canvas has a text alternative in adjacent DOM.
- **Status cluster:** activity, provider/model, heartbeat time. Online/offline indicator is paired with text; it never conveys status by color alone.
- **Speech:** one live sentence from a completed artifact or a core-derived sentence. New text fades upward by 6px; error and fallback are announced with `aria-live`.
- **Command pill:** work/conversation mode, input, and submit button in one layered glass material: tinted fill, rim, soft sheen, deep shadow. Hover/press/focus/disabled/error are distinct; 44px minimum touch targets.
- **Connection gate:** owner-approved browser-device connection, with status and a visible approval reference. The legacy credential form remains in the DOM for `connectBrowser()` compatibility but is hidden; this face never asks someone to copy an owner secret.
- **Owner control drawer:** opened from the top status cluster. It shows real `core.autonomyMode`-related state, last heartbeat and pending approvals, then controls the existing `/api/autopilot`, `/api/control`, and job action endpoints. Closed by Escape or its button. Actions are disabled while disconnected or in flight, server refusals are shown inline, and approval itself remains in the full owner cockpit.

## 6. Motion & interaction

Micro 140ms ease-out; speech 320ms ease-out; orbit slow and continuous only when motion is allowed. Core breath is 4% radius amplitude. One outward wave is tied to a *changed* `lastHeartbeatAt`; it is not restarted by polling the same value. Reduced motion stops waves and orbital movement and retains only short opacity fades. Canvas drawing runs at bounded frame rate and pauses when the document is hidden.

## 7. Depth & surface

Mixed strategy, reserved for the input and central instrument: field uses radial light and engraved grid; core uses multiple concentric radial gradients and rings; input uses translucent graphite, `backdrop-filter`, a hairline rim, inset highlight, and a deep tinted shadow. Other chrome stays flat. This light stack is the signature material, not a generic gradient card.
