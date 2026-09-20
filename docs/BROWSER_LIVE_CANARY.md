# Browser live canary

This is an owner-approved **contract gate**, not a live browser implementation.

The canary may be considered `ready_for_owner_run` only when all of these are explicitly configured:

- `YENO_JEV_BASE_URL` is an HTTPS endpoint confirmed by the owner;
- `YENO_JEV_API_KEY` and `YENO_JEV_MODEL` are configured in the secret manager;
- `YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED=true`;
- `YENO_BROWSER_HARNESS_LIVE_CONFIRMED=true`;
- `YENO_BROWSER_CANARY_READ_ONLY=true`;
- `YENO_BROWSER_CANARY_APPROVED=true`.

The module never logs or returns the key. It does not call the endpoint, start Chrome, fetch a URL, or perform an action. `prepareOwnerCanary` only validates the bounded request and returns a non-executed plan. A future live adapter must record separate `LIVE` evidence, deterministic verification, independent semantic verification, source-intake state, and phone readback before any result can be called live or verified.

If the provider, harness, owner approval, or read-only gate is missing, the result is `unavailable` or `blocked` and no execution is attempted.
