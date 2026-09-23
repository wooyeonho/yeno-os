// F14 concurrent-worker cost-cap enforcement test.
//
// The single-job test in cost-ledger.test.mjs proves the cap blocks a NEW
// reservation once PRIOR SETTLED spend already reached it. This file asks a
// different, harder question the owner explicitly raised: does the cap still
// hold when multiple jobs' runAgent() calls are genuinely in flight at the
// same time (their network responses arrive interleaved, not one-at-a-time)?
//
// dailyCostUsage()/dailyCostLimitStatus() only ever counted calls with
// status 'settled' - a 'reserved' (in-flight, not yet responded) call was
// invisible to the cap check. Two jobs reserving before either settles could
// therefore both pass the same "are we under budget" check, then both
// settle, landing the real total over the configured cap. This is exactly
// the "동시 worker... 상한 초과 차단을 실제 보장하는지" gap the owner asked
// to have verified - not assumed from the sequential test alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runAgent, agentUsage} from '../lib/agent.mjs';
import {dailyCostLimitStatus, pendingCostReservationsToday} from '../lib/cost-ledger.mjs';
import {agentConfig, AGENT_ENDPOINTS} from '../lib/provider-config.mjs';
import {initialState} from '../lib/store.mjs';

function delayedOpenAiResponse(delayMs) {
  return async (url) => {
    assert.equal(url, AGENT_ENDPOINTS.openai);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: '합성 결과', tool_calls: []}}], usage: {prompt_tokens: 1000, completion_tokens: 1000}}), {headers: {'Content-Type': 'application/json'}});
  };
}

test('F14 concurrency: two workers racing the SAME cost cap never both settle over budget (real interleaved async, not sequential)', async () => {
  const state = initialState();
  const jobA = {id: randomUUID(), input: 'worker A'}, jobB = {id: randomUUID(), input: 'worker B'};
  state.jobs.push(jobA, jobB);
  // openai settled cost per call (1000in+1000out) = 0.003+0.015 = 0.018.
  // Cap set to 0.03: ONE settled call (0.018) fits under budget, but TWO
  // (0.036) would exceed it. If the cap is genuinely enforced under
  // concurrency, at most one of the two workers may ever settle a call
  // before the other is blocked - never both.
  const env = {YENO_AGENT_PROVIDER: 'openai', YENO_AGENT_DAILY_CALL_LIMIT: '10', YENO_OPENAI_MODEL: 'synthetic-model', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_AGENT_DAILY_COST_LIMIT_USD: '0.03'};
  const config = agentConfig(env);
  const common = {state, save: () => {}, signal: new AbortController().signal, config};
  // Both workers' network responses resolve at almost the same time (B
  // slightly after A), which is what genuine concurrent in-flight requests
  // look like - reservation for B happens BEFORE A's response has settled.
  const results = await Promise.allSettled([
    runAgent({...common, job: jobA, fetchImpl: delayedOpenAiResponse(30)}),
    runAgent({...common, job: jobB, fetchImpl: delayedOpenAiResponse(35)}),
  ]);
  const outcomes = results.map(r => r.status);
  const settledCount = jobA.agentJournal.calls.filter(c=>c.status==='settled').length + jobB.agentJournal.calls.filter(c=>c.status==='settled').length;
  const totalReal = settledCount * 0.018;
  // The real, load-bearing assertion: actual settled spend must never exceed
  // the configured cap, regardless of how the two promises interleaved.
  assert.ok(totalReal <= 0.03 + 1e-9, `cap must hold under concurrency: settledCount=${settledCount} impliedUsd=${totalReal} > cap 0.03 (outcomes=${JSON.stringify(outcomes)})`);
  // And it must hold via an actual rejection, not a silent skip - exactly one
  // worker should have been rejected with the cost-cap reason.
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(rejected.length, 1, `expected exactly one worker blocked by the cap, got: ${JSON.stringify(outcomes)}`);
  assert.match(rejected[0].reason.message, /cost_pricing_unknown|daily_cost_limit/);
});

test('F14 concurrency: pendingCostReservationsToday reports an in-flight reservation before it settles', async () => {
  const state = initialState();
  const job = {id: randomUUID(), input: '단일 작업'};
  state.jobs.push(job);
  const env = {YENO_AGENT_PROVIDER: 'openai', YENO_AGENT_DAILY_CALL_LIMIT: '10', YENO_OPENAI_MODEL: 'synthetic-model', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_AGENT_DAILY_COST_LIMIT_USD: '10'};
  const config = agentConfig(env);
  assert.equal(pendingCostReservationsToday(state.jobs), 0);
  let sawPendingDuringFlight = false;
  const fetchImpl = async () => {
    sawPendingDuringFlight = pendingCostReservationsToday(state.jobs) > 0;
    return new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: '결과', tool_calls: []}}], usage: {prompt_tokens: 10, completion_tokens: 10}}), {headers: {'Content-Type': 'application/json'}});
  };
  await runAgent({state, job, save: () => {}, signal: new AbortController().signal, config, fetchImpl});
  assert.equal(sawPendingDuringFlight, true, 'the reservation must be durably recorded (status reserved) before the network request is sent');
  assert.equal(pendingCostReservationsToday(state.jobs), 0, 'once settled, it no longer counts as pending');
});
