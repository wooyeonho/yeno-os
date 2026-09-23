import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dailyCostUsage, dailyCostLimitStatus, estimateCallCostUsd, priceFor, PROVIDER_UNIT_PRICES_SNAPSHOT} from '../lib/cost-ledger.mjs';
import {agentConfig} from '../lib/provider-config.mjs';
import {runAgent, agentUsage} from '../lib/agent.mjs';
import {initialState} from '../lib/store.mjs';
import {AGENT_ENDPOINTS} from '../lib/provider-config.mjs';

// F14 - the estimated-USD ledger is a SEPARATE, optional cap layered on top
// of the existing daily call-count limit: never guesses a price for an
// unsettled call or an unlisted provider, and fails closed (blocks) rather
// than silently letting spend continue once today's true total is unknowable.

const settled = (inputTokens, outputTokens, at = '2026-09-23T01:00:00.000Z') => ({id: randomUUID(), at, status: 'settled', inputTokens, outputTokens});
const jobWith = (provider, calls) => ({id: randomUUID(), agentJournal: {provider, model: 'synthetic-model', calls}});

test('priceFor/estimateCallCostUsd: known provider prices a settled call; unknown provider and unsettled calls are null, never zero', () => {
  assert.deepEqual(priceFor('openai'), PROVIDER_UNIT_PRICES_SNAPSHOT.prices.openai);
  assert.equal(priceFor('nvidia'), null, 'no NVIDIA price is guessed');
  const call = settled(1000, 1000);
  const cost = estimateCallCostUsd(call, 'openai');
  assert.equal(cost, PROVIDER_UNIT_PRICES_SNAPSHOT.prices.openai.inputPer1k + PROVIDER_UNIT_PRICES_SNAPSHOT.prices.openai.outputPer1k);
  assert.equal(estimateCallCostUsd(call, 'nvidia'), null);
  assert.equal(estimateCallCostUsd({...call, status: 'reserved'}, 'openai'), null, 'a reserved (not yet settled) call is never priced');
  assert.equal(estimateCallCostUsd({...call, inputTokens: null}, 'openai'), null, 'missing usage is never priced as 0');
  assert.equal(estimateCallCostUsd(null, 'openai'), null);
});

test('dailyCostUsage sums only settled calls from the given UTC day, by each job\'s own fixed provider, and reports unpriced calls honestly', () => {
  const jobs = [
    jobWith('openai', [settled(2000, 1000), settled(1000, 1000, '2026-09-22T23:00:00.000Z')]), // second call is yesterday
    jobWith('anthropic', [settled(1000, 1000), {id: randomUUID(), at: '2026-09-23T02:00:00.000Z', status: 'unknown', inputTokens: null, outputTokens: null}]),
    jobWith('nvidia', [settled(5000, 5000)]), // unpriced provider
    {id: randomUUID(), agentJournal: undefined}, // no journal at all
  ];
  const usage = dailyCostUsage(jobs, '2026-09-23T12:00:00.000Z');
  const expected = (2 * PROVIDER_UNIT_PRICES_SNAPSHOT.prices.openai.inputPer1k) + (1 * PROVIDER_UNIT_PRICES_SNAPSHOT.prices.openai.outputPer1k)
    + (1 * PROVIDER_UNIT_PRICES_SNAPSHOT.prices.anthropic.inputPer1k) + (1 * PROVIDER_UNIT_PRICES_SNAPSHOT.prices.anthropic.outputPer1k);
  assert.equal(usage.estimatedTotalUsd, Math.round(expected * 1e6) / 1e6);
  assert.equal(usage.pricedCalls, 2, 'openai today + anthropic settled; yesterday and the unsettled/nvidia calls are excluded from pricedCalls');
  assert.equal(usage.unpricedCalls, 1, 'the nvidia call is real spend of unknown size, not silently zero');
  assert.equal(usage.date, '2026-09-23');
  assert.equal(usage.snapshotVersion, PROVIDER_UNIT_PRICES_SNAPSHOT.version);
});

