import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, initialState, openStore } from '../lib/store.mjs';
import { sourceUrl, sourceRegistryDocument, sourceBriefDocument, resolveSource } from '../lib/sources.mjs';
import { sourceMatches } from '../public/source-reference-labels.mjs';
import fs from 'node:fs';
import { start as startServer } from '../server.mjs';

const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
const TOKEN = 'source-integration-synthetic-token';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const envelope = value => { const payload = JSON.stringify(value); return JSON.stringify({ format: 1, sha256: digest(payload), payload }); };
const sourceInput = (overrides = {}) => ({ url: 'https://example.com/guide', title: '검토할 공식 문서', ...overrides });
const reviewed = { readingStatus: 'read', decision: 'candidate', summary: '관련 절을 직접 읽고 확인한 내용.', application: '격리된 사본에서 작은 구현과 비교 검사를 준비한다.', riskNotes: '원문 재배포 없이 출처를 남긴다. 운영 적용 전 이용 조건을 다시 확인한다.' };

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'yeno-source-http-'));
  let child, base, logs = '';
  async function stop(signal = 'SIGTERM') {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const target = child;
    const ended = new Promise(resolve => target.once('exit', resolve));
    target.kill(signal);
    const timer = setTimeout(() => target.kill('SIGKILL'), 1500);
    await ended;
    clearTimeout(timer);
  }
  async function start() {
    logs = '';
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: runtimeRoot,
      env: { ...process.env, YENO_HOST: '127.0.0.1', YENO_PORT: '0', YENO_DATA_DIR: dir, YENO_TOKEN: TOKEN, YENO_AI_BASE_URL: '', YENO_AI_MODEL: '', YENO_AI_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Source fixture exited: ${logs}`);
      const ready = logs.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/);
      if (ready) { base = ready[1]; return; }
      await delay(30);
    }
    throw new Error(`Source fixture failed to start: ${logs}`);
  }
  async function api(route, { method = 'GET', body, token = TOKEN } = {}) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    return { status: response.status, body: value, headers: response.headers };
  }
  const post = (route, body, token) => api(route, { method: 'POST', body, ...(token === undefined ? {} : { token }) });
  async function state() {
    const response = await api('/api/state');
    assert.equal(response.status, 200);
    return response.body;
  }
  async function eventually(read, predicate) {
    let value;
    for (let attempt = 0; attempt < 200; attempt++) {
      value = await read();
      if (predicate(value)) return value;
      await delay(30);
    }
    assert.fail(`Source condition timed out: ${JSON.stringify(value)}`);
  }
  const job = async id => (await state()).jobs.find(item => item.id === id);
  const completed = id => eventually(() => job(id), item => item?.status === 'completed');
  async function source(fields = {}) {
    const response = await post('/api/sources', { ...sourceInput(fields), requestId: randomUUID() });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.source;
  }
  async function rejected(route, body, status = 400, token) {
    const before = await readFile(path.join(dir, 'state.json'), 'utf8');
    const response = await post(route, body, token);
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(await readFile(path.join(dir, 'state.json'), 'utf8'), before, 'rejection must preserve persisted rows, events, revision and request receipts');
    return response;
  }
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  await start();
  return { dir, api, post, state, start, stop, eventually, job, completed, source, rejected };
}

test('source migration preserves legacy records and rejects corrupt registries without silently clearing them', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yeno-source-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const legacy = initialState();
  delete legacy.sources;
  delete legacy.requestLedger;
  Object.assign(legacy, {
    revision: 37, emergencyStop: true,
    memories: [{ id: randomUUID(), text: '남겨야 할 기억' }],
    jobs: [{ id: randomUUID(), status: 'completed', artifacts: [{ id: 'retained-result' }] }],
    requests: { existing: { hash: digest('kept'), status: 201, payload: { job: { id: 'prior-job' } } } },
    artifacts: { 'retained-result': { sha256: 'previous-hash', filename: 'original.md' } },
    devices: { retained: { tokenHash: 'device-hash', revokedAt: null } },
  });
  const filename = path.join(dir, 'state.json');
  await writeFile(filename, envelope(legacy));
  const opened = openStore(dir);
  const requestLedger = { existing: { hash: digest('kept'), status: 201 } };
  assert.deepEqual(opened.state, { ...legacy, requestLedger, sources: [] });
  const registered = {
    id: randomUUID(), ...sourceInput(), canonicalUrl: 'https://example.com/guide',
    projectId: null, ...reviewed, version: 2,
    createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T01:00:00.000Z',
  };
  opened.state.sources.push(registered);
  opened.save();
  // save() runs the event-driven Living Core heartbeat, so blackholeCore
  // advances (heartbeatCount/lastHeartbeatAt/heartbeatLog) independently of
  // this migration; compare against the real post-heartbeat value.
  assert.deepEqual(openStore(dir).state, { ...legacy, requestLedger, revision: 38, sources: [registered], blackholeCore: opened.state.blackholeCore });
  for (const sources of [
    null, {}, [null], [{ ...registered, summary: null }], [{ ...registered, extra: true }],
    [{ ...registered, id: 'not-an-id' }], [{ ...registered, version: 0 }],
    [{ ...registered, readingStatus: 'partial' }], [{ ...registered, riskNotes: '' }],
    [{ ...registered, decision: 'deployed' }], [{ ...registered, projectId: randomUUID() }],
    [{ ...registered, canonicalUrl: 'https://example.com/different' }],
    [{ ...registered, createdAt: '2026-02-30T00:00:00.000Z' }],
    [{ ...registered, updatedAt: '2026-09-08T00:00:00.000Z' }],
    [registered, { ...registered, id: randomUUID() }],
  ]) {
    const invalid = envelope({ ...legacy, sources });
    await writeFile(filename, invalid);
    await writeFile(`${filename}.bak`, invalid);
    assert.throws(() => openStore(dir), /Original data has been preserved/);
    assert.equal(await readFile(filename, 'utf8'), invalid);
    assert.equal(await readFile(`${filename}.bak`, 'utf8'), invalid);
  }
  await writeFile(`${filename}.bak`, envelope({ ...legacy, sources: [registered] }));
  const recovered = openStore(dir);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.state.sources, [registered]);
  assert.deepEqual(recovered.state.memories, legacy.memories);
});

test('source URLs retain their original form, normalize social tracking, and reject local or credential-bearing links', () => {
  const original = 'https://www.instagram.com/p/ExamplePost/?utm_source=share&img_index=4&stkn=synthetic';
  assert.deepEqual(sourceUrl(` ${original} `), { url: original, canonicalUrl: 'https://instagram.com/p/ExamplePost?img_index=4' });
  assert.equal(sourceUrl('https://mobile.twitter.com/example/status/123/?igsh=tracking').canonicalUrl, 'https://x.com/example/status/123');
  assert.equal(sourceUrl('https://docs.example.com/guide?b=2&a=1#recovery').canonicalUrl, 'https://docs.example.com/guide?a=1&b=2#recovery');
  assert.notEqual(sourceUrl('https://instagram.com/p/ExamplePost?img_index=4').canonicalUrl, sourceUrl('https://instagram.com/p/ExamplePost?img_index=1').canonicalUrl, 'specific carousel pages are meaningful');
  for (const url of [
    'http://example.com/guide', 'https://user:pass@example.com/guide', 'https://example.com:8443/guide',
    'https://localhost/guide', 'https://server.local/guide', 'https://server.internal/guide',
    'https://host.home.arpa/guide', 'https://127.0.0.1/guide', 'https://0x7f000001/guide',
    'https://2130706433/guide', 'https://[::1]/guide', 'https://[::ffff:127.0.0.1]/guide',
    'https://example.com/white space', 'https://example.com\\private',
    'https://example.com/guide?access_token=synthetic', 'https://example.com/guide?key=synthetic',
    'https://example.com/guide?%2574oken=synthetic', 'https://example.com/guide#access_token=synthetic',
    'https://example.com/guide#/callback?code=synthetic',
    'https://example.com/guide#access_token=synthetic?foo=bar',
    'https://example.com/guide#/callback?access_token=synthetic?foo=bar',
  ]) assert.throws(() => sourceUrl(url), { status: 400 }, url);
});

test('failed source persistence cannot return cached success or expose uncommitted state until storage recovers', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'yeno-source-write-failure-'));
  const runtime = await startServer({ dataDir: dir, token: TOKEN, host: '127.0.0.1', port: 0, env: {} });
  const originalOpen = fs.openSync;
  let failWrites = false;
  fs.openSync = function (filename, ...args) {
    if (failWrites && typeof filename === 'string' && filename.startsWith(path.join(dir, 'state.json.')) && filename.endsWith('.tmp')) {
      const error = new Error('synthetic disk full');
      error.code = 'ENOSPC';
      throw error;
    }
    return originalOpen.call(this, filename, ...args);
  };
  t.after(async () => { fs.openSync = originalOpen; runtime.shutdown(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  async function api(route, body) {
    const response = await fetch(`${base}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const before = await readFile(path.join(dir, 'state.json'), 'utf8');
  const request = { sources: [sourceInput()], requestId: randomUUID() };
  failWrites = true;
  assert.equal((await api('/api/sources/import', request)).status, 500);
  assert.equal((await api('/api/sources/import', request)).status, 500, 'receipt in memory cannot be reported as successful before it is durable');
  assert.equal((await api('/api/state')).status, 500, 'state must not present the uncommitted import as persisted');
  assert.equal((await api('/api/sources')).status, 500);
  assert.equal(await readFile(path.join(dir, 'state.json'), 'utf8'), before);
  failWrites = false;
  const retry = await api('/api/sources/import', request);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.createdCount, 1);
  assert.equal(retry.body.sources.length, 1);
  // Read the actual file before shutdown can perform a further successful save.
  const saved = JSON.parse(JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8')).payload);
  assert.deepEqual(saved.sources, retry.body.sources);
  assert.deepEqual(saved.requests[request.requestId].payload, retry.body);
  assert.deepEqual((await api('/api/sources/import', request)).body, retry.body);
  assert.deepEqual((await api('/api/sources')).body.sources, retry.body.sources);
  assert.deepEqual(openStore(dir).state.sources, retry.body.sources, 'a fresh store read sees the acknowledged source');
});

