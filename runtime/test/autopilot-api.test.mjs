import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { start } from '../server.mjs';
import { digest, openStore } from '../lib/store.mjs';
import { decryptBackup, restoreBackup } from '../lib/backup.mjs';
import { RESEARCH_TRACKS } from '../lib/research.mjs';
import { PRODUCTION_PROJECTS } from '../lib/production.mjs';
import { WORLD_FEED, WORLD_HAZARD_FEED } from '../lib/world.mjs';
import { verifyAutopilot } from '../../scripts/verify-autopilot-live.mjs';

const owner = 'synthetic-autopilot-owner-token';
const providerKey = 'synthetic-autopilot-provider-key';
const env = { YENO_AGENT_PROVIDER: 'auto', YENO_AGENT_DAILY_CALL_LIMIT: '20', YENO_OPENAI_API_KEY: providerKey, YENO_OPENAI_MODEL: 'synthetic-autopilot-model' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const modelResponse = () => response({ choices: [{ finish_reason: 'stop', message: { content: '합성 검증용 연구 초안입니다. [S1]에서 관측한 연관성을 독립 자료로 검증해야 합니다. 원인이나 치료 효과는 입증하지 않았습니다.', tool_calls: [] } }], usage: { prompt_tokens: 65, completion_tokens: 30 } });
const e01 = RESEARCH_TRACKS.find(track => track.code === 'E01');

function canonicalProjects() {
  const stamp = new Date().toISOString();
  return [{ id: e01.projectId, name: e01.name }, { id: PRODUCTION_PROJECTS.video, name: 'B02-4 합성 검증용 영상' }, { id: PRODUCTION_PROJECTS.forai, name: 'A01 합성 검증용 For-Ai' }].map(project => ({ ...project, repositoryUrl: '', summary: '합성 테스트 자료이며 실제 소유자 원문이 아닙니다.', nextAction: '저장된 근거와 산출물 검증', status: 'active', version: 1, createdAt: stamp, updatedAt: stamp }));
}

function worldResponse(url) {
  const at = Date.now();
  if (url === WORLD_FEED) return response({ type: 'FeatureCollection', metadata: { generated: at, count: 1, status: 200 }, features: [{ type: 'Feature', id: 'autopilot_synthetic_quake', properties: { type: 'earthquake', mag: 3.2, place: 'Synthetic location', time: at - 1_000, updated: at, status: 'reviewed' }, geometry: { type: 'Point', coordinates: [128, 37, 10] } }] });
  assert.equal(url, WORLD_HAZARD_FEED);
  return response({ title: 'EONET Events', events: [{ id: 'EONET_SYNTHETIC_AUTO', title: 'Synthetic hazard', closed: null, categories: [{ id: 'wildfires' }], geometry: [{ date: new Date(at - 1_000).toISOString(), type: 'Point', coordinates: [128, 37] }] }] });
}

function researchResponse(url) {
  const host = new URL(url).hostname;
  if (host === 'www.ebi.ac.uk') return response({ hitCount: 1, resultList: { result: [{ id: '12345678', source: 'MED', pmid: '12345678', title: 'Synthetic antimicrobial surveillance study', authorString: 'Synthetic Researcher', pubYear: '2025', doi: '10.1000/autopilot-synthetic', abstractText: 'Synthetic observations require independent replication. No causal effect was established.', journalInfo: { journal: { title: 'Synthetic Evidence Journal' } }, pubTypeList: { pubType: ['Journal Article'] }, isRetracted: 'N' }] } });
  assert.equal(host, 'api.crossref.org');
  return response({ status: 'ok', 'message-type': 'work-list', message: { 'total-results': 0, items: [] } });
}

// This injected transport tests durable scheduling and file integrity only.
// Real H.264 rendering is covered by production-api and the live verifier.
async function syntheticVideo({ outputPath, input, signal }) {
  assert.equal(signal.aborted, false); assert.ok(input.scenes.length > 0);
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom synthetic autopilot video'), Buffer.alloc(2_048)]);
  fs.writeFileSync(outputPath, bytes, { flag: 'wx', mode: 0o600 });
  return { bytes: bytes.length, sha256: digest(bytes) };
}

async function eventually(read, predicate, label, ms = 12_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await delay(20); }
  assert.fail(`Autopilot condition not reached: ${label}`);
}

