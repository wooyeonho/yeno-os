import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, initialState, openStore } from '../lib/store.mjs';

const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
const TOKEN = 'project-integration-synthetic-token';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const envelope = value => { const payload = JSON.stringify(value); return JSON.stringify({ format: 1, sha256: digest(payload), payload }); };

async function temporaryDirectory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'yeno-projects-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'yeno-project-http-'));
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
      if (child.exitCode !== null) throw new Error(`Project fixture exited: ${logs}`);
      const ready = logs.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/);
      if (ready) { base = ready[1]; return; }
      await delay(30);
    }
    throw new Error(`Project fixture failed to start: ${logs}`);
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
    assert.fail(`Project condition timed out: ${JSON.stringify(value)}`);
  }
  const job = async id => (await state()).jobs.find(item => item.id === id);
  const completed = id => eventually(() => job(id), item => item?.status === 'completed');
  async function project(fields = {}) {
    const response = await post('/api/projects', { name: 'YENO OS', summary: '프로젝트 설명', nextAction: '다음 단계 확인', requestId: randomUUID(), ...fields });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.project;
  }
  t.after(async () => { await stop(); await rm(dir, { recursive: true, force: true }); });
  await start();
  return { dir, api, post, state, start, stop, eventually, job, completed, project };
}

test('project migration adds only an absent registry and preserves existing state and registries', async t => {
  const dir = await temporaryDirectory(t);
  const legacy = initialState();
  delete legacy.projects;
  delete legacy.requestLedger;
  Object.assign(legacy, {
    revision: 24, emergencyStop: true, concurrency: 2,
    jobs: [{ id: randomUUID(), status: 'completed', artifacts: [{ id: 'result-kept' }] }],
    memories: [{ id: randomUUID(), text: '원본 기억' }],
    snapshots: [{ id: randomUUID(), data: { memories: ['snapshot-kept'], settings: {} } }],
    events: [{ id: randomUUID(), text: 'event-kept' }],
    requests: { retained: { hash: digest('request-hash'), status: 201, payload: { job: { id: 'old-job' } } } },
    artifacts: { 'result-kept': { sha256: 'old-hash', filename: 'old.md' } },
    devices: { 'old-device': { tokenHash: 'retained-device-hash', revokedAt: null } },
  });
  const filename = path.join(dir, 'state.json');
  await writeFile(filename, envelope(legacy));
  const opened = openStore(dir);
  const requestLedger = { retained: { hash: digest('request-hash'), status: 201 } };
  assert.deepEqual(opened.state, { ...legacy, requestLedger, projects: [] });
  const registered = { id: randomUUID(), name: '기존 프로젝트', summary: '설명', repositoryUrl: '', nextAction: '', status: 'paused', version: 3, createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T01:00:00Z' };
  opened.state.projects.push(registered);
  opened.save();
  const again = openStore(dir);
  assert.deepEqual(again.state, { ...legacy, requestLedger, revision: 25, projects: [registered] });
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).sha256, digest(JSON.parse(await readFile(filename, 'utf8')).payload));

  for (const projects of [
    { existing: 'must not be silently reset' }, [null], [{ ...registered, summary: null }],
    [{ ...registered, id: 'not-a-uuid' }], [{ ...registered, version: 0 }],
    [{ ...registered, createdAt: 'yesterday' }],
    [registered, { ...registered, id: randomUUID() }],
    [registered, { ...registered, name: 'another-name' }],
  ]) {
    const invalid = envelope({ ...legacy, projects });
    await writeFile(filename, invalid);
    await writeFile(`${filename}.bak`, invalid);
    assert.throws(() => openStore(dir), /Original data has been preserved/);
    assert.equal(await readFile(filename, 'utf8'), invalid);
    assert.equal(await readFile(`${filename}.bak`, 'utf8'), invalid);
  }
  await writeFile(`${filename}.bak`, envelope({ ...legacy, projects: [registered] }));
  const recovered = openStore(dir);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.state.projects, [registered], 'malformed primary must use the verified backup, never silently clear projects');
});