test('source routes enforce device authentication, immutable URLs, revision checks and evidence before candidacy', async t => {
  const f = await fixture(t);
  for (const route of ['/api/sources', '/api/v1/sources']) {
    assert.equal((await f.api(route, { token: null })).status, 401);
    assert.equal((await f.post(route, { ...sourceInput(), requestId: randomUUID() }, null)).status, 401);
  }
  assert.equal((await f.api('/api/v1/sources')).status, 401, 'pairing credentials do not act as a versioned device session');
  const enrollment = await f.post('/api/v1/devices/enroll', { name: 'Source Android', platform: 'android', requestId: randomUUID() });
  assert.equal(enrollment.status, 201);
  const token = enrollment.body.device.deviceToken;
  const body = { ...sourceInput({ url: 'https://www.instagram.com/reel/Example/?stkn=synthetic' }), requestId: randomUUID() };
  const created = await f.post('/api/v1/sources', body, token);
  assert.equal(created.status, 201);
  const source = created.body.source;
  assert.equal(source.url, body.url);
  assert.equal(source.canonicalUrl, 'https://instagram.com/reel/Example');
  assert.equal(source.readingStatus, 'unread');
  assert.equal(source.decision, 'pending');
  assert.equal(source.version, 1);
  assert.equal(source.projectId, null);
  assert.deepEqual((await f.post('/api/sources', body, token)).body, created.body);
  await f.rejected('/api/v1/sources', { ...body, title: 'request ID misuse' }, 409, token);
  const duplicate = await f.rejected('/api/sources', { ...body, url: source.canonicalUrl, requestId: randomUUID() }, 409);
  assert.deepEqual(duplicate.body.source, source);
  const route = `/api/v1/sources/${source.id}/update`;
  for (const fields of [
    { decision: 'candidate' }, { ...reviewed, readingStatus: 'partial' },
    { ...reviewed, readingStatus: 'unavailable' }, { ...reviewed, application: '   ' },
    { ...reviewed, riskNotes: '' }, { ...reviewed, summary: '' },
    { decision: 'tested' }, { url: 'https://example.com/replaced' },
    { canonicalUrl: 'https://example.com/replaced' }, { title: '' }, { projectId: randomUUID() },
  ]) await f.rejected(route, { revision: 1, ...fields, requestId: randomUUID() }, 400, token);
  await f.rejected('/api/sources', sourceInput());
  await f.rejected(route, { title: 'missing revision', requestId: randomUUID() }, 400, token);
  await f.rejected(route, { revision: 1, requestId: randomUUID() }, 400, token);
  const change = { revision: 1, ...reviewed, requestId: randomUUID() };
  const updated = await f.post(route, change, token);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.source.version, 2);
  assert.equal(updated.body.source.url, source.url);
  assert.equal(updated.body.source.createdAt, source.createdAt);
  assert.deepEqual((await f.post(route, change, token)).body, updated.body);
  const conflict = await f.rejected(route, { revision: 1, decision: 'deferred', requestId: randomUUID() }, 409, token);
  assert.deepEqual(conflict.body.source, updated.body.source);
  const state = await f.state();
  assert.deepEqual(state.sources, [updated.body.source]);
  assert.equal(state.capabilities.sourceIntake, true);
  assert.equal(state.capabilities.developerWorker, false);
  assert.equal(state.apiVersion, '1');
  assert.equal(state.version, '0.2.2');
  assert.equal((await f.post('/api/v1/devices/revoke', { requestId: randomUUID() }, token)).status, 200);
  assert.equal((await f.api('/api/v1/sources', { token })).status, 401);
  assert.equal((await f.post(route, change, token)).status, 401, 'authentication precedes stored receipt replay');
  assert.deepEqual((await f.api('/api/sources')).body.sources, [updated.body.source]);
});