async function fixture(t, options = {}, projects = canonicalProjects()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-autopilot-api-')), dataDir = path.join(root, 'source');
  const stored = openStore(dataDir); stored.state.projects.push(...projects); stored.save();
  const config = { host: '127.0.0.1', port: 0, dataDir, token: owner, env, worldFetch: async url => worldResponse(url), worldHazardFetch: async url => worldResponse(url), researchFetch: async url => researchResponse(url), agentFetch: async () => modelResponse(), videoRender: syntheticVideo, ...options };
  let core = await start(config); const replacements = [];
  t.after(() => { core.shutdown(); for (const runtime of replacements) runtime.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const at = async (runtime, route, body, credential = owner) => {
    const result = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const bytes = Buffer.from(await result.arrayBuffer()), text = bytes.toString('utf8');
    return { status: result.status, bytes, text, headers: result.headers, json: result.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : undefined };
  };
  const api = (...args) => at(core, ...args), post = (route, body) => api(route, { requestId: randomUUID(), ...body });
  return { root, dataDir, api, at, post, core: () => core, jobs: () => core.state().jobs.filter(job => job.autopilot),
    restart: async () => { core.shutdown(); core = await start(config); },
    restored: async targetDir => { const runtime = await start({ ...config, dataDir: targetDir, token: 'synthetic-restored-autopilot-owner' }); replacements.push(runtime); return runtime; },
  };
}

test('native timer selects world, canonical research, private For-Ai and derived video after only one durable enable request', { timeout: 20_000 }, async t => {
  let modelCalls = 0, researchReads = 0, worldReads = 0, renders = 0, app;
  app = await fixture(t, {
    worldFetch: async url => { worldReads++; return worldResponse(url); }, worldHazardFetch: async url => { worldReads++; return worldResponse(url); },
    researchFetch: async url => { researchReads++; return researchResponse(url); },
    agentFetch: async () => { modelCalls++; const stored = openStore(app.dataDir).state; assert.ok(stored.jobs.find(job => job.autopilot?.kind === 'research')?.researchEvidenceId, 'evidence is durable before any model call'); return modelResponse(); },
    videoRender: async input => { renders++; return syntheticVideo(input); },
  });
  const initial = (await app.api('/api/autopilot')).json;
  assert.equal(initial.enabled, false); assert.equal(initial.dailyAiLimit, 4); assert.equal(initial.aiUsedToday, 0);
  await delay(200); assert.equal(app.jobs().length, 0, 'the default is inactive');
  const body = { requestId: randomUUID(), enabled: true, dailyAiLimit: 1 };
  const accepted = await app.api('/api/autopilot', body); assert.equal(accepted.status, 200, accepted.text);
  assert.equal((await app.api('/api/autopilot', body)).status, 200);
  assert.equal((await app.api('/api/autopilot', { ...body, dailyAiLimit: 2 })).status, 409);
  const jobs = await eventually(app.jobs, jobs => {
    assert.ok(jobs.filter(job => ['queued', 'running'].includes(job.status)).length <= 1, 'only one automatic task executes at once');
    return ['world', 'research', 'forai', 'video'].every(kind => jobs.some(job => job.autopilot.kind === kind && job.status === 'completed'));
  }, 'all four native selected outputs');
  assert.equal(jobs.length, 4); assert.equal(modelCalls, 1); assert.equal(researchReads, 2); assert.equal(worldReads, 2); assert.equal(renders, 1);
  const research = jobs.find(job => job.autopilot.kind === 'research');
  assert.equal(research.projectId, e01.projectId); assert.equal(research.autopilot.trackCode, 'E01');
  assert.equal(research.agent.calls, 1); assert.equal(research.agent.unknownCalls, 0);
  for (const job of jobs.filter(job => ['forai', 'video'].includes(job.autopilot.kind))) { assert.equal(job.autopilot.parentJobId, research.id); assert.equal(job.agent?.calls ?? 0, 0); }
  const files = new Map(); let foraiEvidence;
  for (const job of jobs) for (const artifact of job.artifacts) {
    const downloaded = await app.api(`/api/artifacts/${artifact.id}`); assert.equal(downloaded.status, 200);
    assert.equal(digest(downloaded.bytes), downloaded.headers.get('x-content-sha256')); files.set(artifact.id, downloaded.bytes);
    if (job.autopilot.kind === 'forai' && artifact.name.startsWith('forai-evidence-')) { foraiEvidence = downloaded.json; assert.equal(foraiEvidence.source.readMethod, 'core_generated_research', 'generated research HTML must not be labelled owner paste'); }
  }
  assert.deepEqual(foraiEvidence.source.generatedFrom, { jobId: research.id, answerSha256: digest(files.get(research.artifacts.find(file => file.name.startsWith('research-answer-')).id)) });
  const overview = (await app.api('/api/autopilot')).json;
  assert.equal(overview.enabled, true); assert.equal(overview.aiUsedToday, 1); assert.equal(overview.dailyAiLimit, 1);
  assert.equal(overview.globalUsedToday, 1); assert.equal(overview.globalLimit, 20); assert.ok(overview.nextAt);
  assert.equal(app.core().state().autopilot.enabled, true);
  assert.ok(!JSON.stringify(overview).includes(owner)); assert.ok(!JSON.stringify(overview).includes(providerKey));
  await app.restart(); await delay(300);
  assert.equal((await app.api('/api/autopilot', body)).status, 200);
  assert.deepEqual(app.jobs().map(job => job.id), jobs.map(job => job.id)); assert.equal(modelCalls, 1); assert.equal(renders, 1);
  for (const [id, bytes] of files) assert.deepEqual((await app.api(`/api/artifacts/${id}`)).bytes, bytes);
});

test('autopilot controls require authentication and a strict bounded request before any task is created', async t => {
  const app = await fixture(t);
  assert.equal((await app.api('/api/autopilot', undefined, null)).status, 401);
  assert.equal((await app.api('/api/autopilot', { requestId: randomUUID(), enabled: true }, null)).status, 401);
  for (const invalid of [
    { enabled: true }, { requestId: randomUUID(), enabled: 'true' }, { requestId: randomUUID(), enabled: true, dailyAiLimit: 0 },
    { requestId: randomUUID(), enabled: true, dailyAiLimit: 5 }, { requestId: randomUUID(), enabled: true, dailyAiLimit: 1.5 },
    { requestId: randomUUID(), enabled: true, dailyAiLimit: '4' }, { requestId: randomUUID(), enabled: true, intervalMs: 1 },
    { requestId: randomUUID(), enabled: true, shell: 'echo forbidden' },
  ]) { const result = await app.api('/api/autopilot', invalid); assert.equal(result.status, 400, result.text); }
  await delay(200); assert.equal(app.jobs().length, 0); assert.equal((await app.api('/api/autopilot')).json.enabled, false);
});

test('existing APK commands start and stop the same durable automatic operation without a model call', async t => {
  const app = await fixture(t, { env: {}, worldFetch: async () => assert.fail('disabled documents must not fetch'), worldHazardFetch: async () => assert.fail('disabled documents must not fetch'), agentFetch: async () => assert.fail('control commands must not call a model') });
  assert.equal((await app.post('/api/settings', { modules: { documents: false } })).status, 200);
  const enrollment = await app.post('/api/v1/devices/enroll', { name: 'synthetic-autopilot-android', platform: 'android' }); assert.equal(enrollment.status, 201);
  const deviceToken = enrollment.json.device.deviceToken;
  const enable = { requestId: randomUUID(), text: '자동 운영 시작' }, disable = { requestId: randomUUID(), text: '자동 운영 중지' };
  const started = await app.api('/api/v1/commands', enable, deviceToken); assert.equal(started.status, 200, started.text); assert.equal(started.json.kind, 'autopilot'); assert.equal(started.json.autopilot.enabled, true);
  const stopped = await app.api('/api/v1/commands', disable, deviceToken); assert.equal(stopped.status, 200, stopped.text); assert.equal(stopped.json.kind, 'autopilot'); assert.equal(stopped.json.autopilot.enabled, false);
  assert.equal((await app.api('/api/v1/commands', enable, deviceToken)).json.autopilot.enabled, true, 'replay returns the original accepted response');
  assert.equal((await app.api('/api/autopilot')).json.enabled, false, 'replay must not repeat its effect');
  await app.restart(); assert.equal((await app.api('/api/v1/commands', disable, deviceToken)).json.autopilot.enabled, false);
  assert.equal(app.jobs().length, 0); assert.equal(app.core().state().agent.usage.attempts, 0);
});

test('live verifier submits only the fixed control request and verifies native output bytes without exposing credentials', { timeout: 20_000 }, async t => {
  const app = await fixture(t), mutations = [], output = [];
  const transport = async (url, init) => {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://global-iris-gyeol-98386a17.koyeb.app');
    if (init.method === 'POST') mutations.push({ path: parsed.pathname, body: JSON.parse(init.body) });
    return fetch(`http://127.0.0.1:${app.core().server.address().port}${parsed.pathname}${parsed.search}`, init);
  };
  const readOnly = await verifyAutopilot({ env: { YENO_TOKEN: owner }, fetchImpl: transport, write: line => output.push(line) });
  assert.equal(readOnly.mode, 'read_only'); assert.equal(mutations.length, 0); assert.equal(app.jobs().length, 0);
  const proof = await verifyAutopilot({ env: { YENO_TOKEN: owner }, fetchImpl: transport, enable: true, timeoutMs: 12_000, write: line => output.push(line) });
  assert.deepEqual(mutations, [{ path: '/api/autopilot', body: { requestId: 'blackhole-autopilot-20260912-v1:enable', enabled: true, dailyAiLimit: 4 } }]);
  assert.equal(proof.research.calls, 1); assert.equal(proof.forai.parentJobId, proof.research.jobId); assert.equal(proof.video.parentJobId, proof.research.jobId);
  assert.equal(proof.newModelCalls, 1); assert.equal(proof.autopilotAfter.enabled, true);
  assert.ok(output.some(line => line.startsWith('AUTOPILOT_VERIFIED '))); assert.ok(!output.join('\n').includes(owner)); assert.ok(!output.join('\n').includes(providerKey));
  const replay = await verifyAutopilot({ env: { YENO_TOKEN: owner }, fetchImpl: transport, enable: true, timeoutMs: 3_000, write: line => output.push(line) });
  assert.equal(replay.newModelCalls, 0); assert.equal(replay.research.jobId, proof.research.jobId); assert.equal(replay.video.file.sha256, proof.video.file.sha256); assert.equal(app.jobs().length, 4);
});

test('global stop aborts automatic evidence reads, disables selection and release or enable replay cannot resume work', { timeout: 12_000 }, async t => {
  let began, modelCalls = 0, aborts = 0; const beginning = new Promise(resolve => { began = resolve; });
  const app = await fixture(t, { researchFetch: async (url, init) => {
    began(); return new Promise((resolve, reject) => { const abort = () => { aborts++; reject(new DOMException('synthetic stop', 'AbortError')); }; if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); });
  }, agentFetch: async () => { modelCalls++; return modelResponse(); } });
  const enable = { requestId: randomUUID(), enabled: true, dailyAiLimit: 1 };
  assert.equal((await app.api('/api/autopilot', enable)).status, 200); await beginning;
  const active = app.jobs().find(job => job.autopilot.kind === 'research'); assert.ok(active);
  assert.equal((await app.post('/api/control', { action: 'stop' })).status, 200);
  await eventually(() => aborts, count => count > 0, 'active requests aborted');
  assert.equal((await app.api('/api/autopilot')).json.enabled, false);
  assert.equal(app.jobs().find(job => job.id === active.id).status, 'paused'); assert.equal(modelCalls, 0);
  assert.equal((await app.post('/api/control', { action: 'resume' })).status, 200);
  assert.equal((await app.api('/api/autopilot', enable)).status, 200, 'an old response is replayed without repeating its effect');
  await app.restart(); await delay(300);
  assert.equal((await app.api('/api/autopilot')).json.enabled, false);
  assert.equal(app.jobs().find(job => job.id === active.id).status, 'paused'); assert.equal(modelCalls, 0);
});

test('disabling automatic operation leaves the owned task paused across re-enable and normal restart', { timeout: 12_000 }, async t => {
  let began, calls = 0; const beginning = new Promise(resolve => { began = resolve; });
  const hold = async (url, init) => { calls++; began(); return new Promise((resolve, reject) => { const abort = () => reject(new DOMException('synthetic stop', 'AbortError')); if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); }); };
  const app = await fixture(t, { worldFetch: hold, worldHazardFetch: hold });
  await app.post('/api/autopilot', { enabled: true, dailyAiLimit: 1 }); await beginning;
  const active = app.jobs()[0]; assert.equal(active.autopilot.kind, 'world');
  assert.equal((await app.post('/api/autopilot', { enabled: false })).status, 200);
  const paused = app.jobs().find(job => job.id === active.id); assert.equal(paused.status, 'paused'); assert.equal(paused.pauseReason, 'autopilotStopped');
  const readCalls = calls;
  assert.equal((await app.post('/api/autopilot', { enabled: true, dailyAiLimit: 1 })).status, 200);
  await app.restart(); await delay(300);
  assert.equal(app.jobs().find(job => job.id === active.id).status, 'paused'); assert.equal(calls, readCalls, 'paused world work is not retransmitted');
});

