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

const owner = 'synthetic-research-owner-token';
const env = { YENO_AGENT_PROVIDER: 'auto', YENO_AGENT_DAILY_CALL_LIMIT: '4', YENO_OPENAI_API_KEY: 'synthetic-research-provider-key', YENO_OPENAI_MODEL: 'synthetic-research-model' };
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const modelResponse = () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '합성 검증용 답변: 현재 근거 [S1]로 가설을 제안하며 실제 해결을 증명하지 않았습니다.', tool_calls: [] } }], usage: { prompt_tokens: 80, completion_tokens: 35 } });
const question = '항생제 내성을 낮출 수 있는 검증 가능한 가설과 실험은 무엇인가?';
const request = (extra = {}) => ({ requestId: randomUUID(), question, query: 'antimicrobial resistance surveillance', projectId: null, provider: 'auto', ...extra });
const europeRecord = { id: '12345678', source: 'MED', pmid: '12345678', title: 'Synthetic antimicrobial surveillance study', authorString: 'Synthetic A, Synthetic B', pubYear: '2025', firstPublicationDate: '2025-02-01', abstractText: 'Synthetic observational data report an association. The design cannot establish causation.', doi: '10.1000/synthetic-surveillance', journalInfo: { journal: { title: 'Synthetic Evidence Journal' } }, pubTypeList: { pubType: ['Journal Article'] }, isOpenAccess: 'Y', isRetracted: 'N' };
const crossrefRecord = { DOI: '10.1000/synthetic-intervention', title: ['Synthetic antimicrobial intervention study'], type: 'journal-article', publisher: 'Synthetic Publisher', author: [{ given: 'Synthetic', family: 'Researcher' }], 'container-title': ['Synthetic Research Journal'], published: { 'date-parts': [[2024, 5, 2]] }, abstract: '<jats:p>A synthetic trial reports uncertainty and requires replication.</jats:p>', URL: 'https://doi.org/10.1000/synthetic-intervention' };

function publicResponse(url) {
  const parsed = new URL(url);
  assert.ok(['www.ebi.ac.uk', 'api.crossref.org'].includes(parsed.hostname), `unexpected evidence host ${parsed.hostname}`);
  if (parsed.hostname === 'api.crossref.org') return jsonResponse({ status: 'ok', 'message-type': 'work-list', message: { 'total-results': 1, items: [crossrefRecord] } });
  return jsonResponse({ version: '6.9', hitCount: 1, resultList: { result: [europeRecord] } });
}