test('source import validates the entire batch before mutation, reuses exact records and preserves request identity', async t => {
  const f = await fixture(t);
  const input = sourceInput();
  const existing = await f.source();
  const route = '/api/sources/import';
  const newSource = sourceInput({ url: 'https://example.com/second', title: '두 번째 자료' });
  for (const sources of [
    [newSource, { ...sourceInput({ url: 'https://example.com/invalid' }), title: '' }],
    [newSource, sourceInput({ url: 'https://example.com/invalid', ...reviewed, readingStatus: 'partial' })],
    [], Array.from({ length: 101 }, (_, i) => sourceInput({ url: `https://example.com/${i}` })),
  ]) await f.rejected(route, { sources, requestId: randomUUID() });
  await f.rejected(route, { sources: [newSource, { ...newSource, url: `${newSource.url}?utm_source=dup` }], requestId: randomUUID() }, 409);
  const conflict = await f.rejected(route, { sources: [newSource, { ...input, title: 'conflicting title' }], requestId: randomUUID() }, 409);
  assert.deepEqual(conflict.body.source, existing);
  await f.rejected(route, { sources: [newSource, { ...input, url: `${input.url}?utm_source=changed-original` }], requestId: randomUUID() }, 409);
  await f.rejected(route, { sources: [newSource] });
  const request = { sources: [input, newSource], requestId: randomUUID() };
  const imported = await f.post(route, request);
  assert.equal(imported.status, 201);
  assert.equal(imported.body.createdCount, 1);
  assert.equal(imported.body.reusedCount, 1);
  assert.deepEqual(imported.body.sources[0], existing);
  assert.deepEqual((await f.post(route, request)).body, imported.body);
  assert.deepEqual((await f.api('/api/sources')).body.sources, imported.body.sources);
  await f.rejected(route, { ...request, sources: [input] }, 409);
  const reused = await f.post(route, { ...request, requestId: randomUUID() });
  assert.equal(reused.body.createdCount, 0);
  assert.equal(reused.body.reusedCount, 2);
  assert.deepEqual(reused.body.sources, imported.body.sources);
  await f.stop('SIGKILL');
  await f.start();
  assert.deepEqual((await f.post(route, request)).body, imported.body, 'original created/reused counts survive a process crash');
  assert.deepEqual((await f.api('/api/sources')).body.sources, imported.body.sources);
});