test('an explicit AI module off command disables automatic selection and later enabling AI does not restart it', { timeout: 12_000 }, async t => {
  let began, modelCalls = 0; const beginning = new Promise(resolve => { began = resolve; });
  const app = await fixture(t, { researchFetch: async (url, init) => {
    began(); return new Promise((resolve, reject) => { const abort = () => reject(new DOMException('synthetic AI module stop', 'AbortError')); if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); });
  }, agentFetch: async () => { modelCalls++; return modelResponse(); } });
  const enable = { requestId: randomUUID(), enabled: true, dailyAiLimit: 1 };
  assert.equal((await app.api('/api/autopilot', enable)).status, 200); await beginning;
  const research = app.jobs().find(job => job.autopilot.kind === 'research'); assert.ok(research);
  assert.equal((await app.post('/api/settings', { modules: { ai: false }, concurrency: 99 })).status, 400);
  assert.equal((await app.api('/api/autopilot')).json.enabled, true, 'rejected settings must not stop or change automatic operation');
  assert.equal((await app.post('/api/settings', { modules: { ai: false } })).status, 200);
  assert.equal((await app.api('/api/autopilot')).json.enabled, false);
  assert.equal(app.jobs().find(job => job.id === research.id).status, 'paused');
  assert.equal((await app.post('/api/settings', { modules: { ai: true } })).status, 200);
  assert.equal((await app.api('/api/autopilot', enable)).status, 200);
  await app.restart(); await delay(300);
  assert.equal((await app.api('/api/autopilot')).json.enabled, false); assert.equal(app.jobs().find(job => job.id === research.id).status, 'paused'); assert.equal(modelCalls, 0);
});

