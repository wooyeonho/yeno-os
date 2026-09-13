import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentConfig } from '../lib/provider-config.mjs';
import { automaticMission } from '../lib/agent.mjs';
import { initialAutopilot, planAutopilot, getAutopilotStatus } from '../lib/autopilot.mjs';
import { RESEARCH_TRACKS } from '../lib/research.mjs';
import { start } from '../server.mjs';
import {
  INDEPENDENT_CORE_CONTRACT,
  assertIndependentCoreContract,
  executionBoundary,
  independentCoreStatus,
} from '../lib/independent-core.mjs';

const START = '2026-09-13T00:00:00.000Z';
const FUTURE = '2026-09-13T01:00:00.000Z';
const localTypes = ['document', 'diagnostics', 'evolution', 'world', 'video', 'forai', 'capability'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = agentConfig({
  YENO_AGENT_PROVIDER: 'openai',
  YENO_AGENT_DAILY_CALL_LIMIT: '4',
  YENO_OPENAI_MODEL: 'synthetic-model',
  YENO_OPENAI_API_KEY: 'synthetic-key',
  YENO_AGENT_AUTORUN: 'true',
});

function autopilotState(documents = false) {
  return {
    autopilot: { ...initialAutopilot(), enabled: true, enabledAt: START },
    emergencyStop: false,
    modules: { documents, ai: true },
    jobs: [],
    projects: RESEARCH_TRACKS.map(track => ({ id: track.projectId, status: 'active' })),
    artifacts: {},
    discovery: { enabled: true, lastRun: { startedAt: START, status: 'completed', added: 1, updated: 0 } },
    ecosystem: { enabled: false, lastRun: null },
  };
}

function settledResearchJob(track, { calls = 1, step = 1 } = {}) {
  return {
    id: randomUUID(), type: 'agent', title: '저장된 연구', input: 'stored', status: 'paused', pauseReason: 'restart',
    step, totalSteps: 3, createdAt: START, updatedAt: START, error: null, version: 1, artifacts: [],
    deadlineAt: FUTURE, callLimit: 1, projectId: track.projectId,
    researchRequest: { version: 1, question: '저장된 질문', query: track.defaultEnglishQuery, projectId: track.projectId, trackCode: track.code },
    autopilot: { version: 1, kind: 'research', taskKey: `research:${track.code}:0`, phase: 0, trackCode: track.code },
    agentJournal: {
      provider: 'openai', model: 'synthetic-model',
      calls: Array.from({ length: calls }, () => ({ id: randomUUID(), at: START, status: 'settled', inputTokens: 1, outputTokens: 1 })),
      history: [{ role: 'user', content: '저장된 질문' }, ...(calls ? [{ role: 'assistant', content: '이미 받은 최종 답안', toolCalls: [] }] : [])],
    },
  };
}

async function harness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-independent-'));
  const dataDir = path.join(root, 'data');
  const token = 'blackhole-independent-test-token';
  let modelCalls = 0;
  const options = {
    dataDir, host: '127.0.0.1', port: 0, token, env: {},
    agentFetch: async () => { modelCalls++; throw new Error('model transport must not be reached'); },
  };
  let core = await start(options);
  const api = async (route, { method = 'GET', body } = {}) => {
    const response = await fetch(`http://127.0.0.1:${core.server.address().port}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let value;
    try { value = JSON.parse(bytes); } catch { value = bytes.toString(); }
    return { status: response.status, value, bytes };
  };
  const readState = async () => {
    const response = await api('/api/state');
    assert.equal(response.status, 200, JSON.stringify(response.value));
    return response.value;
  };
  const wait = async id => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const job = (await readState()).jobs.find(item => item.id === id);
      if (['completed', 'failed', 'paused', 'cancelled'].includes(job?.status)) return job;
      await sleep(20);
    }
    throw new Error(`job timeout: ${id}`);
  };
  const restart = async () => {
    core.shutdown();
    core = await start(options);
  };
  t.after(() => {
    core.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { api, readState, wait, restart, modelCalls: () => modelCalls };
}

test('configured providers stay ready for explicit calls but never authorize background model work', () => {
  assert.equal(config.ready, true);
  assert.equal(config.auto, false);
  assert.equal(config.backgroundModelCalls, false);
  assert.equal(config.provider, 'openai');
});

test('automatic source review cannot create a model mission even when legacy autorun was requested', () => {
  const state = autopilotState(true);
  assert.equal(automaticMission(state, { ...config, auto: true }), null);
});

test('autopilot keeps local OS work running and selects no new AI research', () => {
  const withoutLocalWork = autopilotState(false);
  assert.equal(planAutopilot(withoutLocalWork, { config, at: START }), null);
  const status = getAutopilotStatus(withoutLocalWork, { config, at: START });
  assert.equal(status.modelPolicy, 'explicit-only');
  assert.equal(status.backgroundModelCalls, false);
  assert.match(status.summary, /독립 운영 모드/);
  assert.ok(status.blockers.some(item => item.id === 'model-policy'));

  const withLocalWork = autopilotState(true);
  const plan = planAutopilot(withLocalWork, { config, at: START });
  assert.equal(plan.kind, 'world');
  assert.equal(plan.motivation.signals.estimatedCalls, 0);
});

test('restart may finish a settled local checkpoint but cannot start a new provider call', () => {
  const track = RESEARCH_TRACKS[0];
  const settled = autopilotState(false); settled.jobs.push(settledResearchJob(track, { step: 2 }));
  settled.jobs[0].draft = '새 호출 없이 저장할 검증 전 연구 초안';
  assert.deepEqual(planAutopilot(settled, { config, at: '2026-09-13T00:10:00.000Z' }), { kind: 'resume', jobId: settled.jobs[0].id });

  const needsCall = autopilotState(false); needsCall.jobs.push(settledResearchJob(track, { calls: 0, step: 0 }));
  assert.equal(planAutopilot(needsCall, { config, at: '2026-09-13T00:10:00.000Z' }), null);
});

test('independent core contract classifies every existing execution boundary and fails new types closed', () => {
  assert.equal(assertIndependentCoreContract(), true);
  assert.equal(INDEPENDENT_CORE_CONTRACT.bootRequiresModel, false);
  assert.equal(INDEPENDENT_CORE_CONTRACT.persistenceRequiresModel, false);
  assert.equal(INDEPENDENT_CORE_CONTRACT.recoveryRequiresModel, false);
  for (const type of localTypes) assert.equal(executionBoundary({ type }).requiresModel, false, type);
  for (const type of ['agent', 'ai']) assert.equal(executionBoundary({ type }).requiresModel, true, type);
  for (const mode of ['generate', 'repair']) {
    assert.equal(executionBoundary({ type: 'code', codeTask: { mode } }).kind, 'development-model-call');
  }
  for (const mode of ['github', 'verify', 'run']) {
    assert.equal(executionBoundary({ type: 'code', codeTask: { mode } }).kind, 'local-core');
  }
  const unknown = executionBoundary({ type: 'future-worker' });
  assert.equal(unknown.kind, 'unclassified');
  assert.equal(unknown.requiresModel, null);
  const status = independentCoreStatus({
    modelConfigured: false, aiModuleEnabled: false,
    jobs: [
      { type: 'document', status: 'queued' },
      { type: 'agent', status: 'queued' },
      { type: 'code', status: 'running', codeTask: { mode: 'generate' } },
      { type: 'future-worker', status: 'queued' },
    ],
  });
  assert.equal(status.coreReady, true);
  assert.equal(status.modelOptional, true);
  assert.equal(status.jobs.activeLocalCore, 1);
  assert.equal(status.jobs.activeBlockedByMissingModel, 2);
  assert.equal(status.jobs.unclassified, 1);
});

test('zero model keys still boot, execute local work, run Kirby code and recover after restart', async t => {
  const h = await harness(t);
  let currentState = await h.readState();
  assert.equal(currentState.modules.ai, false, 'startup without a provider must disable only the AI module');
  assert.equal(currentState.agent.usage.attempts, 0);

  const document = await h.api('/api/jobs', {
    method: 'POST',
    body: {
      type: 'document', title: '독립 코어 결과',
      text: '모델 키 없이 BLACKHOLE 코어가 만든 영속 결과입니다.', requestId: randomUUID(),
    },
  });
  assert.equal(document.status, 201, JSON.stringify(document.value));
  const documentJob = await h.wait(document.value.job.id);
  assert.equal(documentJob.status, 'completed');
  assert.equal(documentJob.execution.kind, 'local-core');
  assert.equal(documentJob.execution.requiresModel, false);

  const manifest = {
    schemaVersion: 1,
    id: 'offline-sum',
    version: '1.0.0',
    name: '독립 합계',
    description: '모델 호출 없이 숫자 배열의 합을 계산한다.',
    source: {
      kind: 'owner', url: '', commit: '', license: 'Owner private code',
      licenseText: 'Owner-authored private code for BLACKHOLE local execution.',
    },
    files: [{ path: 'main.mjs', content: 'export function run(values){ return values.reduce((sum,value)=>sum+value,0); }' }],
    entry: 'main.mjs',
    fixtures: [
      { name: '합계', input: [2, 4, 6], expected: 12 },
      { name: '빈 배열', input: [], expected: 0 },
    ],
  };
  const imported = await h.api('/api/code/import', {
    method: 'POST', body: { requestId: randomUUID(), manifest },
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.value));
  const hash = imported.value.result.hash;
  const verified = await h.api('/api/code/verify', {
    method: 'POST', body: { requestId: randomUUID(), id: manifest.id, hash, activate: true },
  });
  assert.equal(verified.status, 201, JSON.stringify(verified.value));
  const verifiedJob = await h.wait(verified.value.jobId);
  assert.equal(verifiedJob.status, 'completed', JSON.stringify(verifiedJob));
  assert.equal(verifiedJob.execution.kind, 'local-core');

  const run = await h.api('/api/code/run', {
    method: 'POST', body: { requestId: randomUUID(), id: manifest.id, input: [10, 15, 17] },
  });
  assert.equal(run.status, 201, JSON.stringify(run.value));
  const runJob = await h.wait(run.value.jobId);
  assert.equal(runJob.status, 'completed', JSON.stringify(runJob));
  assert.equal(runJob.execution.kind, 'local-core');
  const outputArtifact = runJob.artifacts.find(artifact => artifact.name.endsWith('.json'));
  assert.ok(outputArtifact);
  const output = await h.api(`/api/artifacts/${outputArtifact.id}`);
  assert.equal(output.status, 200);
  assert.equal(output.value, 42);

  assert.equal((await h.api('/api/voice', {
    method: 'POST', body: { requestId: randomUUID(), text: '모델을 호출해', history: [] },
  })).status, 409);
  assert.equal((await h.api('/api/code/generate', {
    method: 'POST', body: { requestId: randomUUID(), goal: '새 코드를 작성해', fixtures: [] },
  })).status, 409);
  assert.equal((await h.api('/api/jobs', {
    method: 'POST', body: { type: 'agent', title: '모델 작업', text: '모델 작업', requestId: randomUUID() },
  })).status, 409);
  assert.equal(h.modelCalls(), 0, 'no-provider operation must never touch model transport');

  currentState = await h.readState();
  const summary = independentCoreStatus({
    jobs: currentState.jobs, modelConfigured: false, aiModuleEnabled: currentState.modules.ai,
    emergencyStop: currentState.emergencyStop,
  });
  assert.equal(summary.coreReady, true);
  assert.ok(summary.jobs.localCore >= 3);
  assert.equal(currentState.agent.usage.attempts, 0);

  await h.restart();
  currentState = await h.readState();
  assert.equal(currentState.modules.ai, false);
  assert.equal(currentState.jobs.find(job => job.id === runJob.id).execution.kind, 'local-core');
  const recovered = await h.api(`/api/artifacts/${outputArtifact.id}`);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.value, 42);
  assert.equal(h.modelCalls(), 0);
});