test('project routes retain auth, device revocation, create retries and optimistic updates', async t => {
  const f = await fixture(t);
  for (const route of ['/api/projects', '/api/v1/projects']) {
    assert.equal((await f.api(route, { token: null })).status, 401);
    assert.equal((await f.post(route, { name: 'blocked', requestId: randomUUID() }, null)).status, 401);
  }
  assert.equal((await f.api('/api/v1/projects')).status, 401, 'the pairing key cannot act as a v1 session');
  const enrolled = await f.post('/api/v1/devices/enroll', { name: 'Project Android', platform: 'android', requestId: randomUUID() });
  assert.equal(enrolled.status, 201);
  const token = enrolled.body.device.deviceToken;
  const body = { name: 'YENO OS', repositoryUrl: 'https://github.com/wooyeonho/yeno-os.git', summary: '개인 도구', nextAction: '기억 연결', status: 'active', requestId: randomUUID() };
  const created = await f.post('/api/v1/projects', body, token);
  assert.equal(created.status, 201);
  const project = created.body.project;
  assert.equal(project.repositoryUrl, 'https://github.com/wooyeonho/yeno-os');
  assert.equal(project.version, 1);
  assert.match(project.id, /^[a-f0-9-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(project.createdAt)));
  assert.equal(project.createdAt, project.updatedAt);
  assert.deepEqual((await f.post('/api/projects', body, token)).body, created.body, 'legacy and v1 paths share request identity');
  assert.equal((await f.post('/api/projects', { ...body, summary: 'different' }, token)).status, 409);
  assert.equal((await f.api('/api/v1/projects', { token })).body.projects.length, 1);
  const route = `/api/v1/projects/${project.id}/update`;
  const change = { revision: 1, status: 'paused', nextAction: '검토 대기', requestId: randomUUID() };
  const updated = await f.post(route, change, token);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.project.version, 2);
  assert.equal(updated.body.project.createdAt, project.createdAt);
  assert.deepEqual((await f.post(route, change, token)).body, updated.body);
  const conflict = await f.post(route, { revision: 1, status: 'archived', requestId: randomUUID() }, token);
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body.project, updated.body.project);
  const state = await f.state();
  assert.deepEqual(state.projects, [updated.body.project]);
  assert.equal(state.capabilities.projectManagement, true);
  assert.equal(state.capabilities.developerWorker, false);
  assert.equal(state.apiVersion, '1');
  assert.equal(state.version, '0.2.2');
  assert.equal((await f.post('/api/v1/devices/revoke', { requestId: randomUUID() }, token)).status, 200);
  assert.equal((await f.api('/api/v1/projects', { token })).status, 401);
  assert.equal((await f.post(route, { revision: 2, status: 'active', requestId: randomUUID() }, token)).status, 401);
  assert.deepEqual((await f.api('/api/projects')).body.projects, [updated.body.project]);
});

test('invalid optional fields, repository URLs, normalized names and revisions reject atomically', async t => {
  const f = await fixture(t);
  const project = await f.project();
  const route = `/api/projects/${project.id}/update`;
  const filename = path.join(f.dir, 'state.json');
  async function rejected(target, body, status = 400) {
    const before = await readFile(filename, 'utf8');
    const response = await f.post(target, body);
    assert.equal(response.status, status, JSON.stringify(response.body));
    assert.equal(await readFile(filename, 'utf8'), before, 'rejected mutation must not write projects, revision, events or retry receipts');
  }
  await rejected('/api/projects', { name: 'missing request id' });
  for (const fields of [
    { name: 'New', summary: false }, { name: 'New', nextAction: {} }, { name: 'New', status: 'deleted' },
    { name: 'New', repositoryUrl: null }, { name: 'New', id: randomUUID() },
    { name: 'Bad｜Name' }, { name: 'ﬃ'.repeat(30) }, { name: 'Bad\nName' },
  ]) await rejected('/api/projects', { ...fields, requestId: randomUUID() });
  for (const repositoryUrl of [
    'http://github.com/owner/repo', 'https://github.com.evil.invalid/owner/repo',
    'https://key@github.com/owner/repo', 'https://github.com/owner/repo?token=value',
    'https://github.com/owner/repo#main', 'https://github.com/owner/../repo',
    'https://github.com/owner/%2e%2e', 'https://github.com/owner/.git',
  ]) await rejected('/api/projects', { name: 'New', repositoryUrl, requestId: randomUUID() });
  await rejected('/api/projects', { name: 'ｙｅｎｏ   ｏｓ', requestId: randomUUID() }, 409);
  await rejected(route, { revision: 1, name: 'Changed before bad field', summary: null, requestId: randomUUID() });
  await rejected(route, { revision: 1, status: 'paused', nextAction: 7, requestId: randomUUID() });
  await rejected(route, { status: 'paused', requestId: randomUUID() });
  await rejected(route, { revision: 0, status: 'paused', requestId: randomUUID() });
  await rejected(route, { revision: 2, status: 'paused', requestId: randomUUID() }, 409);
  await rejected(route, { revision: 1, requestId: randomUUID() });
  const second = await f.project({ name: 'Second' });
  await rejected(`/api/projects/${second.id}/update`, { revision: 1, name: 'yeno os', requestId: randomUUID() }, 409);
  for (const projectId of [null, {}, randomUUID()]) await rejected('/api/jobs', { type: 'document', text: 'invalid project link', projectId, requestId: randomUUID() }, 404);
  assert.deepEqual((await f.state()).projects, [project, second]);
});

