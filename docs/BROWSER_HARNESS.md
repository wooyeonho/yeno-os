# BLACKHOLE Sandbox Browser Harness

Branch slice: `blackhole/browser-live-sandbox-claude-20260920`  
Base: PR #38 exact head `6aa72f280a4d1886770848d9a67fe0b64ff122fa`

## Scope

This slice adds a bounded adapter contract to the existing `state.jobs` and scheduler. It does not start Chrome and does not claim live Browser-use, Jev, TypeSafe, or phone acceptance.

The intended path is:

`public HTTPS URL → bounded snapshot → typed decision → read-only action evidence → artifact/hash → deterministic gate → independent semantic gate → source draft → phone readback`.

The default runtime has no browser adapter, so a submitted browser job remains an honest durable failure with `browser_harness_unavailable`. An injected adapter is used only by sandbox tests or an explicitly connected future worker.

## Safety boundary

- HTTPS only; no URL credentials, secret-like query names, custom ports, localhost, private/link-local/metadata IPs.
- DNS answers are checked and private answers fail closed.
- Bounded DOM/body/link/action evidence.
- Sensitive fields and auth-like text are redacted.
- No cookies, credential profiles, arbitrary JavaScript, shell, upload, download, payment, login, posting, messaging, subscription, or permission changes.
- Browser jobs are records in the existing `state.jobs`; no second scheduler/provider/router/memory engine.
- Restart pauses queued/running work; owner resume is required. Unknown provider outcome is not resent.
- Source intake begins as `readingStatus: partial`, `decision: pending`; it is never promoted to `candidate` by discovery.

## Provider status

The code records only environment variable names:

- `YENO_JEV_PROVIDER`
- `YENO_JEV_BASE_URL`
- `YENO_JEV_API_KEY`
- `YENO_JEV_MODEL`
- `YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED`

TypeSafe official endpoint/SDK credentials were not confirmed in this slice. Without explicit endpoint confirmation the provider status is `unavailable`; no endpoint is guessed and no key is logged.

## Evidence labels

- `STRUCTURAL`: pure contract, persistence, redaction, gates, and failure-path tests.
- `SANDBOX_SYNTHETIC`: injected transport/decision/verifier tests; no external browser or provider.
- `LIVE`: not run. It requires an owner-configured official provider and a separately reviewed sandbox browser worker.

## Phone readback

`GET /api/browser/jobs/:id` returns the bounded public job state and artifact hash/reference. The artifact bytes remain behind the existing authenticated artifact route. Android/APK is not changed by this backend-only slice.
