import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserCanaryStatus,
  prepareOwnerCanary,
  validateBrowserCanaryStatus,
  validateOwnerCanaryRequest,
  BROWSER_CANARY_EVIDENCE
} from '../lib/browser-live-canary.mjs';

const AT = '2026-09-20T19:00:00.000Z';
const configured = {
  YENO_JEV_BASE_URL: 'https://jev.example.test/v1',
  YENO_JEV_API_KEY: 'synthetic-only-not-a-secret',
  YENO_JEV_MODEL: 'jev-test',
  YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED: 'true',
  YENO_BROWSER_HARNESS_LIVE_CONFIRMED: 'true',
  YENO_BROWSER_CANARY_READ_ONLY: 'true',
  YENO_BROWSER_CANARY_APPROVED: 'true'
};

test('missing provider or harness fails closed without live evidence', () => {
  const status = browserCanaryStatus({env: {}, at: AT});
  validateBrowserCanaryStatus(status);
  assert.equal(status.status, 'unavailable');
  assert.equal(status.live, false);
  assert.equal(status.providerCalls, 0);
  assert.equal(status.networkRequests, 0);
  assert.equal(status.browserRuns, 0);
  assert.match(status.reason, /typesafe_jev_unavailable/);
});

test('approval and read-only confirmations are distinct gates', () => {
  const notApproved = browserCanaryStatus({env: {...configured, YENO_BROWSER_CANARY_APPROVED: 'false'}, at: AT});
  assert.equal(notApproved.status, 'blocked');
  assert.equal(notApproved.reason, 'owner_approval_required');
  const notReadOnly = browserCanaryStatus({env: {...configured, YENO_BROWSER_CANARY_READ_ONLY: 'false'}, at: AT});
  assert.equal(notReadOnly.status, 'blocked');
  assert.equal(notReadOnly.reason, 'read_only_confirmation_required');
});

test('ready canary is a contract gate, not a live execution claim', () => {
  const status = browserCanaryStatus({env: configured, at: AT});
  validateBrowserCanaryStatus(status);
  assert.equal(status.status, 'ready_for_owner_run');
  assert.equal(status.evidenceClass, BROWSER_CANARY_EVIDENCE);
  assert.equal(status.live, false);
  const plan = prepareOwnerCanary({
    status,
    sourceUrl: 'https://public.example.test/docs',
    goal: 'read the public page',
    successCriterion: 'title, body, and links are preserved'
  });
  assert.equal(plan.canDispatchReadOnly, true);
  assert.equal(plan.executed, false);
  assert.equal(plan.providerCalls, 0);
  assert.equal(plan.networkRequests, 0);
  assert.equal(plan.reason, 'contract_only_no_execution');
});

test('unsafe or malformed requests fail closed', () => {
  assert.throws(() => validateOwnerCanaryRequest({sourceUrl: 'http://public.example.test', goal: 'read', successCriterion: 'ok'}), /source_url_not_public_https/);
  assert.throws(() => validateOwnerCanaryRequest({sourceUrl: 'https://127.0.0.1', goal: 'read', successCriterion: 'ok'}), /source_url_not_public_https/);
  assert.throws(() => validateOwnerCanaryRequest({sourceUrl: 'https://public.example.test', goal: 'read', successCriterion: ''}), /success_criterion_required/);
  const status = browserCanaryStatus({env: {}, at: AT});
  assert.throws(() => prepareOwnerCanary({status, sourceUrl: 'https://public.example.test', goal: 'read', successCriterion: 'ok'}), /canary_not_ready|typesafe_jev_unavailable/);
});

test('invalid live evidence cannot be represented by the contract', () => {
  const status = browserCanaryStatus({env: configured, at: AT});
  assert.throws(() => validateBrowserCanaryStatus({...status, live: true}), /live_or_timestamp_claim/);
  assert.throws(() => validateBrowserCanaryStatus({...status, providerCalls: 1}), /nonzero_live_evidence/);
  assert.throws(() => validateBrowserCanaryStatus({...status, status: 'ready_for_owner_run', ownerApproved: false}), /ready_without_gate/);
});
