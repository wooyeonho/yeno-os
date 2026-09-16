import test from 'node:test';
import assert from 'node:assert/strict';
import {brainPool, configuredProviders, routeModel, routeRequest, failoverDecision, validateRoutingDecision, validateDeclaredModel, parseDeclaredModels, assertNoSecrets, RouterError, ROUTER_VERSION, CANDIDATE_FIELDS} from '../lib/model-router.mjs';

const AT = '2026-09-15T03:00:00.000Z';
const VERIFIED = '2026-09-14T00:00:00.000Z';
const declare = (provider, model, overrides = {}) => ({
  provider, model, taskCapabilities: ['text'], reasoningClass: 'standard', codingClass: 'none', realtime: false, vision: false, audioLive: false, toolCalling: false,
  contextLimit: 128000, costTier: 'medium', quotaClass: 'metered', dailyBudget: {calls: 20, used: 0}, availability: 'available', lastVerifiedAt: VERIFIED, ...overrides
});
// Owner-declared pool. Nothing below is inferred from a name: every fact is written out.
const DECLARED = [
  declare('nvidia', 'meta/llama-3.1-8b-instruct', {costTier: 'free', quotaClass: 'verified-free', reasoningClass: 'basic'}),
  declare('nvidia', 'nvidia/unverified-model', {costTier: 'unknown', quotaClass: 'unknown', availability: 'unknown', dailyBudget: null, lastVerifiedAt: null}),
  declare('openai', 'gpt-coder', {taskCapabilities: ['text', 'coding', 'tool-calling'], codingClass: 'high', toolCalling: true, costTier: 'medium'}),
  declare('anthropic', 'claude-reasoner', {taskCapabilities: ['text', 'reasoning', 'coding', 'tool-calling'], reasoningClass: 'frontier', codingClass: 'frontier', toolCalling: true, costTier: 'high'}),
  declare('xai', 'grok-text', {taskCapabilities: ['text', 'coding'], codingClass: 'standard', costTier: 'low'}),
  declare('gemini', 'gemini-live-declared', {taskCapabilities: ['text', 'audio-live', 'tool-calling'], realtime: true, audioLive: true, toolCalling: true, costTier: 'low'}),
  declare('moonshot', 'kimi-cheap', {costTier: 'low', reasoningClass: 'basic'})
];
const ENV_ALL = Object.fromEntries(DECLARED.flatMap(m => [[`YENO_${m.provider.toUpperCase()}_MODEL`, m.model], [`YENO_${m.provider.toUpperCase()}_API_KEY`, `test-secret-${m.provider}`]]).concat([['YENO_AGENT_DAILY_CALL_LIMIT', '5']]));
delete ENV_ALL.YENO_NVIDIA_MODEL; ENV_ALL.YENO_NVIDIA_MODEL = 'meta/llama-3.1-8b-instruct';
const without = (env, ...providers) => {const copy = {...env}; for (const p of providers) {delete copy[`YENO_${p.toUpperCase()}_MODEL`]; delete copy[`YENO_${p.toUpperCase()}_API_KEY`];} return copy;};
const poolFor = (env, declared = DECLARED) => brainPool(declared, configuredProviders(env));
const rejected = (decision, provider, model) => decision.consideredModels.find(c => c.provider === provider && c.model === model).reasons;

test('1+2: eligible verified-free NVIDIA wins a low-cost task; the NVIDIA model without cost/quota evidence is never treated as free', () => {
  const pool = poolFor(ENV_ALL);
  const decision = routeModel(pool, routeRequest('classify'), {at: AT});
  assert.deepEqual([decision.selectedProvider, decision.selectedModel, decision.costTier, decision.reason], ['nvidia', 'meta/llama-3.1-8b-instruct', 'free', 'lowest_cost_free']);
  assert.deepEqual(decision.quotaEvidence, {quotaClass: 'verified-free', dailyBudget: {calls: 20, used: 0}, lastVerifiedAt: VERIFIED});
  assert.ok(rejected(decision, 'nvidia', 'nvidia/unverified-model').includes('quota_unknown'));
  assert.ok(rejected(decision, 'nvidia', 'nvidia/unverified-model').includes('availability_unknown'));
  assert.ok(rejected(decision, 'nvidia', 'nvidia/unverified-model').includes('configuration_missing'), 'a second NVIDIA model is not configured just because the provider key exists');
  // Declaring "free" without verified-free quota evidence is refused outright.
  assert.throws(() => validateDeclaredModel(declare('nvidia', 'x', {costTier: 'free', quotaClass: 'metered'})), /verified-free/);
  // Even with the verified model gone, "unknown" cost never becomes the cheapest choice.
  const onlyUnknown = poolFor(ENV_ALL, [DECLARED[1], DECLARED[6]]);
  const fallback = routeModel(onlyUnknown, routeRequest('classify'), {at: AT});
  assert.equal(fallback.selectedModel, 'kimi-cheap');
  assert.equal(decision.authorizesCall, false);
});

