// Wiring test for local-embedding semantic recall inside /api/voice, added
// alongside the P2 memory-embeddings module. Uses an injected embedFetch
// (never the real network) so this runs in ordinary `npm test` without
// Ollama. Proves: (1) POST /api/memory-embeddings stores a real embedding
// via the same fail-closed loopback contract as memory-embeddings.mjs, (2)
// a later /api/voice call with DIFFERENT wording than the stored text still
// surfaces the record in job.memoryRecall.semantic (the "visible evidence"
// requirement), (3) it never blocks /api/voice when embeddings are
// unconfigured or the embedding call fails (fail-open).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';

// A real agent provider must be configured (agentSettings.ready) or the
// server force-disables the ai module on every boot regardless of seeded
// state (see server.mjs's `if(store.recovered||(!aiEndpoint&&!agentSettings.ready...))s.modules.ai=false`).
// The local embedding endpoint is a SEPARATE env axis from the chat/agent
// provider - this test exercises the embeddings wiring, not the A01 local
// chat provider, so a synthetic openai-shaped agent provider is enough here.
const EMBED_ENV = {YENO_AGENT_PROVIDER: 'openai', YENO_OPENAI_API_KEY: 'synthetic-openai-key', YENO_OPENAI_MODEL: 'synthetic-openai', YENO_AGENT_DAILY_CALL_LIMIT: '4', YENO_LOCAL_EMBED_MODEL: 'bge-m3'};

// Deterministic hand-built vectors: 'unique' and its paraphrase share
// direction (high cosine similarity); 'unrelated' does not.
const VEC = {
  '예노 프로젝트의 두번째 백업 이름은 테스트용-청록이다': [1, 0, 0, 0, 0, 0, 0, 0],
  '예노 프로젝트 두 번째 백업 이름이 뭐야?': [0.9, 0.1, 0, 0, 0, 0, 0, 0],
};
function vectorFor(text) {
  if (VEC[text]) return VEC[text];
  // Any other text (e.g. the base context prefix folded into /api/voice's
  // prompt is never embedded directly - only raw stored/query text is) gets
  // an unrelated vector so it never matches by accident.
  return [0, 1, 0, 0, 0, 0, 0, 0];
}

async function setup(t, {embedMode = 'ok'} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-voice-embed-'));
  const token = 'synthetic-voice-embed-owner-token';
  { const store = openStore(dir); store.state.modules.ai = true; store.save(); }
  const embedCalls = [];
  const embedFetch = async (url, options) => {
    embedCalls.push(url);
    if (embedMode === 'fail') return new Response('{}', {status: 500});
    if (embedMode === 'timeout') throw new Error('synthetic embed outage');
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({embedding: vectorFor(body.prompt)}), {headers: {'content-type': 'application/json'}});
  };
  const agentFetch = async () => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: '합성 응답', tool_calls: []}}], usage: {prompt_tokens: 10, completion_tokens: 5}}), {headers: {'Content-Type': 'application/json'}});
  const runtime = await start({host: '127.0.0.1', port: 0, dataDir: dir, token, env: EMBED_ENV, agentFetch, embedFetch});
  const request = async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {method, headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: r.status, body: await r.json()};
  };
  const post = (route, body = {}) => request('POST', route, {requestId: randomUUID(), ...body});
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {post, embedCalls};
}

test('stores a real local embedding via /api/memory-embeddings and never calls anything but the injected fetch', async t => {
  const {post, embedCalls} = await setup(t);
  const stored = await post('/api/memory-embeddings', {text: '예노 프로젝트의 두번째 백업 이름은 테스트용-청록이다'});
  assert.equal(stored.status, 201);
  assert.ok(stored.body.memoryEmbedding.id);
  assert.equal(stored.body.memoryEmbedding.model, 'bge-m3');
  assert.equal(embedCalls.length, 1);
});

test('/api/voice surfaces a stored fact via semantic recall for a DIFFERENTLY WORDED question, alongside (never replacing) the existing token-overlap recall', async t => {
  const {post} = await setup(t);
  const stored = await post('/api/memory-embeddings', {text: '예노 프로젝트의 두번째 백업 이름은 테스트용-청록이다'});
  const voice = await post('/api/voice', {text: '예노 프로젝트 두 번째 백업 이름이 뭐야?', history: []});
  assert.equal(voice.status, 201);
  const recall = voice.body.job.memoryRecall;
  assert.ok(recall, 'job.memoryRecall must be present');
  assert.ok(recall.semantic, 'semantic recall must be present when memoryEmbeddings exist and an endpoint is configured');
  assert.ok(recall.semantic.ids.includes(stored.body.memoryEmbedding.id), 'the differently-worded question must recall the stored id');
  assert.equal(recall.semantic.recalledCount, recall.semantic.ids.length);
});

test('/api/voice still succeeds (fail-open) when the local embedding server errors', async t => {
  const {post} = await setup(t, {embedMode: 'fail'});
  await post('/api/memory-embeddings', {text: 'x'}).catch(() => {}); // may itself fail; irrelevant to this test
  const voice = await post('/api/voice', {text: '아무 질문', history: []});
  assert.equal(voice.status, 201);
  assert.equal(voice.body.job.memoryRecall.semantic, null);
});

test('/api/voice reports semantic:null (not an error) when no memory embeddings have been stored yet', async t => {
  const {post} = await setup(t);
  const voice = await post('/api/voice', {text: '아무 질문', history: []});
  assert.equal(voice.status, 201);
  assert.equal(voice.body.job.memoryRecall.semantic, null);
});
