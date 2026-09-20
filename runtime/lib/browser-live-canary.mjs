// BLACKHOLE owner-approved browser canary contract.
//
// This module is a fail-closed gate, not a browser executor. It never opens
// Chrome, calls Jev, fetches a URL, or authorizes side effects by itself.
// A later adapter must call prepareOwnerCanary() and record live evidence
// before any claim of live browser use is allowed.
import {validatePublicHttpsUrl} from './browser-harness.mjs';
import {typesafeJevDecisionStatus, validateBrowserDecisionProviderStatus} from './browser-provider-routing.mjs';

export const BROWSER_CANARY_VERSION = 1;
export const BROWSER_CANARY_EVIDENCE = 'SANDBOX_CONTRACT';
export const BROWSER_CANARY_STATES = Object.freeze(['blocked', 'unavailable', 'ready_for_owner_run']);

const ISO = value => typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const fail = code => { throw new Error('Browser canary: ' + code); };

export class BrowserCanaryError extends Error {
  constructor(code) { super('Browser canary: ' + code); this.code = code; }
}

export function browserCanaryStatus({env = process.env, at = new Date().toISOString()} = {}) {
  if (!ISO(at)) fail('invalid_timestamp');
  const provider = typesafeJevDecisionStatus(env);
  const ownerApproved = env.YENO_BROWSER_CANARY_APPROVED === 'true';
  const harnessConfirmed = env.YENO_BROWSER_HARNESS_LIVE_CONFIRMED === 'true';
  const readOnlyConfirmed = env.YENO_BROWSER_CANARY_READ_ONLY === 'true';
  let status = 'blocked';
  let reason = 'owner_approval_required';
  if (provider.status !== 'configured') {
    status = 'unavailable';
    reason = 'typesafe_jev_unavailable';
  } else if (!harnessConfirmed) {
    status = 'unavailable';
    reason = 'browser_harness_live_adapter_not_confirmed';
  } else if (!readOnlyConfirmed) {
    reason = 'read_only_confirmation_required';
  } else if (!ownerApproved) {
    reason = 'owner_approval_required';
  } else {
    status = 'ready_for_owner_run';
    reason = null;
  }
  return {
    version: BROWSER_CANARY_VERSION,
    status,
    evidenceClass: BROWSER_CANARY_EVIDENCE,
    live: false,
    observedAt: at,
    provider,
    ownerApproved,
    harnessConfirmed,
    readOnlyConfirmed,
    providerCalls: 0,
    networkRequests: 0,
    browserRuns: 0,
    reason
  };
}

export function validateBrowserCanaryStatus(value) {
  const keys = ['version', 'status', 'evidenceClass', 'live', 'observedAt', 'provider', 'ownerApproved', 'harnessConfirmed', 'readOnlyConfirmed', 'providerCalls', 'networkRequests', 'browserRuns', 'reason'];
  if (!exact(value, keys)) fail('invalid_status_shape');
  if (value.version !== BROWSER_CANARY_VERSION || !BROWSER_CANARY_STATES.includes(value.status)) fail('invalid_status');
  if (value.evidenceClass !== BROWSER_CANARY_EVIDENCE || value.live !== false || !ISO(value.observedAt)) fail('live_or_timestamp_claim');
  validateBrowserDecisionProviderStatus(value.provider);
  for (const key of ['ownerApproved', 'harnessConfirmed', 'readOnlyConfirmed']) if (typeof value[key] !== 'boolean') fail('invalid_confirmation');
  for (const key of ['providerCalls', 'networkRequests', 'browserRuns']) if (value[key] !== 0) fail('nonzero_live_evidence');
  if (value.reason !== null && !text(value.reason, 160)) fail('invalid_reason');
  if (value.status === 'ready_for_owner_run' && (!value.ownerApproved || !value.harnessConfirmed || !value.readOnlyConfirmed || value.provider.status !== 'configured')) fail('ready_without_gate');
  return true;
}

export function validateOwnerCanaryRequest({sourceUrl, goal, successCriterion} = {}) {
  if (!text(sourceUrl, 2000)) fail('source_url_required');
  try { validatePublicHttpsUrl(sourceUrl); } catch { fail('source_url_not_public_https'); }
  if (!text(goal, 500)) fail('goal_required');
  if (!text(successCriterion, 1000)) fail('success_criterion_required');
  return {sourceUrl, goal, successCriterion};
}

export function prepareOwnerCanary({status, sourceUrl, goal, successCriterion} = {}) {
  validateBrowserCanaryStatus(status);
  const request = validateOwnerCanaryRequest({sourceUrl, goal, successCriterion});
  if (status.status !== 'ready_for_owner_run') throw new BrowserCanaryError(status.reason ?? 'canary_not_ready');
  return {
    version: BROWSER_CANARY_VERSION,
    evidenceClass: BROWSER_CANARY_EVIDENCE,
    live: false,
    canDispatchReadOnly: true,
    executed: false,
    request,
    provider: status.provider.provider,
    model: status.provider.model,
    approvalRef: 'env:YENO_BROWSER_CANARY_APPROVED',
    harnessRef: 'env:YENO_BROWSER_HARNESS_LIVE_CONFIRMED',
    providerCalls: 0,
    networkRequests: 0,
    reason: 'contract_only_no_execution'
  };
}
