# Thinking Orbs source receipt

- Upstream: https://github.com/Jakubantalik/thinking-orbs
- Pinned commit: `de85557ca220332586d070d8788c0e1d6e877a0d`
- License: MIT, copyright 2026 Jakub Antalik. See `LICENSE` (SHA-256 `915a283980628a0ca9e7b423ebafc6f3a0fa1e630ff17d34e59034808d92011c`).
- The files under `src/` are byte-for-byte copies of the pinned source; `SOURCE_SHA256.txt` lists every file and its SHA-256. The local `scripts/build-thinking-orbs-vendor.mjs` converts the engine TypeScript to browser ESM in `adapted/` by stripping types and adding `.mjs` import extensions. `ADAPTED_SHA256.txt` lists the generated files. The React wrapper is retained for source provenance but is not loaded by BLACKHOLE.
- BLACKHOLE-specific state mapping, one shared animation frame, visibility pause, labels, and reduced-motion behavior are in `runtime/public/small-orbs.mjs` and `small-orb-state.mjs`. They are separate adaptations, not upstream claims.
- GitHub metadata observed 2026-09-30 15:08 UTC: MIT, unarchived, enabled, 3380 stars, default branch `main`; see `build-artifacts/reel-absorption-20261001/report.json` for source URLs, fetched times and raw JSON SHA-256. These values do not imply quality or official endorsement.