test('old Android project commands produce linked real documents and survive a process crash with retries', async t => {
  const f = await fixture(t);
  const enrolled = await f.post('/api/v1/devices/enroll', { name: 'Existing APK', platform: 'android', requestId: randomUUID() });
  const token = enrolled.body.device.deviceToken;
  const createBody = { name: 'YENO OS', summary: '노트북이 꺼져도 프로젝트 상태를 확인한다.', nextAction: '프로젝트별 결과 연결', repositoryUrl: 'https://github.com/wooyeonho/yeno-os', requestId: randomUUID() };
  const created = await f.post('/api/v1/projects', createBody, token);
  assert.equal(created.status, 201);
  const project = created.body.project;
  const requests = [
    { text: '프로젝트 목록', requestId: randomUUID() },
    { text: '프로젝트 브리핑: yeno os', requestId: randomUUID() },
    { text: `프로젝트 작업: ${project.id} | 로그인 버그의 재현 절차를 준비해`, requestId: randomUUID() },
  ];
  const submitted = [];
  for (const body of requests) {
    const response = await f.post('/api/v1/commands', body, token);
    assert.equal(response.status, 201);
    assert.equal(response.body.kind, 'job', 'installed APK continues to receive its existing job payload');
    assert.equal(response.body.job.type, 'document');
    submitted.push(response.body);
  }
  assert.equal(submitted[0].job.projectId, undefined);
  assert.equal(submitted[1].job.projectId, project.id);
  assert.equal(submitted[2].job.projectId, project.id);
  const scoped = await f.post('/api/jobs', { type: 'document', text: '직접 지정한 프로젝트 작업', projectId: project.id, requestId: randomUUID() });
  assert.equal(scoped.status, 201);
  assert.equal(scoped.body.job.projectId, project.id);
  const results = [];
  for (const { job } of submitted) {
    const completed = await f.completed(job.id);
    const artifact = await f.api(`/api/v1/artifacts/${completed.artifacts[0].id}`, { token });
    assert.equal(artifact.status, 200);
    assert.equal(digest(artifact.body), artifact.headers.get('x-content-sha256'));
    assert.match(artifact.body, /YENO OS/);
    assert.match(artifact.body, /개발 작업자.*미연결|개발 작업자는 아직 연결되지/);
    results.push({ job: completed, artifact });
  }
  assert.match(results[0].artifact.body, /실제 호스팅 상태를 뜻하지 않습니다/);
  assert.match(results[1].artifact.body, /노트북이 꺼져도 프로젝트 상태를 확인한다/);
  assert.match(results[1].artifact.body, /프로젝트별 결과 연결/);
  assert.match(results[2].artifact.body, /프로젝트 작업 준비서/);
  assert.match(results[2].artifact.body, /로그인 버그의 재현 절차를 준비해/);
  assert.match(results[2].artifact.body, /코드 작성·실행·배포·외부 저장소 조회를 수행하지 않았습니다/);
  await f.completed(scoped.body.job.id);
  const updateBody = { revision: 1, status: 'archived', summary: '정리 완료', requestId: randomUUID() };
  const updateRoute = `/api/v1/projects/${project.id}/update`;
  const updated = await f.post(updateRoute, updateBody, token);
  assert.equal(updated.status, 200);
  await f.stop('SIGKILL');
  await f.start();
  assert.deepEqual((await f.api('/api/v1/projects', { token })).body.projects, [updated.body.project]);
  assert.deepEqual((await f.post('/api/v1/projects', createBody, token)).body, created.body, 'old creation acknowledgement remains stable after later edits and restart');
  assert.deepEqual((await f.post(updateRoute, updateBody, token)).body, updated.body);
  for (let index = 0; index < requests.length; index++) {
    assert.deepEqual((await f.post('/api/v1/commands', requests[index], token)).body, submitted[index]);
    const current = await f.job(results[index].job.id);
    assert.deepEqual(current, results[index].job);
    const artifact = await f.api(`/api/v1/artifacts/${current.artifacts[0].id}`, { token });
    assert.equal(artifact.body, results[index].artifact.body);
    assert.equal(artifact.headers.get('x-content-sha256'), results[index].artifact.headers.get('x-content-sha256'));
  }
  assert.equal((await f.state()).jobs.length, 4);
});