test('3+4: configured xAI/Grok is a candidate and can be selected for a task it declares; unconfigured Grok is never selected', () => {
  const codingCheap = routeModel(poolFor(ENV_ALL), routeRequest('coding'), {at: AT});
  assert.deepEqual([codingCheap.selectedProvider, codingCheap.selectedModel], ['xai', 'grok-text'], 'declared coding capability + low cost');
  assert.ok(codingCheap.ranked.includes('openai/gpt-coder') && codingCheap.ranked.includes('anthropic/claude-reasoner'));
  const noGrok = routeModel(poolFor(without(ENV_ALL, 'xai')), routeRequest('coding'), {at: AT});
  assert.equal(noGrok.selectedProvider, 'openai');
  assert.deepEqual(rejected(noGrok, 'xai', 'grok-text'), ['configuration_missing']);
  // Grok declared nothing about search/realtime, so it is not a realtime candidate even when configured.
  const voice = routeModel(poolFor(ENV_ALL), routeRequest('realtime-voice'), {at: AT});
  assert.ok(rejected(voice, 'xai', 'grok-text').includes('capability_missing:audio-live'));
});

test('5: owner pinned provider/model is honoured, the router never overrides it, and a pin with no eligible model selects nothing instead of falling through', () => {
  const pool = poolFor(ENV_ALL);
  const pinned = routeModel(pool, routeRequest('classify'), {at: AT, ownerOverride: {provider: 'anthropic', model: null}});
  assert.deepEqual([pinned.selectedProvider, pinned.selectedModel, pinned.reason, pinned.costTier], ['anthropic', 'claude-reasoner', 'owner_pinned', 'high']);
  assert.deepEqual(pinned.ownerOverride, {provider: 'anthropic', model: null});
  assert.ok(rejected(pinned, 'nvidia', 'meta/llama-3.1-8b-instruct').includes('owner_pinned_elsewhere'));
  const pinnedMissing = routeModel(poolFor(without(ENV_ALL, 'xai')), routeRequest('classify'), {at: AT, ownerOverride: {provider: 'xai', model: 'grok-text'}});
  assert.deepEqual([pinnedMissing.selectedProvider, pinnedMissing.reason], [null, 'owner_pin_ineligible']);
});

test('6+7+8: coding excludes cheap models without coding; reasoning excludes models below the required class; realtime/audio excludes models without audioLive', () => {
  const pool = poolFor(ENV_ALL);
  const coding = routeModel(pool, routeRequest('coding'), {at: AT});
  assert.ok(rejected(coding, 'nvidia', 'meta/llama-3.1-8b-instruct').includes('capability_missing:coding'));
  assert.ok(rejected(coding, 'moonshot', 'kimi-cheap').includes('capability_missing:coding'));
  const codingHigh = routeModel(pool, routeRequest('coding', {minCodingClass: 'high'}), {at: AT});
  assert.equal(codingHigh.selectedModel, 'gpt-coder');
  assert.ok(rejected(codingHigh, 'xai', 'grok-text').includes('coding_below_high'));
  const reasoning = routeModel(pool, routeRequest('reasoning'), {at: AT});
  assert.deepEqual([reasoning.selectedProvider, reasoning.selectedModel], ['anthropic', 'claude-reasoner']);
  assert.ok(rejected(reasoning, 'xai', 'grok-text').includes('capability_missing:reasoning'));
  assert.ok(rejected(reasoning, 'moonshot', 'kimi-cheap').includes('reasoning_below_high'));
  const voice = routeModel(pool, routeRequest('realtime-voice'), {at: AT});
  assert.deepEqual([voice.selectedProvider, voice.selectedModel], ['gemini', 'gemini-live-declared']);
  for (const [provider, model] of [['openai', 'gpt-coder'], ['anthropic', 'claude-reasoner'], ['nvidia', 'meta/llama-3.1-8b-instruct']]) {
    assert.ok(rejected(voice, provider, model).includes('audio_live_required'));
  }
  const voiceReasoning = routeModel(pool, routeRequest('realtime-voice-reasoning'), {at: AT});
  assert.deepEqual([voiceReasoning.selectedProvider, voiceReasoning.reason], [null, 'no_eligible_model'], 'the declared live model has no reasoning evidence; nothing is invented');
  assert.throws(() => validateDeclaredModel(declare('gemini', 'x', {taskCapabilities: ['text', 'audio-live']})), /audioLive/);
});

