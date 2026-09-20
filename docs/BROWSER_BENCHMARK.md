# Browser Harness benchmark

`GET /api/browser/benchmark` exposes a small deterministic regression suite for the Browser Harness policy boundary.

Current suite checks:

- public HTTPS URL acceptance;
- loopback/private URL rejection;
- secret redaction;
- artifact hash and deterministic verification;
- unknown provider outcome fail-closed behavior;
- oversized DOM rejection.

The response is explicitly marked `evidenceClass: SANDBOX_SYNTHETIC`, `live: false`, `providerCalls: 0`, and `networkRequests: 0`. `baseline` stays null until a separately recorded baseline exists. The score is therefore a local regression score, not a live-browser or semantic-quality score.

This does not start Chrome, call Jev, fetch the network, or authorize browser actions. Live provider and physical-phone acceptance remain separate gates.