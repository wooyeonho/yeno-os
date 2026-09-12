import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { start } from '../server.mjs';
import { digest, openStore } from '../lib/store.mjs';
import { exportBackup, decryptBackup, restoreBackup } from '../lib/backup.mjs';
import { renderVideo, videoAvailability } from '../lib/video.mjs';

const owner = 'synthetic-production-api-owner-token';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const videoInput = () => ({ title: '휴대폰에서 만든 영상', scenes: [{ heading: '기록을 영상으로', body: '한글 문구를 실제 MP4 파일로 저장합니다.', seconds: 2 }] });
const available = await videoAvailability();
const withVideo = { skip: !available.available && process.env.YENO_VIDEO_TEST_REQUIRED !== '1', timeout: 60_000 };
const fakeResponse = content => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content, tool_calls: [] } }], usage: { prompt_tokens: 15, completion_tokens: 25 } }), { headers: { 'Content-Type': 'application/json' } });

async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-production-api-'));
  let core = await start({ host: '127.0.0.1', port: 0, dataDir: path.join(root, 'source'), token: owner, env: {}, ...options });
  const replacements = [];
  t.after(() => { core.shutdown(); for (const replacement of replacements) replacement.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const requestAt = async (runtime, route, body, credential = owner, extraHeaders = {}) => {
    const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'Content-Type': 'application/json', ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const bytes = Buffer.from(await response.arrayBuffer());
    let json; if (response.headers.get('content-type')?.includes('application/json')) json = JSON.parse(bytes.toString('utf8'));
    return { status: response.status, bytes, text: bytes.toString('utf8'), json, headers: response.headers };
  };
  const api = (...args) => requestAt(core, ...args);
  const post = (route, body) => api(route, { requestId: randomUUID(), ...body });
  const wait = async (id, states = ['completed', 'failed', 'paused']) => {
    for (let attempt = 0; attempt < 600; attempt++) { const job = core.state().jobs.find(job => job.id === id); if (job && states.includes(job.status)) return job; await sleep(25); }
    assert.fail(`Production job ${id} did not reach ${states.join('/')}`);
  };
  return { root, api, post, wait, requestAt, core: () => core,
    restart: async () => { const dataDir = core.dataDir; core.shutdown(); core = await start({ host: '127.0.0.1', port: 0, dataDir, token: owner, env: {}, ...options }); },
    restored: async targetDir => { const replacement = await start({ host: '127.0.0.1', port: 0, dataDir: targetDir, token: owner, env: {} }); replacements.push(replacement); return replacement; },
  };
}

test('HTTP production preserves real MP4, audit JSON, places and novel history across restart and encrypted clean restore', withVideo, async t => {
  assert.equal(available.available, true, available.reason);
  let renders = 0;
  const app = await fixture(t, { videoRender: async options => { renders++; return renderVideo(options); } });
  const enrollment = await app.post('/api/v1/devices/enroll', { name: 'synthetic-phone', platform: 'android' });
  assert.equal(enrollment.status, 201); const device = enrollment.json.device;
  const placeRequest = { requestId: randomUUID(), action: 'place.create', title: '보존할 장소', note: '본문 <script>는 원문으로 보관', coordinates: { latitude: 37.5, longitude: 127.0 } };
  const place = await app.post('/api/studio', placeRequest); assert.equal(place.status, 200);
  assert.deepEqual((await app.post('/api/studio', placeRequest)).json, place.json);
  const series = await app.post('/api/studio', { action: 'series.create', title: '블랙홀 기록 소설', premise: '기록을 되찾는 인물', characters: '서윤: 기록 보관자' });
  assert.equal(series.status, 200); const seriesId = series.json.result.id;
  const chapter = await app.post('/api/studio', { action: 'chapter.create', seriesId, number: 1, title: '첫 기록', content: '수정 전 원문\n그녀는 문을 열었다.' });
  assert.equal(chapter.status, 200); const chapterId = chapter.json.result.id;
  assert.equal((await app.post('/api/studio', { action: 'chapter.update', id: chapterId, expectedRevision: 1, content: '수정 후 원문\n그녀는 기록실의 문을 열었다.' })).status, 200);
  const videoRequest = { requestId: randomUUID(), kind: 'video', input: videoInput() };
  const submitted = await app.post('/api/production/run', videoRequest); assert.equal(submitted.status, 201);
  const video = await app.wait(submitted.json.job.id); assert.equal(video.status, 'completed', video.error);
  assert.equal(renders, 1); assert.equal(video.artifacts.length, 1);
  assert.equal((await app.post('/api/production/run', videoRequest)).json.job.id, video.id);
  assert.equal((await app.post('/api/production/run', { ...videoRequest, input: { ...videoInput(), title: '같은 요청의 다른 영상' } })).status, 409);
  assert.equal(app.core().state().jobs.length, 1); assert.equal(renders, 1);
  const videoRoute = `/api/artifacts/${video.artifacts[0].id}`;
  const mp4 = await app.api(videoRoute); assert.equal(mp4.status, 200); assert.equal(mp4.headers.get('content-type'), 'video/mp4');
  assert.equal(mp4.bytes.subarray(4, 8).toString('ascii'), 'ftyp'); assert.equal(digest(mp4.bytes), mp4.headers.get('x-content-sha256'));
  assert.equal((await app.api(videoRoute, undefined, null)).status, 401);
  const nativeMp4 = await app.api(`/api/v1/artifacts/${video.artifacts[0].id}`, undefined, device.deviceToken, { Origin: 'http://tauri.localhost' });
  assert.equal(nativeMp4.status, 200); assert.deepEqual(nativeMp4.bytes, mp4.bytes);
  const html = '<!doctype html><title>붙여넣은 시험 페이지</title><meta name="description" content="원문 구조 검사"><h1>안부 기록</h1><script>throw new Error("must never run")</script><img src="http://127.0.0.1:1/private">';
  const auditRequest = { requestId: randomUUID(), kind: 'forai', input: { mode: 'html', content: html, profile: { name: '시험 사이트', description: '소유자가 제공한 설명', siteUrl: 'https://example.com/' } } };
  const auditReceipt = await app.post('/api/production/run', auditRequest); assert.equal(auditReceipt.status, 201);
  const audit = await app.wait(auditReceipt.json.job.id); assert.equal(audit.status, 'completed', audit.error); assert.equal(audit.artifacts.length, 2);
  const files = new Map([[video.artifacts[0].id, mp4]]);
  let evidence;
  for (const artifact of audit.artifacts) { const file = await app.api(`/api/artifacts/${artifact.id}`); assert.equal(file.status, 200); assert.equal(digest(file.bytes), file.headers.get('x-content-sha256')); files.set(artifact.id, file); if (file.json) evidence = file.json; }
  assert.equal(evidence.mode, 'html'); assert.equal(evidence.source.readMethod, 'owner_paste'); assert.equal(evidence.source.sha256, digest(html));
  assert.equal(evidence.source.status, null); assert.equal(evidence.findings.find(item => item.code === 'ai_visibility').state, 'unknown');
  assert.equal(evidence.candidates.status, 'draft_from_owner_profile'); assert.equal(app.core().state().agent.usage.attempts, 0);
  const studioBefore = (await app.api('/api/studio')).json;
  assert.equal(studioBefore.counts.places, 1); assert.equal(studioBefore.chapters[0].history[0].content, '수정 전 원문\n그녀는 문을 열었다.');
  const exportBefore = await app.api(`/api/studio/export?kind=series&id=${seriesId}`);
  assert.equal(exportBefore.status, 200); assert.match(exportBefore.text, /수정 후 원문/);
  await app.restart();
  assert.equal((await app.post('/api/production/run', videoRequest)).json.job.id, video.id); assert.equal(renders, 1);
  assert.deepEqual((await app.api(videoRoute)).bytes, mp4.bytes);
  assert.deepEqual((await app.api('/api/studio')).json.chapters, studioBefore.chapters);
  const key = randomBytes(32), diskState = openStore(app.core().dataDir).state;
  const directArchive = exportBackup({ state: diskState, dataDir: app.core().dataDir, key });
  const decoded = decryptBackup(directArchive, key);
  assert.deepEqual(decoded.state.studio, diskState.studio); assert.equal(decoded.artifacts.length, 3);
  assert.ok(decoded.artifacts.some(file => file.filename.endsWith('.mp4'))); assert.ok(decoded.artifacts.some(file => file.filename.endsWith('.json')));
  const exported = await app.api('/api/backups/export', { encryptionKey: key.toString('hex') }); assert.equal(exported.status, 200);
  assert.equal(exported.bytes.includes(Buffer.from(key.toString('hex'))), false); assert.equal(exported.bytes.includes(Buffer.from(owner)), false);
  const damaged = Buffer.from(exported.bytes); damaged[damaged.length - 1] ^= 1;
  const rejectedTarget = path.join(app.root, 'damaged-copy');
  assert.throws(() => restoreBackup({ archive: damaged, key, targetDir: rejectedTarget }), /authentication failed/); assert.equal(fs.existsSync(rejectedTarget), false);
  const targetDir = path.join(app.root, 'restored'); restoreBackup({ archive: exported.bytes, key, targetDir });
  const replacement = await app.restored(targetDir); assert.equal(replacement.state().emergencyStop, true); assert.equal(replacement.state().modules.ai, false);
  for (const [id, expected] of files) { const actual = await app.requestAt(replacement, `/api/artifacts/${id}`); assert.equal(actual.status, 200); assert.deepEqual(actual.bytes, expected.bytes); assert.equal(actual.headers.get('content-type'), expected.headers.get('content-type')); }
  const replay = await app.requestAt(replacement, '/api/production/run', videoRequest); assert.equal(replay.status, 201); assert.equal(replay.json.job.id, video.id); assert.equal(replacement.state().jobs.filter(job => job.type === 'video').length, 1);
  assert.equal((await app.requestAt(replacement, '/api/v1/state', undefined, device.deviceToken)).status, 401);
  assert.deepEqual((await app.requestAt(replacement, '/api/studio')).json.chapters, studioBefore.chapters);
  assert.deepEqual((await app.requestAt(replacement, `/api/studio/export?kind=series&id=${seriesId}`)).bytes, exportBefore.bytes);
  assert.deepEqual(fs.readFileSync(path.join(targetDir, 'artifacts', decoded.state.artifacts[video.artifacts[0].id].filename)), mp4.bytes);
});

test('production HTTP rejects malformed or foreign inputs before accepting a job and protects studio writes', async t => {
  const app = await fixture(t);
  const bad = [
    { kind: 'video', input: { ...videoInput(), filename: '/tmp/private.mp4' } },
    { kind: 'video', input: { ...videoInput(), scenes: [{ heading: '제목', body: '본문', seconds: '2' }] } },
    { kind: 'video', input: videoInput(), outputPath: '/tmp/private.mp4' },
    { kind: 'forai', input: { mode: 'html', content: '<h1>test</h1>', command: 'unsafe' } },
    { kind: 'forai', input: { mode: 'url', url: 'http://127.0.0.1:8790/api/state' } },
    { kind: 'forai', input: { mode: 'url', url: 'file:///etc/passwd' } },
    { kind: 'unknown', input: {} },
  ];
  for (const input of bad) assert.equal((await app.post('/api/production/run', input)).status, 400);
  assert.equal((await app.api('/api/production/run', { kind: 'video', input: videoInput() })).status, 400);
  assert.equal(app.core().state().jobs.length, 0);
  assert.equal((await app.api('/api/studio', { action: 'place.create', title: 'forbidden', requestId: randomUUID() }, null)).status, 401);
  assert.equal((await app.api('/api/studio', { action: 'place.create', title: 'forbidden', requestId: randomUUID() }, owner, { Origin: 'https://untrusted.invalid' })).status, 403);
  assert.equal((await app.post('/api/studio', { action: 'series.create', title: '원본', externalPublishing: true })).status, 400);
  assert.equal((await app.api('/api/studio')).json.counts.series, 0);
  const saved = await app.post('/api/studio', { action: 'place.create', title: '유지할 장소' });
  const edit = { requestId: randomUUID(), action: 'place.update', id: saved.json.result.id, expectedRevision: 1, note: '첫 수정' };
  assert.equal((await app.post('/api/studio', edit)).status, 200);
  assert.equal((await app.post('/api/studio', { ...edit, requestId: randomUUID(), note: '오래된 화면의 덮어쓰기' })).status, 409);
  assert.equal((await app.api('/api/studio')).json.places[0].note, '첫 수정');
});

test('global stop discards a late video result and does not resume the job when the latch is released', { timeout: 15_000 }, async t => {
  let begin, finish, sawAbort = false, calls = 0;
  const began = new Promise(resolve => { begin = resolve; }), finishGate = new Promise(resolve => { finish = resolve; });
  const app = await fixture(t, { videoRender: async ({ outputPath, signal }) => {
    calls++; signal.addEventListener('abort', () => { sawAbort = true; }, { once: true }); begin(); await finishGate;
    const content = Buffer.from('synthetic late renderer bytes'); fs.writeFileSync(outputPath, content, { flag: 'wx' }); return { bytes: content.length, sha256: digest(content) };
  } });
  const request = { requestId: randomUUID(), kind: 'video', input: videoInput() };
  const created = await app.post('/api/production/run', request); assert.equal(created.status, 201); await began;
  assert.equal((await app.post('/api/control', { action: 'stop' })).status, 200); assert.equal(sawAbort, true);
  assert.equal((await app.wait(created.json.job.id, ['paused'])).artifacts.length, 0);
  finish();
  for (let index = 0; index < 40; index++) { await sleep(20); if (fs.readdirSync(path.join(app.core().dataDir, 'artifacts')).length === 0) break; }
  assert.deepEqual(fs.readdirSync(path.join(app.core().dataDir, 'artifacts')), []);
  assert.equal((await app.post('/api/control', { action: 'resume' })).status, 200); await sleep(350);
  assert.equal(app.core().state().jobs[0].status, 'paused'); assert.equal(calls, 1);
  await app.restart(); assert.equal(app.core().state().jobs[0].status, 'paused'); assert.equal(app.core().state().jobs[0].artifacts.length, 0);
  assert.equal((await app.post('/api/production/run', request)).json.job.id, created.json.job.id); assert.equal(calls, 1);
});

test('SIGKILL during video work leaves the durable job paused after a fresh process restart', { timeout: 20_000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-production-crash-')), dataDir = path.join(root, 'source');
  const serverUrl = new URL('../server.mjs', import.meta.url).href;
  const script = `import {start} from ${JSON.stringify(serverUrl)}; const core=await start({host:'127.0.0.1',port:0,dataDir:${JSON.stringify(dataDir)},token:${JSON.stringify(owner)},env:{},videoRender:async()=>{process.send({phase:'rendering'});return new Promise(()=>{});}});process.send({phase:'ready',port:core.server.address().port});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { PATH: process.env.PATH } });
  let replacement;
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); } replacement?.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const ready = await once(child, 'message'); assert.equal(ready[0].phase, 'ready');
  const rendering = once(child, 'message');
  const request = { requestId: randomUUID(), kind: 'video', input: videoInput() };
  const response = await fetch(`http://127.0.0.1:${ready[0].port}/api/production/run`, { method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(response.status, 201); const accepted = await response.json(); assert.equal((await rendering)[0].phase, 'rendering');
  const crashedState = openStore(dataDir).state; assert.equal(crashedState.jobs[0].status, 'running'); assert.equal(crashedState.jobs[0].step, 1);
  child.kill('SIGKILL'); await once(child, 'exit');
  let reruns = 0; replacement = await start({ host: '127.0.0.1', port: 0, dataDir, token: owner, env: {}, videoRender: async () => { reruns++; throw new Error('must stay paused'); } });
  const recovered = replacement.state().jobs.find(job => job.id === accepted.job.id); assert.equal(recovered.status, 'paused'); assert.equal(recovered.pauseReason, 'restart'); assert.equal(recovered.artifacts.length, 0);
  await sleep(350); assert.equal(reruns, 0);
  const replay = await fetch(`http://127.0.0.1:${replacement.server.address().port}/api/production/run`, { method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(replay.status, 201); assert.equal((await replay.json()).job.id, accepted.job.id); assert.equal(reruns, 0); assert.equal(replacement.state().jobs.length, 1);
});

test('novel HTTP import uses a verified generated artifact and preserves originals on conflicting retries', { timeout: 15_000 }, async t => {
  let calls = 0, sentPrompt = '';
  const manuscript = '**기록이 켜지는 밤**\n\n서윤은 빈 기록장을 펼쳤다. 사라졌던 이름이 첫 줄에 떠올랐다.';
  // Reproduces the live provider shape: standalone delimiters around the real
  // manuscript, followed by inline quoted delimiter names in a self-checklist.
  const providerOutput = `## 완성 원고\n\n<!-- BLACKHOLE_CHAPTER_START -->\n${manuscript}\n<!-- BLACKHOLE_CHAPTER_END -->\n\n## 성공 조건 점검\n- 원고 앞의 \`<!-- BLACKHOLE_CHAPTER_START -->\`와 뒤의 \`<!-- BLACKHOLE_CHAPTER_END -->\` 표식을 포함했습니다.\n- 위 체크리스트는 원고 본문에 포함하지 않습니다.`;
  const app = await fixture(t, { env: { YENO_AGENT_PROVIDER: 'openai', YENO_AGENT_DAILY_CALL_LIMIT: '4', YENO_OPENAI_API_KEY: 'synthetic-key-only', YENO_OPENAI_MODEL: 'synthetic-model' }, agentFetch: async (_url, request) => { calls++; sentPrompt = request.body; return fakeResponse(providerOutput); } });
  const series = await app.post('/api/studio', { action: 'series.create', title: '테스트 연재', premise: '기록실의 이름을 찾는다.' }); const seriesId = series.json.result.id;
  const original = await app.post('/api/studio', { action: 'chapter.create', seriesId, number: 1, title: '소유자 원문', content: '절대로 덮어쓰면 안 되는 기존 원고' });
  const generation = { requestId: randomUUID(), seriesId, instructions: '다음 회차의 짧은 완결 장면을 써 주세요.' };
  const created = await app.post('/api/studio/generate', generation); assert.equal(created.status, 201);
  const completed = await app.wait(created.json.job.id); assert.equal(completed.status, 'completed', completed.error); assert.equal(calls, 1);
  assert.match(sentPrompt, /절대로 덮어쓰면 안 되는 기존 원고/, 'continuation receives the latest existing chapter ending');
  assert.equal((await app.post('/api/studio/generate', generation)).json.job.id, completed.id); assert.equal(calls, 1);
  const importRequest = { requestId: randomUUID(), seriesId, jobId: completed.id, number: 2, title: '되찾은 이름' };
  const otherSeries = await app.post('/api/studio', { action: 'series.create', title: '별도 작품' });
  assert.equal((await app.post('/api/studio/import', { ...importRequest, requestId: randomUUID(), seriesId: otherSeries.json.result.id })).status, 409);
  const imported = await app.post('/api/studio/import', importRequest); assert.equal(imported.status, 200);
  assert.deepEqual((await app.post('/api/studio/import', importRequest)).json, imported.json);
  assert.equal((await app.post('/api/studio/import', { ...importRequest, requestId: randomUUID(), number: 1 })).status, 409);
  const chapters = (await app.api('/api/studio')).json.chapters; assert.equal(chapters.length, 2); assert.equal(chapters.find(chapter => chapter.id === original.json.result.id).content, '절대로 덮어쓰면 안 되는 기존 원고');
  assert.equal(chapters.find(chapter => chapter.id === imported.json.result.id).content, manuscript, 'only the standalone-delimited manuscript is imported, excluding the provider self-checklist');
  const metadata = openStore(app.core().dataDir).state.artifacts[completed.artifacts[0].id]; fs.writeFileSync(path.join(app.core().dataDir, 'artifacts', metadata.filename), 'corrupted after completion');
  assert.equal((await app.post('/api/studio/import', { ...importRequest, requestId: randomUUID(), number: 3 })).status, 409);
  assert.equal((await app.api('/api/studio')).json.chapters.length, 2); assert.equal(calls, 1);
});

test('novel import rejects multiple standalone manuscript blocks without adding a chapter or changing the original', { timeout: 15_000 }, async t => {
  let calls = 0;
  const ambiguous = '<!-- BLACKHOLE_CHAPTER_START -->\n첫 번째 별도 원고입니다.\n<!-- BLACKHOLE_CHAPTER_END -->\n\n<!-- BLACKHOLE_CHAPTER_START -->\n두 번째 별도 원고입니다.\n<!-- BLACKHOLE_CHAPTER_END -->';
  const app = await fixture(t, { env: { YENO_AGENT_PROVIDER: 'openai', YENO_AGENT_DAILY_CALL_LIMIT: '4', YENO_OPENAI_API_KEY: 'synthetic-key-only', YENO_OPENAI_MODEL: 'synthetic-model' }, agentFetch: async () => { calls++; return fakeResponse(ambiguous); } });
  const series = await app.post('/api/studio', { action: 'series.create', title: '다중 원고 구간 검사' }), seriesId = series.json.result.id;
  const original = await app.post('/api/studio', { action: 'chapter.create', seriesId, number: 1, title: '기존 원고', content: '이 원고는 변경하지 않습니다.' });
  const before = (await app.api('/api/studio')).json.chapters;
  const generation = { requestId: randomUUID(), seriesId, instructions: '다음 원고를 작성하세요.' };
  const created = await app.post('/api/studio/generate', generation); assert.equal(created.status, 201);
  const completed = await app.wait(created.json.job.id); assert.equal(completed.status, 'completed', completed.error); assert.equal(calls, 1);
  const importBody = { requestId: randomUUID(), seriesId, jobId: completed.id, number: 2, title: '모호한 원고' };
  assert.equal((await app.post('/api/studio/import', importBody)).status, 409);
  assert.equal((await app.post('/api/studio/import', importBody)).status, 409);
  assert.deepEqual((await app.api('/api/studio')).json.chapters, before);
  assert.equal(before[0].id, original.json.result.id);
  assert.equal((await app.post('/api/studio/generate', generation)).json.job.id, completed.id); assert.equal(calls, 1);
});

test('a renderer result with an invalid hash fails without registering or leaking an orphan video', { timeout: 10_000 }, async t => {
  const app = await fixture(t, { videoRender: async ({ outputPath }) => { const content = Buffer.from('synthetic invalid-hash bytes'); fs.writeFileSync(outputPath, content, { flag: 'wx' }); return { bytes: content.length, sha256: digest('other bytes') }; } });
  const created = await app.post('/api/production/run', { kind: 'video', input: videoInput() });
  assert.equal(created.status, 201); const job = await app.wait(created.json.job.id); assert.equal(job.status, 'failed'); assert.equal(job.artifacts.length, 0);
  assert.deepEqual(Object.keys(openStore(app.core().dataDir).state.artifacts), []);
  assert.deepEqual(fs.readdirSync(path.join(app.core().dataDir, 'artifacts')), [], 'invalid render must not leave an unreachable UUID.mp4 consuming the owner volume');
});
