# YENO OS runtime 0.1.1

Start with [START_HERE_KO.md](START_HERE_KO.md). Mobile setup: [PHONE_SETUP.md](PHONE_SETUP.md).

Standalone Node.js 20+ runtime with no npm dependencies. Run `node launch.mjs --no-open` or `npm start`. Test with `npm test`.

Core API: bearer-authenticated `/api/state`, `/api/commands`, `/api/jobs`, `/api/jobs/:id/action`, `/api/control`, `/api/settings`, `/api/memory`, `/api/snapshots`, `/api/snapshots/:id/restore`, `/api/artifacts/:id`. Health and static UI are public; no user content is returned before pairing.

Uses atomic JSON state with checksum and prior backup, exclusive data-directory lock, registered artifact downloads, bounded cooperative steps, restart-to-paused semantics, version guards, and payload-bound request deduplication (last 2,000 request IDs). Workflows are local deterministic utilities unless AI is explicitly configured and enabled.

This is an initial functional foundation, not a complete autonomous desktop agent. No arbitrary shell, browser control, scheduling, Vault access, automatic code promotion, native voice, or production remote deployment is included.

Config: `config.local.json` for launch.mjs (copy config.example.json). Direct server.mjs accepts environment variables: `YENO_PORT`, `YENO_HOST`, `YENO_DATA_DIR`, `YENO_ALLOWED_HOSTS`, `YENO_TOKEN`, `YENO_AI_BASE_URL`, `YENO_AI_MODEL`, `YENO_AI_API_KEY`. Do not expose the control plane publicly or include credentials/data in source archives.

Source files are editable. Preserve `data` and current working sources before updates. Review actual changes and rerun the integration checks before using a new version.