test('large registries produce bounded lists while full project briefs preserve long next actions', async t => {
  const f = await fixture(t);
  const project = await f.project({ nextAction: '장'.repeat(4000), summary: '상세 설명'.repeat(1000) });
  await f.stop();
  const store = openStore(f.dir);
  store.state.projects = Array.from({ length: 61 }, (_, index) => ({
    ...project, id: randomUUID(), name: `${index} ` + '긴'.repeat(75),
  }));
  store.save();
  await f.start();
  const list = await f.post('/api/commands', { text: '프로젝트 목록', requestId: randomUUID() });
  assert.equal(list.status, 201, 'a valid large registry must not hit the document input limit');
  const listJob = await f.completed(list.body.job.id);
  const output = await f.api(`/api/artifacts/${listJob.artifacts[0].id}`);
  assert.equal(output.status, 200);
  assert.ok(output.body.length < 80000);
  assert.match(output.body, /표시 50개 \/ 전체 61개/);
  assert.match(output.body, /나머지 11개/);
  assert.match(output.body, /프로젝트 브리핑/);
  assert.ok(!output.body.includes(project.nextAction), 'registry uses an explicitly marked excerpt');
  assert.deepEqual((await f.state()).projects, store.state.projects, 'rendering a short report must not truncate the stored registry');
  const brief = await f.post('/api/commands', { text: `프로젝트 브리핑: ${store.state.projects[60].id}`, requestId: randomUUID() });
  assert.equal(brief.status, 201);
  const briefJob = await f.completed(brief.body.job.id);
  const full = await f.api(`/api/artifacts/${briefJob.artifacts[0].id}`);
  assert.equal(full.status, 200);
  assert.ok(full.body.includes(project.nextAction));
  assert.ok(full.body.includes(project.summary));
});

test('project tracking and memory restore preserve the global stop and require explicit job resume', async t => {
  const f = await fixture(t);
  const project = await f.project({ status: 'paused' });
  const snapshot = await f.post('/api/snapshots', { label: '프로젝트 편집 전', requestId: randomUUID() });
  assert.equal(snapshot.status, 201);
  const command = await f.post('/api/commands', { text: `프로젝트 작업: ${project.id} | 작업 범위 확인`, requestId: randomUUID() });
  assert.equal(command.status, 201, 'project paused is tracking metadata, not a remote hosting or worker switch');
  const id = command.body.job.id;
  await f.eventually(() => f.job(id), job => job.status === 'running');
  assert.equal((await f.post('/api/control', { action: 'stop', requestId: randomUUID() })).status, 200);
  const frozen = await f.job(id);
  assert.equal(frozen.status, 'paused');
  for (const text of ['프로젝트 목록', `프로젝트 브리핑: ${project.id}`, `프로젝트 작업: ${project.id} | 준비`]) {
    assert.equal((await f.post('/api/commands', { text, requestId: randomUUID() })).status, 409);
  }
  const changed = await f.post(`/api/projects/${project.id}/update`, { revision: 1, status: 'archived', summary: '복원 후에도 보존할 프로젝트 변경', requestId: randomUUID() });
  assert.equal(changed.status, 200, 'tracking remains editable while execution is stopped');
  const restored = await f.post(`/api/snapshots/${snapshot.body.snapshot.id}/restore`, { confirm: true, requestId: randomUUID() });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.state.projects, [changed.body.project]);
  assert.equal(restored.body.state.emergencyStop, true);
  assert.equal((await f.post('/api/control', { action: 'resume', requestId: randomUUID() })).status, 200);
  await delay(700);
  assert.deepEqual(await f.job(id), frozen, 'releasing the global latch must not resume the project job');
  assert.equal((await f.post(`/api/jobs/${id}/action`, { action: 'resume', revision: frozen.version, requestId: randomUUID() })).status, 200);
  const completed = await f.completed(id);
  assert.equal(completed.projectId, project.id);
  assert.equal(completed.artifacts.length, 1);
  assert.deepEqual((await f.state()).projects, [changed.body.project]);
});