test('9+10: pre-send configuration failure moves to the next ranked candidate (never past an owner pin); post-send ambiguity is outcomeUnknown with no failover', () => {
  const decision = routeModel(poolFor(ENV_ALL), routeRequest('classify'), {at: AT});
  assert.equal(decision.ranked[0], 'nvidia/meta/llama-3.1-8b-instruct');
  const pre = failoverDecision(decision, {provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct', phase: 'pre-send', failure: 'configurationMissing', attempted: []});
  assert.deepEqual([pre.action, pre.retry, pre.outcome, pre.next], ['next_candidate', true, 'notSent', {provider: 'gemini', model: 'gemini-live-declared'}]);
  const pre2 = failoverDecision(decision, {provider: 'gemini', model: 'gemini-live-declared', phase: 'pre-send', failure: 'quotaUnavailable', attempted: pre.attempted});
  assert.deepEqual(pre2.next, {provider: 'moonshot', model: 'kimi-cheap'});
  for (const failure of ['timeout', 'connectionAmbiguous', 'completionUnknown']) {
    const post = failoverDecision(decision, {provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct', phase: 'post-send', failure, attempted: []});
    assert.deepEqual([post.action, post.retry, post.outcome, post.next, post.ownerReviewRequired], ['hold', false, 'outcomeUnknown', null, true]);
  }
  assert.throws(() => failoverDecision(decision, {provider: 'nvidia', model: 'x', phase: 'post-send', failure: 'configurationMissing', attempted: []}), RouterError);
  assert.throws(() => failoverDecision(decision, {provider: 'nvidia', model: 'x', phase: 'pre-send', failure: 'timeout', attempted: []}), RouterError);
  const pinned = routeModel(poolFor(ENV_ALL), routeRequest('classify'), {at: AT, ownerOverride: {provider: 'anthropic', model: null}});
  const pinnedFail = failoverDecision(pinned, {provider: 'anthropic', model: 'claude-reasoner', phase: 'pre-send', failure: 'quotaUnavailable', attempted: []});
  assert.deepEqual([pinnedFail.action, pinnedFail.next, pinnedFail.reason], ['hold', null, 'owner_pinned_no_failover']);
  // Exhausting the ranking holds for the owner instead of looping.
  let step = {attempted: []}, guard = 0;
  while (guard++ < 10) {const id = decision.ranked.find(x => !step.attempted.includes(x)); if (!id) break; const [provider, ...m] = id.split('/'); step = failoverDecision(decision, {provider, model: m.join('/'), phase: 'pre-send', failure: 'providerMissing', attempted: step.attempted});}
  assert.deepEqual([step.action, step.reason], ['hold', 'no_remaining_candidate']);
});

test('11: credentials never reach the pool, the decision or the provenance; credential-shaped input is refused', () => {
  const env = {...ENV_ALL, YENO_OPENAI_API_KEY: 'sk-live-0123456789abcdef', YENO_XAI_API_KEY: 'xai-0123456789abcdef', YENO_NVIDIA_API_KEY: 'nvapi-0123456789abcdef'};
  const configuration = configuredProviders(env);
  const pool = poolFor(env);
  const decision = routeModel(pool, routeRequest('coding'), {at: AT});
  const dumped = JSON.stringify({configuration, pool, decision});
  for (const secret of ['sk-live', 'xai-0123', 'nvapi-', 'test-secret']) assert.ok(!dumped.includes(secret), `secret ${secret} leaked`);
  assert.ok(!/api_?key|apiKey/i.test(dumped));
  assert.throws(() => validateDeclaredModel({...declare('openai', 'x'), apiKey: 'sk-abc'}), /필드/);
  assert.throws(() => routeModel(pool, routeRequest('coding'), {at: AT, policy: {backgroundOptIn: true, apiKey: 'sk-abc'}}), err => err.code === 'ROUTER_SECRET');
  assert.throws(() => assertNoSecrets({note: 'sk-abcdef'}), err => err.code === 'ROUTER_SECRET');
  assert.throws(() => brainPool(DECLARED, {openai: {configured: true, model: 'gpt-coder', missing: [], key: 'x'}}), err => err.code === 'ROUTER_SECRET');
  assert.deepEqual(Object.keys(pool.models[0]).sort(), [...CANDIDATE_FIELDS].sort());
});

test('12: same declarations + same configuration => identical decision and fingerprint; API key presence is not background permission; tampered provenance fails closed', () => {
  const a = routeModel(poolFor(ENV_ALL), routeRequest('summarize'), {at: AT});
  const b = routeModel(poolFor(ENV_ALL), routeRequest('summarize'), {at: '2026-09-16T00:00:00.000Z'});
  assert.equal(a.fingerprint, b.fingerprint, 'timestamp is excluded from the identity');
  assert.deepEqual({...a, timestamp: null}, {...b, timestamp: null});
  assert.equal(routeModel(poolFor(ENV_ALL, [...DECLARED].reverse()), routeRequest('summarize'), {at: AT}).fingerprint, a.fingerprint, 'declaration order does not matter');
  validateRoutingDecision(a);
  assert.throws(() => validateRoutingDecision({...a, selectedModel: 'claude-reasoner'}), err => err.code === 'ROUTER_TAMPERED');
  assert.throws(() => validateRoutingDecision({...a, authorizesCall: true}), RouterError);
  const restored = JSON.parse(JSON.stringify(a));
  validateRoutingDecision(restored);
  // Background trigger: configured keys everywhere, still nothing without owner opt-in + per-model budget.
  const background = routeModel(poolFor(ENV_ALL), routeRequest('classify', {trigger: 'background'}), {at: AT});
  assert.deepEqual([background.selectedProvider, background.reason], [null, 'background_not_opted_in']);
  const optedIn = routeModel(poolFor(ENV_ALL), routeRequest('classify', {trigger: 'background'}), {at: AT, policy: {backgroundOptIn: true}});
  assert.equal(optedIn.selectedProvider, 'nvidia');
  const exhausted = poolFor(ENV_ALL, DECLARED.map(m => m.provider === 'nvidia' && m.costTier === 'free' ? {...m, dailyBudget: {calls: 20, used: 20}} : m));
  assert.ok(rejected(routeModel(exhausted, routeRequest('classify', {trigger: 'background'}), {at: AT, policy: {backgroundOptIn: true}}), 'nvidia', 'meta/llama-3.1-8b-instruct').includes('daily_budget_exhausted'));
  assert.equal(routeModel(poolFor(ENV_ALL), routeRequest('classify', {trigger: 'background', risk: 'capability-change'}), {at: AT, policy: {backgroundOptIn: true}}).selectedProvider, null);
  const disabled = poolFor(ENV_ALL, DECLARED.map(m => m.provider === 'nvidia' && m.costTier === 'free' ? {...m, availability: 'disabled'} : m));
  assert.ok(rejected(routeModel(disabled, routeRequest('classify'), {at: AT}), 'nvidia', 'meta/llama-3.1-8b-instruct').includes('owner_disabled'));
  assert.deepEqual(parseDeclaredModels(JSON.stringify(DECLARED)), DECLARED);
  assert.throws(() => parseDeclaredModels(JSON.stringify([{provider: 'nvidia', model: 'x'}])), RouterError);
  assert.equal(ROUTER_VERSION, 1);
});
