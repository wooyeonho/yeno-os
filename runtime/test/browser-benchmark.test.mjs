import test from 'node:test';
import assert from 'node:assert/strict';
import {browserBenchmarkStatus, runSyntheticBrowserBenchmark, validateBrowserBenchmark} from '../lib/browser-benchmark.mjs';

const AT = '2026-09-20T18:30:00.000Z';

test('synthetic benchmark measures bounded policy behavior without live claims', () => {
  const result = runSyntheticBrowserBenchmark({at: AT});
  validateBrowserBenchmark(result);
  assert.equal(result.evidenceClass, 'SANDBOX_SYNTHETIC');
  assert.equal(result.live, false);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.networkRequests, 0);
  assert.equal(result.baseline, null);
  assert.equal(result.comparison, 'no_live_baseline');
  assert.equal(result.summary.total, 6);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.score, 1);
});

test('benchmark has evidence for both safe and fail-closed cases', () => {
  const result = runSyntheticBrowserBenchmark({at: AT});
  const names = new Set(result.cases.map(item => item.name));
  for (const name of ['public_https_allowed', 'private_network_blocked', 'secret_redaction', 'artifact_hash_gate', 'unknown_provider_fails_closed', 'oversized_dom_blocked']) assert.ok(names.has(name));
  assert.ok(result.cases.every(item => item.evidenceRefs.every(ref => ref.startsWith('synthetic:'))));
});

test('invalid timestamp, live claim, or fabricated baseline fails closed', () => {
  assert.throws(() => runSyntheticBrowserBenchmark({at: 'not-a-time'}), /invalid_timestamp/);
  const result = runSyntheticBrowserBenchmark({at: AT});
  assert.throws(() => validateBrowserBenchmark({...result, live: true}), /live_or_timestamp_claim/);
  assert.throws(() => validateBrowserBenchmark({...result, baseline: {score: 1}}), /invalid_evidence_boundary/);
  assert.throws(() => validateBrowserBenchmark({...result, providerCalls: 1}), /invalid_evidence_boundary/);
});

test('status surface keeps provider configuration separate from benchmark evidence', () => {
  const status = browserBenchmarkStatus({env: {YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED: 'true', YENO_JEV_MODEL: 'jev-test'}, at: AT});
  assert.equal(status.evidenceClass, 'SANDBOX_SYNTHETIC');
  assert.equal(status.live, false);
  assert.equal(status.providerConfigured, true);
  assert.equal(status.summary.score, 1);
});