async function fixture(t, options = {}, projects = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-research-api-'));
  const dataDir = path.join(root, 'source');
  if (projects.length) { const store = openStore(dataDir); store.state.projects.push(...projects); store.save(); }
  const config = { host: '127.0.0.1', port: 0, dataDir, token: owner, env, researchFetch: async url => publicResponse(url), agentFetch: async () => modelResponse(), ...options };
  let core = await start(config);
  const replacements = [];
  t.after(() => { core.shutdown(); for (const replacement of replacements) replacement.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const at = async (runtime, route, body, token = owner, extraHeaders = {}) => {
    const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, bytes, text: bytes.toString('utf8'), json: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : undefined, headers: response.headers };
  };
  const api = (...args) => at(core, ...args);
  const post = (route, body) => api(route, { requestId: randomUUID(), ...body });
  const wait = async (id, statuses = ['completed', 'failed', 'paused']) => {
    for (let i = 0; i < 300; i++) { const job = core.state().jobs.find(item => item.id === id); if (job && statuses.includes(job.status)) return openStore(dataDir).state.jobs.find(item => item.id === id); await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.fail(`Research job ${id} did not reach ${statuses.join('/')}`);
  };
  return { root, dataDir, api, post, wait, at, core: () => core,
    restart: async () => { core.shutdown(); core = await start(config); },
    restored: async targetDir => { const replacement = await start({ ...config, dataDir: targetDir, token: 'fresh-restored-research-owner' }); replacements.push(replacement); return replacement; },
  };
}

async function completedResearch(app, body = request()) {
  const accepted = await app.api('/api/research/run', body);
  assert.equal(accepted.status, 201, accepted.text);
  assert.equal(accepted.json.kind, 'job');
  const job = await app.wait(accepted.json.job.id);
  assert.equal(job.status, 'completed', job.error);
  return { accepted, job, body };
}

test('research stores evidence before one tool-free model call; native reads, replay and restart preserve exact results', async t => {
  let app, modelCalls = 0, evidenceCalls = 0;
  app = await fixture(t, {
    researchFetch: async (url, init) => { evidenceCalls++; assert.equal(init?.redirect, 'error'); return publicResponse(url); },
    agentFetch: async (url, init) => {
      modelCalls++;
      const stored = openStore(app.dataDir).state, job = stored.jobs.find(item => item.researchRequest);
      assert.ok(job?.researchEvidenceId, 'the manifest must be durable before provider reservation');
      assert.ok(job.artifacts.length >= 3, 'both raw responses and the manifest precede AI');
      for (const artifact of job.artifacts) { const meta = stored.artifacts[artifact.id]; assert.equal(digest(fs.readFileSync(path.join(app.dataDir, 'artifacts', meta.filename))), meta.sha256); }
      const body = JSON.parse(init.body);
      assert.ok(!body.tools?.length, 'research cannot turn a single call into further tool rounds');
      assert.match(JSON.stringify(body.messages), /Synthetic antimicrobial surveillance study/);
      assert.match(JSON.stringify(body.messages), /cannot establish causation/);
      assert.ok(!JSON.stringify(body.messages).includes(owner));
      return modelResponse();
    },
  });
  const { accepted, job, body } = await completedResearch(app);
  assert.equal(job.callLimit, 1); assert.equal(job.questId, accepted.json.quest.id);
  assert.equal(job.researchRequest.question, question); assert.equal(job.researchRequest.projectId, null);
  assert.equal(job.agentJournal.calls.length, 1); assert.equal(job.agentJournal.calls[0].status, 'settled');
  assert.equal(modelCalls, 1); assert.equal(evidenceCalls, 2);
  const resultArtifact = job.artifacts.findLast(item => item.name.endsWith('.md'));
  assert.ok(resultArtifact, 'a complete answer is downloadable');
  const answer = await app.api(`/api/artifacts/${resultArtifact.id}`);
  assert.equal(answer.status, 200); assert.equal(digest(answer.bytes), answer.headers.get('x-content-sha256'));
  assert.match(answer.text, /합성 검증용 답변/); assert.match(answer.text, /https:\/\/(?:europepmc\.org|doi\.org)\//);
  const enrolled = await app.post('/api/v1/devices/enroll', { name: 'synthetic-research-phone', platform: 'android' });
  assert.equal(enrolled.status, 201);
  const native = await app.api(`/api/v1/artifacts/${resultArtifact.id}`, undefined, enrolled.json.device.deviceToken, { Origin: 'http://tauri.localhost' });
  assert.equal(native.status, 200); assert.deepEqual(native.bytes, answer.bytes);
  assert.equal((await app.api(`/api/artifacts/${resultArtifact.id}`, undefined, null)).status, 401);
  assert.equal((await app.api('/api/research/run', body)).json.job.id, job.id);
  assert.equal((await app.api('/api/research/run', { ...body, question: '다른 질문' })).status, 409);
  await app.restart();
  assert.equal((await app.api('/api/research/run', body)).json.job.id, job.id);
  const listing = await app.api('/api/research');
  assert.equal(listing.status, 200); assert.equal(listing.json.jobs.length, 1);
  assert.equal(listing.json.usage.attempts, 1); assert.equal(listing.json.dailyCallLimit, 4); assert.equal(listing.json.providerReady, true);
  assert.ok(!JSON.stringify(listing.json).includes('synthetic-research-provider-key'));
  assert.deepEqual((await app.api(`/api/artifacts/${resultArtifact.id}`)).bytes, answer.bytes);
  assert.equal(modelCalls, 1); assert.equal(evidenceCalls, 2);
});

test('research accepts registered canonical tracks only and rejects invalid, unauthorized or unconfigured work before fetching', async t => {
  const stamp = '2026-09-12T00:00:00.000Z';
  const track = RESEARCH_TRACKS.find(item => item.code === 'E01'), archivedTrack = RESEARCH_TRACKS.find(item => item.code === 'E02');
  const project = { id: track.projectId, name: track.name, repositoryUrl: '', summary: '합성 테스트 연구 범위', nextAction: '근거 비교', status: 'active', version: 1, createdAt: stamp, updatedAt: stamp };
  const archived = { ...project, id: archivedTrack.projectId, name: archivedTrack.name, status: 'archived' };
  const impostor = { ...project, id: randomUUID(), name: 'E03 연구로 가장한 임의 프로젝트' };
  let evidenceCalls = 0, modelCalls = 0;
  const app = await fixture(t, { researchFetch: async url => { evidenceCalls++; return publicResponse(url); }, agentFetch: async () => { modelCalls++; return modelResponse(); } }, [project, archived, impostor]);
  assert.equal((await app.api('/api/research', undefined, null)).status, 401);
  assert.equal((await app.api('/api/research/run', request(), null)).status, 401);
  const listing = (await app.api('/api/research')).json;
  assert.equal(listing.tracks.length, 1, 'archived and noncanonical registry rows are unavailable');
  assert.equal(JSON.stringify(listing.tracks).includes(project.id), true);
  const invalid = [request({ question: '' }), request({ question: 'q'.repeat(2001) }), request({ query: 'x'.repeat(301) }), request({ projectId: impostor.id }), request({ projectId: archived.id }), request({ provider: 'arbitrary-provider' }), request({ maxCalls: 4 }), request({ autoRun: true })];
  for (const body of invalid) { const result = await app.api('/api/research/run', body); assert.ok([400, 404, 409].includes(result.status), `invalid request accepted: ${JSON.stringify(body)}`); }
  assert.equal((await app.api('/api/research/run', { question, query: 'AMR', provider: 'auto' })).status, 400);
  assert.equal(evidenceCalls, 0); assert.equal(modelCalls, 0); assert.equal(app.core().state().jobs.length, 0);
  const { job } = await completedResearch(app, request({ projectId: project.id }));
  assert.equal(job.projectId, project.id); assert.equal(job.researchRequest.trackCode, 'E01');
  const unavailable = await fixture(t, { env: {}, researchFetch: async () => { assert.fail('unconfigured request fetched evidence'); }, agentFetch: async () => { assert.fail('unconfigured request called a model'); } });
  assert.equal((await unavailable.api('/api/research')).json.providerReady, false);
  assert.equal((await unavailable.api('/api/research/run', request())).status, 409);
  assert.equal(unavailable.core().state().jobs.length, 0);
});

test('partial evidence keeps warnings; zero usable sources leaves a failed auditable bundle and never calls AI', async t => {
  let modelCalls = 0;
  const app = await fixture(t, {
    researchFetch: async url => {
      const parsed = new URL(url), empty = [...parsed.searchParams.values()].some(value => value.includes('no-evidence'));
      if (parsed.hostname === 'api.crossref.org') return new Response('synthetic unavailable', { status: 503 });
      if (empty) return jsonResponse({ hitCount: 0, resultList: { result: [] } });
      return publicResponse(url);
    },
    agentFetch: async () => { modelCalls++; return modelResponse(); },
  });
  const { job } = await completedResearch(app);
  const manifest = await app.api(`/api/artifacts/${job.researchEvidenceId}`);
  assert.equal(manifest.status, 200); assert.ok(manifest.json.searches.some(search => search.status === 'error' && search.error?.code));
  assert.equal(modelCalls, 1);
  const empty = await app.api('/api/research/run', request({ query: 'no-evidence' })); assert.equal(empty.status, 201);
  const failed = await app.wait(empty.json.job.id);
  assert.equal(failed.status, 'failed'); assert.ok(failed.researchEvidenceId);
  const emptyManifest = await app.api(`/api/artifacts/${failed.researchEvidenceId}`);
  assert.equal(emptyManifest.status, 200); assert.equal(emptyManifest.json.sources.length, 0);
  assert.equal(failed.agentJournal?.calls.length ?? 0, 0); assert.equal(modelCalls, 1);
  await app.restart(); assert.equal(modelCalls, 1); assert.equal(app.core().state().jobs.find(item => item.id === failed.id).status, 'failed');
});

test('global stop aborts active evidence collection before any paid call and release does not resume it', { timeout: 10_000 }, async t => {
  let began, evidenceCalls = 0, aborts = 0, modelCalls = 0;
  const beginning = new Promise(resolve => { began = resolve; });
  const app = await fixture(t, {
    researchFetch: async (url, init) => {
      evidenceCalls++; began();
      return new Promise((resolve, reject) => {
        const abort = () => { aborts++; reject(new DOMException('synthetic evidence stop', 'AbortError')); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
      });
    },
    agentFetch: async () => { modelCalls++; return modelResponse(); },
  });
  const accepted = await app.api('/api/research/run', request()); assert.equal(accepted.status, 201); await beginning;
  assert.equal((await app.post('/api/control', { action: 'stop' })).status, 200);
  const stopped = await app.wait(accepted.json.job.id, ['paused']);
  for (let i = 0; i < 50 && aborts < evidenceCalls; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(aborts >= 1); assert.equal(modelCalls, 0); assert.equal(stopped.agentJournal?.calls.length ?? 0, 0);
  assert.equal((await app.post('/api/control', { action: 'resume' })).status, 200);
  await app.restart();
  assert.equal(app.core().state().jobs.find(item => item.id === stopped.id).status, 'paused'); assert.equal(modelCalls, 0);
});

test('encrypted clean restore retains research requests and exact evidence bytes; altered artifact pointers fail validation', async t => {
  let modelCalls = 0, evidenceCalls = 0;
  const app = await fixture(t, { researchFetch: async url => { evidenceCalls++; return publicResponse(url); }, agentFetch: async () => { modelCalls++; return modelResponse(); } });
  const { job, body } = await completedResearch(app);
  const originals = new Map();
  for (const artifact of job.artifacts) originals.set(artifact.id, (await app.api(`/api/artifacts/${artifact.id}`)).bytes);
  const key = randomBytes(32), exported = await app.api('/api/backups/export', { encryptionKey: key.toString('hex') });
  assert.equal(exported.status, 200, exported.text.slice(0, 200));
  const pristine = decryptBackup(exported.bytes, key);
  assert.deepEqual(pristine.state.jobs.find(item => item.id === job.id).researchRequest, job.researchRequest);
  const reencrypt = payload => {
    const iv = randomBytes(12), magic = Buffer.from('YENOBK1\n'), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(magic); const content = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
    return Buffer.concat([magic, iv, cipher.getAuthTag(), content]);
  };
  for (const pointer of [randomUUID(), job.artifacts.find(item => item.id !== job.researchEvidenceId).id]) {
    const altered = structuredClone(pristine), targetDir = path.join(app.root, `rejected-${randomUUID()}`);
    altered.state.jobs.find(item => item.id === job.id).researchEvidenceId = pointer;
    assert.throws(() => restoreBackup({ archive: reencrypt(altered), key, targetDir }), /research|artifact|evidence|manifest/i);
    assert.equal(fs.existsSync(targetDir), false);
  }
  const targetDir = path.join(app.root, 'restored'); restoreBackup({ archive: exported.bytes, key, targetDir }); key.fill(0);
  const restored = await app.restored(targetDir), newOwner = 'fresh-restored-research-owner';
  assert.equal(restored.state().emergencyStop, true); assert.equal(restored.state().modules.ai, false);
  const replay = await app.at(restored, '/api/research/run', body, newOwner); assert.equal(replay.status, 201); assert.equal(replay.json.job.id, job.id);
  for (const [id, bytes] of originals) assert.deepEqual((await app.at(restored, `/api/artifacts/${id}`, undefined, newOwner)).bytes, bytes);
  assert.equal(evidenceCalls, 2); assert.equal(modelCalls, 1);
});

test('invented citations fail closed, preserve paid-call evidence and budget exhaustion still permits exact replay', async t => {
  let modelCalls = 0, evidenceCalls = 0;
  const app = await fixture(t, {
    env: { ...env, YENO_AGENT_DAILY_CALL_LIMIT: '1' },
    researchFetch: async url => { evidenceCalls++; return publicResponse(url); },
    agentFetch: async () => { modelCalls++; return jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '존재하지 않는 문헌 [S99]에서 해결을 주장했다.', tool_calls: [] } }], usage: { prompt_tokens: 50, completion_tokens: 15 } }); },
  });
  const body = request(), accepted = await app.api('/api/research/run', body); assert.equal(accepted.status, 201);
  const failed = await app.wait(accepted.json.job.id);
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /citation/);
  assert.equal(failed.agentJournal.calls.length, 1); assert.equal(failed.agentJournal.calls[0].status, 'settled');
  assert.ok(failed.researchEvidenceId); assert.ok(!failed.artifacts.some(artifact => artifact.name.startsWith('research-answer-')));
  assert.equal((await app.api('/api/artifacts/' + failed.researchEvidenceId)).status, 200);
  assert.equal((await app.api('/api/research/run', request())).status, 409);
  await app.restart();
  const replay = await app.api('/api/research/run', body); assert.equal(replay.status, 201); assert.equal(replay.json.job.id, failed.id);
  assert.equal((await app.api('/api/research')).json.usage.attempts, 1);
  assert.equal(evidenceCalls, 2); assert.equal(modelCalls, 1);
});