test('normal restart resumes the same automatic public read without creating a duplicate assignment', { timeout: 15_000 }, async t => {
  let blocked = true, began, modelCalls = 0; const beginning = new Promise(resolve => { began = resolve; });
  const worldRead = async (url, init) => { if (!blocked) return worldResponse(url); began(); return new Promise((resolve, reject) => { const abort = () => reject(new DOMException('synthetic shutdown', 'AbortError')); if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); }); };
  const app = await fixture(t, { worldFetch: worldRead, worldHazardFetch: worldRead, agentFetch: async () => { modelCalls++; return modelResponse(); } });
  await app.post('/api/autopilot', { enabled: true, dailyAiLimit: 1 }); await beginning;
  const original = app.jobs()[0]; blocked = false; await app.restart();
  await eventually(app.jobs, jobs => jobs.some(job => job.autopilot.kind === 'video' && job.status === 'completed'), 'safe automatic continuation after restart');
  const worlds = app.jobs().filter(job => job.autopilot.kind === 'world'); assert.equal(worlds.length, 1); assert.equal(worlds[0].id, original.id); assert.equal(worlds[0].status, 'completed');
  assert.equal(modelCalls, 1); assert.equal((await app.api('/api/autopilot')).json.enabled, true);
});

test('an ambiguous automatic model response consumes its reservation and is never automatically retried', { timeout: 15_000 }, async t => {
  let calls = 0;
  const app = await fixture(t, { agentFetch: async () => { calls++; throw new Error('synthetic connection lost after provider submission'); } });
  await app.post('/api/autopilot', { enabled: true, dailyAiLimit: 1 });
  const failed = await eventually(app.jobs, jobs => jobs.some(job => job.autopilot.kind === 'research' && ['failed', 'paused'].includes(job.status)), 'ambiguous model outcome retained');
  const research = failed.find(job => job.autopilot.kind === 'research'); assert.equal(research.agent.calls, 1); assert.equal(research.agent.unknownCalls, 1); assert.equal(calls, 1);
  await app.restart(); await delay(300);
  assert.equal(app.jobs().filter(job => job.autopilot.kind === 'research').length, 1); assert.equal(calls, 1);
  assert.equal((await app.api('/api/autopilot')).json.aiUsedToday, 1);
  assert.ok(!app.jobs().some(job => ['forai', 'video'].includes(job.autopilot.kind)), 'failed research cannot become a published-looking derivative');
});