test('installed APK source commands create project-linked documents with durable results and acknowledgements after SIGKILL', async t => {
  const f = await fixture(t);
  const enrollment = await f.post('/api/v1/devices/enroll', { name: 'Existing APK source commands', platform: 'android', requestId: randomUUID() });
  const token = enrollment.body.device.deviceToken;
  const projectResponse = await f.post('/api/v1/projects', { name: 'Source test project', requestId: randomUUID() }, token);
  assert.equal(projectResponse.status, 201);
  const project = projectResponse.body.project;
  const create = { ...sourceInput({ projectId: project.id }), ...reviewed, requestId: randomUUID() };
  const registered = await f.post('/api/v1/sources', create, token);
  assert.equal(registered.status, 201);
  const source = registered.body.source;
  const pending = await f.source({ url: 'https://example.com/unread', title: '미확인 소셜 링크' });
  await f.rejected('/api/v1/commands', { text: `개선 후보: ${pending.id}`, requestId: randomUUID() }, 409, token);
  const requests = [
    { text: '자료 목록', requestId: randomUUID() },
    { text: `자료 브리핑: ${source.id}`, requestId: randomUUID() },
    { text: `개선 후보: ${source.id}`, requestId: randomUUID() },
  ];
  const responses = [], results = [];
  for (const request of requests) {
    const response = await f.post('/api/v1/commands', request, token);
    assert.equal(response.status, 201);
    assert.equal(response.body.kind, 'job');
    assert.equal(response.body.job.type, 'document');
    responses.push(response.body);
    const complete = await f.completed(response.body.job.id);
    const artifact = await f.api(`/api/v1/artifacts/${complete.artifacts[0].id}`, { token });
    assert.equal(artifact.status, 200);
    assert.equal(digest(artifact.body), artifact.headers.get('x-content-sha256'));
    assert.match(artifact.body, /외부 링크 조회·AI 호출·코드 작성·검사·배포를 수행하지 않았습니다/);
    results.push({ job: complete, artifact });
  }
  assert.equal(responses[0].job.projectId, undefined);
  for (const index of [1, 2]) {
    assert.equal(responses[index].job.projectId, project.id);
    assert.equal(responses[index].job.sourceId, source.id);
    assert.match(results[index].artifact.body, /개발 작업자는 미연결/);
    assert.ok(results[index].artifact.body.includes(reviewed.application));
    assert.ok(results[index].artifact.body.includes(reviewed.riskNotes));
  }
  assert.match(results[2].artifact.body, /개선 후보 준비서/);
  const change = { revision: 1, decision: 'deferred', requestId: randomUUID() };
  const updated = await f.post(`/api/v1/sources/${source.id}/update`, change, token);
  assert.equal(updated.status, 200);
  await f.stop('SIGKILL');
  await f.start();
  const after = await f.api('/api/v1/sources', { token });
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.sources, [updated.body.source, pending]);
  assert.deepEqual((await f.post('/api/v1/sources', create, token)).body, registered.body);
  for (let index = 0; index < requests.length; index++) {
    assert.deepEqual((await f.post('/api/v1/commands', requests[index], token)).body, responses[index], 'acknowledgement replays the original job even after the review changes');
    assert.deepEqual(await f.job(results[index].job.id), results[index].job);
    const artifact = await f.api(`/api/v1/artifacts/${results[index].job.artifacts[0].id}`, { token });
    assert.equal(artifact.body, results[index].artifact.body);
    assert.equal(artifact.headers.get('x-content-sha256'), results[index].artifact.headers.get('x-content-sha256'));
  }
  assert.equal((await f.state()).jobs.length, 3);
  await f.rejected('/api/v1/commands', { text: `개선 후보: ${source.id}`, requestId: randomUUID() }, 409, token);
});

