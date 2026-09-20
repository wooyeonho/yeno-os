import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_TYPED_PROVIDER,
  browserDecisionProviderStatuses,
  routeBrowserDecision,
  typesafeJevDecisionStatus,
  validateBrowserDecisionProviderSnapshot,
  validateBrowserDecisionRoute,
  BrowserProviderRoutingError
} from '../lib/browser-provider-routing.mjs';

const AT = '2026-09-20T18:00:00.000Z';
const configured = {
  YENO_JEV_BASE_URL: 'https://official.example.invalid/jev',
  YENO_JEV_API_KEY: 'test-only-secret',
  YENO_JEV_MODEL: 'jev-ultrafast',
  YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED: 'true',
  YENO_AGENT_DAILY_CALL_LIMIT: '5',
  YENO_OPENAI_MODEL: 'gpt-test',
  YENO_OPENAI_API_KEY: 'test-openai-secret'
};

test('missing or unconfirmed Jev is unavailable and generic providers are not a typed fallback', () => {
  const result = routeBrowserDecision({env: {}, at: AT});
  assert.deepEqual([result.route.provider, result.route.model, result.route.status, result.route.typedDecision, result.route.authorizesCall], [null, null, 'unavailable', false, false]);
  assert.equal(result.route.reason, 'typed_jev_unavailable_no_text_fallback');
  const jev = result.providers.find(item => item.provider === BROWSER_TYPED_PROVIDER);
  assert.ok(jev.missing.includes('YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED'));
  assert.ok(result.providers.some(item => item.provider === 'xai' && item.typedDecision === false));
  validateBrowserDecisionRoute(result.route);
});

test('explicit HTTPS endpoint + owner confirmation yields configured typed route, never call authority', () => {
  const result = routeBrowserDecision({env: configured, at: AT});
  assert.deepEqual([result.route.provider, result.route.model, result.route.status, result.route.typedDecision, result.route.authorizesCall], [BROWSER_TYPED_PROVIDER, 'jev-ultrafast', 'configured', true, false]);
  validateBrowserDecisionRoute(result.route);
  validateBrowserDecisionProviderSnapshot(result);
  const dumped = JSON.stringify(result);
  for (const secret of ['test-only-secret', 'test-openai-secret', 'API_KEY', 'authorization']) assert.equal(dumped.includes(secret), false, secret);
  const statuses = browserDecisionProviderStatuses(configured);
  assert.equal(statuses.length, 7);
});

test('bad endpoint and generic owner pin fail closed instead of guessing an endpoint or coercing text to typed output', () => {
  const bad = {...configured, YENO_JEV_BASE_URL: 'http://localhost:8787/jev'};
  const result = routeBrowserDecision({env: bad, at: AT});
  assert.equal(result.route.provider, null);
  assert.equal(result.route.status, 'unavailable');
  assert.throws(() => routeBrowserDecision({env: configured, ownerProvider: 'openai', at: AT}), err => err instanceof BrowserProviderRoutingError && err.code === 'generic_provider_cannot_authorize_typed_decision');
  assert.throws(() => routeBrowserDecision({env: configured, at: 'not-a-date'}), err => err.code === 'invalid_observed_at');
});

test('unavailable/selected route invariants and tamper checks are strict', () => {
  const unavailable = routeBrowserDecision({env: {}, at: AT}).route;
  assert.throws(() => validateBrowserDecisionRoute({...unavailable, authorizesCall: true}), /route_authority_forbidden/);
  assert.throws(() => validateBrowserDecisionRoute({...unavailable, provider: 'xai'}), /unavailable_route_must_not_select/);
  const liveShape = routeBrowserDecision({env: configured, at: AT});
  assert.throws(() => validateBrowserDecisionProviderSnapshot({...liveShape, providers: liveShape.providers.slice(0, 2)}), /invalid_provider_snapshot/);
  assert.throws(() => typesafeJevDecisionStatus({...configured, YENO_JEV_MODEL: 'bad model'}), /./, 'the status must remain safe even if invalid model is supplied');
});