test('dailyCostLimitStatus: no configured limit never blocks; a configured limit blocks once reached, and fails closed on any unpriced call today', () => {
  const cheap = [jobWith('openai', [settled(100, 100)])];
  assert.equal(dailyCostLimitStatus(cheap, null, '2026-09-23T12:00:00.000Z').blocked, false);
  assert.equal(dailyCostLimitStatus(cheap, undefined, '2026-09-23T12:00:00.000Z').blocked, false);

  const overBudget = dailyCostLimitStatus(cheap, 0.0000001, '2026-09-23T12:00:00.000Z');
  assert.equal(overBudget.blocked, true); assert.equal(overBudget.reason, 'daily_cost_limit');

  const underBudget = dailyCostLimitStatus(cheap, 1000, '2026-09-23T12:00:00.000Z');
  assert.equal(underBudget.blocked, false); assert.equal(underBudget.reason, null);

  const withUnpriced = [jobWith('openai', [settled(100, 100)]), jobWith('nvidia', [settled(100, 100)])];
  const unknownTotal = dailyCostLimitStatus(withUnpriced, 1000, '2026-09-23T12:00:00.000Z');
  assert.equal(unknownTotal.blocked, true, 'a $1000 cap cannot be honestly certified as unreached when part of today\'s spend is unpriced');
  assert.equal(unknownTotal.reason, 'cost_pricing_unknown');

  assert.throws(() => dailyCostLimitStatus(cheap, 'not-a-number', '2026-09-23T12:00:00.000Z'), RangeError);
  assert.throws(() => dailyCostLimitStatus(cheap, -1, '2026-09-23T12:00:00.000Z'), RangeError);
});

test('YENO_AGENT_DAILY_COST_LIMIT_USD: absent means no cap; blank/invalid fails closed at config time like the existing call limit', () => {
  const base = {YENO_AGENT_PROVIDER: 'openai', YENO_AGENT_DAILY_CALL_LIMIT: '4', YENO_OPENAI_MODEL: 'm', YENO_OPENAI_API_KEY: 'k'};
  assert.equal(agentConfig(base).dailyCostLimitUsd, null);
  assert.equal(agentConfig({...base, YENO_AGENT_DAILY_COST_LIMIT_USD: ''}).dailyCostLimitUsd, null);
  assert.equal(agentConfig({...base, YENO_AGENT_DAILY_COST_LIMIT_USD: '2.5'}).dailyCostLimitUsd, 2.5);
  assert.equal(agentConfig({...base, YENO_AGENT_DAILY_COST_LIMIT_USD: '0'}).dailyCostLimitUsd, 0);
  for (const bad of ['-1', 'abc', '1e5', '1,5']) assert.throws(() => agentConfig({...base, YENO_AGENT_DAILY_COST_LIMIT_USD: bad}), /invalid_configuration/);
});

test('runAgent: a configured cost cap blocks a NEW reserved call once reached, in addition to (never instead of) the call-count limit', async () => {
  const state = initialState();
  const first = {id: randomUUID(), input: '첫 요청'}, second = {id: randomUUID(), input: '둘째 요청'};
  state.jobs.push(first, second);
  const env = {YENO_AGENT_PROVIDER: 'openai', YENO_AGENT_DAILY_CALL_LIMIT: '4', YENO_OPENAI_MODEL: 'synthetic-model', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_AGENT_DAILY_COST_LIMIT_USD: '0.00002'};
  const config = agentConfig(env);
  const reply = new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: '합성 결과', tool_calls: []}}], usage: {prompt_tokens: 1000, completion_tokens: 1000}}), {headers: {'Content-Type': 'application/json'}});
  const common = {state, save: () => {}, signal: new AbortController().signal, config};
  await runAgent({...common, job: first, fetchImpl: async (url, req) => { assert.equal(url, AGENT_ENDPOINTS.openai); return reply.clone(); }});
  assert.equal(agentUsage(state.jobs).attempts, 1);
  // The first call's estimated cost (1000/1k in + 1000/1k out at the openai
  // snapshot price) already exceeds the $0.00002 cap, so the second call's
  // reservation is refused before any request is sent - the daily call-count
  // limit (4) is nowhere near reached, proving this is the cost gate, not it.
  await assert.rejects(runAgent({...common, job: second, fetchImpl: () => assert.fail('cost cap must block before another request is sent')}), /daily_cost_limit/);
});