test('source lists stay under document input bounds and briefs retain full review fields', () => {
  const source = {
    ...sourceInput({ url: `https://example.com/${'x'.repeat(2020)}`, title: '긴'.repeat(160) }),
    canonicalUrl: `https://example.com/${'x'.repeat(2020)}`, projectId: null,
    ...reviewed, summary: '설'.repeat(8000), application: '적'.repeat(8000), riskNotes: '쟁'.repeat(4000),
    id: randomUUID(), version: 1,
  };
  const sources = Array.from({ length: 61 }, () => ({ ...source, id: randomUUID() }));
  const list = sourceRegistryDocument(sources);
  assert.ok(list.length < 80000, 'valid large registries must be accepted by the document job input limit');
  assert.match(list, /표시 50개 \/ 전체 61개/);
  assert.ok(!list.includes(sources[50].id));
  assert.match(list, /다음: 자료 목록 2/);
  const second = sourceRegistryDocument(sources, { page: 2 });
  assert.ok(second.includes(sources[60].id));
  assert.ok(!second.includes(sources[0].id));
  assert.ok(second.length < 80000);
  assert.throws(() => sourceRegistryDocument(sources, { page: 3 }), /2페이지/);
  assert.throws(() => sourceRegistryDocument(sources, { page: 0 }), /정수/);
  assert.ok(!list.includes(source.summary));
  const brief = sourceBriefDocument(source, true);
  for (const field of ['url', 'summary', 'application', 'riskNotes']) assert.ok(brief.includes(source[field]), field);
  assert.ok(brief.length < 80000);
});

