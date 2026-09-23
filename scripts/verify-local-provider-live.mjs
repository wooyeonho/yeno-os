// Manual, real-network live verification for the BLACKHOLE 'local' provider (A01).
// NOT part of `npm test` - this makes a REAL HTTP call to a REAL local model
// runtime (Ollama) and is meant to be run by hand, ideally with the machine's
// internet connection disconnected, to prove:
//   1. A real YENO agent job is served end-to-end by the local model.
//   2. Every network call this process makes during that job goes to loopback
//      (127.0.0.1/localhost) only - never to any of the cloud provider hosts.
//
// Usage (PowerShell, from the repo root):
//   $env:YENO_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1/chat/completions"
//   node scripts/verify-local-provider-live.mjs
//
// Run it once with internet ON and once with internet OFF (Wi-Fi/ethernet
// disconnected) - both runs should print the same "OK" result, and the
// fetch log should show only loopback targets in both cases.

import { randomUUID } from 'node:crypto';
import { agentConfig, runAgent } from '../runtime/lib/agent.mjs';
import { initialState, digest } from '../runtime/lib/store.mjs';

const calls = []; // every fetch target this process attempts, for the log
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const target = typeof url === 'string' ? url : url?.url ?? String(url);
  calls.push(target);
  return realFetch(url, options);
};

const env = {
  YENO_AGENT_PROVIDER: 'local',
  YENO_LOCAL_MODEL: process.env.YENO_LOCAL_MODEL || 'qwen2.5:3b',
  YENO_LOCAL_BASE_URL: process.env.YENO_LOCAL_BASE_URL || 'http://127.0.0.1:11434/v1/chat/completions',
  YENO_AGENT_DAILY_CALL_LIMIT: '4',
};

const config = agentConfig(env);
if (!config.ready) {
  console.error('FAIL: local provider config not ready:', config.missing);
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)(:|\/)/.test(config.endpoint)) {
  console.error('FAIL: endpoint is not loopback-only:', config.endpoint);
  process.exit(1);
}

const at = new Date().toISOString();
const inputText = 'YENO 오프라인 검증: 오늘 할 일 한 가지를 한국어 한 문장으로 제안해줘.';
const state = initialState();
state.modules.ai = true;
const job = {
  id: randomUUID(), type: 'agent', title: 'A01 오프라인 검증', input: inputText,
  status: 'running', step: 1, totalSteps: 3, createdAt: at, updatedAt: at, error: null,
  version: 1, artifacts: [], normalized: inputText, inputSha256: digest(inputText),
};
state.jobs.push(job);

try {
  const draft = await runAgent({ job, state, config, save: () => {}, signal: new AbortController().signal });
  const external = calls.filter(target => !/^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)(:|\/)/.test(target));
  console.log('--- RESULT ---');
  console.log('endpoint used     :', config.endpoint);
  console.log('model             :', config.model);
  console.log('total fetch calls :', calls.length);
  console.log('fetch targets     :', JSON.stringify(calls));
  console.log('external calls    :', external.length, external.length ? JSON.stringify(external) : '(none)');
  console.log('model output      :', draft);
  console.log(external.length === 0 ? 'OK: 0 external calls, response came from the local model.' : 'FAIL: external call(s) detected.');
  process.exit(external.length === 0 ? 0 : 1);
} catch (error) {
  console.error('FAIL: local provider call did not complete:', error.code || error.message);
  console.error('fetch targets so far:', JSON.stringify(calls));
  process.exit(1);
}
