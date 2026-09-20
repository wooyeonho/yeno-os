# Kirby Browser Capability Promotion

Branch slice: `blackhole/kirby-browser-capability-claude-20260920`  
Base: PR #42 exact head `92888401166dc2bbdd2b1bedbd2a3adf0eee5ebd`

## Contract

A completed Browser job may create one durable Kirby inbox entry only when:

- the deterministic Browser gate is `verified`;
- the independent semantic gate is `pass`;
- the semantic verifier is labelled `independent-model` or `independent-context`;
- the source draft remains `readingStatus: partial`, `decision: pending`;
- an artifact reference and SHA-256 are present.

The inbox is not the executable capability registry. A synthetic adapter is recorded as `evidenceClass: SANDBOX_SYNTHETIC` and remains `pending`; it cannot be promoted.

## Promotion gate

`POST /api/capability-inbox/:id/promote` is an owner-authenticated, explicit action. It requires:

1. `approve: true`;
2. `evidenceClass: LIVE` from a separately accepted Browser/Jev run;
3. a reviewed existing declarative capability manifest;
4. the manifest source URL to equal the Browser source URL;
5. the existing Kirby `import → verify → activate` path to pass.

Until all five are true, the registry is unchanged. The source record remains a review draft; no `candidate` or legal/rights conclusion is inferred from discovery.

## API readback

`GET /api/capability-inbox` returns bounded entries and status. It exposes hashes and provenance, never secrets or raw credentials.

The slice does not add a scheduler, provider, browser worker, external network, Android code, or production deployment. Live Browser/Jev and physical phone acceptance remain separate blockers.