test('historical names locate God Eye beyond the first page without changing source reviews', async t => {
  const f = await fixture(t);
  const inputs = Array.from({ length: 60 }, (_, i) => sourceInput({ url: `https://example.com/reference-${i}`, title: `기존 참고자료 ${i}` }));
  inputs.push(sourceInput({ url: 'https://www.instagram.com/reel/DcjMGA9vHxU/', title: '공개 데이터를 모은 세계 상황판' }));
  const imported = await f.post('/api/sources/import', { sources: inputs, requestId: randomUUID() });
  assert.equal(imported.status, 201);
  const before = (await f.state()).sources;
  const god = before.at(-1);
  for (const query of ['God Eye', 'Godeye', '갓아이', 'God’s Eye View']) {
    assert.ok(sourceMatches(god, query));
    assert.equal(resolveSource(before, query).id, god.id);
  }
  assert.throws(() => resolveSource(before, '기존 참고자료'), /여러 자료/);
  assert.throws(() => resolveSource(before, '???'), /이름이나 ID/);
  const second = await f.post('/api/commands', { text: '자료 목록 2', requestId: randomUUID() });
  const search = await f.post('/api/commands', { text: '자료 목록: God Eye', requestId: randomUUID() });
  const brief = await f.post('/api/commands', { text: '자료 브리핑: Godeye', requestId: randomUUID() });
  for (const response of [second, search, brief]) {
    assert.equal(response.status, 201);
    const job = await f.completed(response.body.job.id);
    const artifact = await f.api(`/api/artifacts/${job.artifacts[0].id}`);
    assert.equal(artifact.status, 200);
    assert.ok(artifact.body.includes(god.id));
    assert.match(artifact.body, /God Eye/);
    assert.match(artifact.body, /미확인/);
    assert.match(artifact.body, /검토 대기/);
  }
  const filteredPage = sourceRegistryDocument(before, { page: 2, query: '기존 참고자료' });
  assert.ok(filteredPage.includes(before[59].id));
  assert.ok(!filteredPage.includes(god.id));
  assert.match(filteredPage, /이전: 자료 목록 1: 기존 참고자료/);
  const module = await f.api('/source-reference-labels.mjs', { token: '' });
  assert.equal(module.status, 200);
  assert.match(module.body, /export function sourceMatches/);
  assert.deepEqual((await f.state()).sources, before);
});

test('global stop freezes source jobs while reviews and memory restoration preserve the source registry', async t => {
  const f = await fixture(t);
  const source = await f.source(reviewed);
  const snapshot = await f.post('/api/snapshots', { label: '자료 검토 전', requestId: randomUUID() });
  const command = await f.post('/api/commands', { text: `개선 후보: ${source.id}`, requestId: randomUUID() });
  assert.equal(command.status, 201);
  const id = command.body.job.id;
  await f.eventually(() => f.job(id), job => job.status === 'running');
  assert.equal((await f.post('/api/control', { action: 'stop', requestId: randomUUID() })).status, 200);
  const frozen = await f.job(id);
  assert.equal(frozen.status, 'paused');
  for (const text of ['자료 목록', `자료 브리핑: ${source.id}`, `개선 후보: ${source.id}`]) {
    await f.rejected('/api/commands', { text, requestId: randomUUID() }, 409);
  }
  const changed = await f.post(`/api/sources/${source.id}/update`, { revision: 1, decision: 'deferred', requestId: randomUUID() });
  assert.equal(changed.status, 200, 'review metadata remains editable while execution is stopped');
  const imported = await f.post('/api/sources/import', { sources: [sourceInput({ url: 'https://example.com/during-stop' })], requestId: randomUUID() });
  assert.equal(imported.status, 201);
  const expected = [changed.body.source, imported.body.sources[0]];
  const restored = await f.post(`/api/snapshots/${snapshot.body.snapshot.id}/restore`, { confirm: true, requestId: randomUUID() });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.state.sources, expected);
  assert.equal(restored.body.state.emergencyStop, true);
  assert.equal((await f.post('/api/control', { action: 'resume', requestId: randomUUID() })).status, 200);
  await delay(700);
  assert.deepEqual(await f.job(id), frozen, 'releasing global stop does not resume previously paused source work');
  assert.equal((await f.post(`/api/jobs/${id}/action`, { action: 'resume', revision: frozen.version, requestId: randomUUID() })).status, 200);
  const complete = await f.completed(id);
  assert.equal(complete.artifacts.length, 1);
  assert.equal(complete.sourceId, source.id);
  assert.deepEqual((await f.state()).sources, expected);
  assert.equal((await f.post('/api/settings', { modules: { documents: false }, requestId: randomUUID() })).status, 200);
  await f.rejected('/api/commands', { text: '자료 목록', requestId: randomUUID() }, 409);
});