test('encrypted clean restore retains automatic identities and output bytes but disables scheduling; malformed state is rejected', { timeout: 20_000 }, async t => {
  let modelCalls = 0;
  const app = await fixture(t, { agentFetch: async () => { modelCalls++; return modelResponse(); } });
  await app.post('/api/autopilot', { enabled: true, dailyAiLimit: 1 });
  const jobs = await eventually(app.jobs, jobs => jobs.some(job => job.autopilot.kind === 'video' && job.status === 'completed'), 'outputs before backup');
  const key = randomBytes(32), exported = await app.api('/api/backups/export', { encryptionKey: key.toString('hex') }); assert.equal(exported.status, 200, exported.text.slice(0, 150));
  const pristine = decryptBackup(exported.bytes, key); assert.equal(pristine.state.autopilot.enabled, true);
  const reencrypt = payload => { const magic = Buffer.from('YENOBK1\n'), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(magic); const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]); return Buffer.concat([magic, iv, cipher.getAuthTag(), data]); };
  for (const tamper of [payload => { payload.state.autopilot.dailyAiLimit = 5; }, payload => { payload.state.jobs.find(job => job.autopilot).autopilot.kind = 'shell'; }]) {
    const altered = structuredClone(pristine); tamper(altered); const targetDir = path.join(app.root, `rejected-${randomUUID()}`);
    assert.throws(() => restoreBackup({ archive: reencrypt(altered), key, targetDir }), /autopilot|automatic|backup|invalid/i); assert.equal(fs.existsSync(targetDir), false);
  }
  const targetDir = path.join(app.root, 'restored'); restoreBackup({ archive: exported.bytes, key, targetDir }); key.fill(0);
  const restored = await app.restored(targetDir), freshOwner = 'synthetic-restored-autopilot-owner';
  const overview = await app.at(restored, '/api/autopilot', undefined, freshOwner); assert.equal(overview.status, 200); assert.equal(overview.json.enabled, false); assert.equal(restored.state().emergencyStop, true);
  assert.deepEqual(restored.state().jobs.filter(job => job.autopilot).map(job => ({ id: job.id, autopilot: job.autopilot })), jobs.map(job => ({ id: job.id, autopilot: job.autopilot })));
  for (const job of jobs) for (const file of job.artifacts) assert.deepEqual((await app.at(restored, `/api/artifacts/${file.id}`, undefined, freshOwner)).bytes, (await app.api(`/api/artifacts/${file.id}`)).bytes);
  await delay(250); assert.equal(modelCalls, 1);
});
