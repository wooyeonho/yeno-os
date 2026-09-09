import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = fileURLToPath(new URL('../', import.meta.url));
const TEST_TOKEN = 'integration-test-token-only-9f371a';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function rawGet(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function fixture(t, environment = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'yeno-integration-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child;
  let logs = '';

  async function stop(signal = 'SIGTERM') {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const processToStop = child;
    const closed = new Promise((resolve) => processToStop.once('exit', resolve));
    processToStop.kill(signal);
    const timer = setTimeout(() => processToStop.kill('SIGKILL'), 1500);
    await closed;
    clearTimeout(timer);
  }

  async function start({ token = TEST_TOKEN } = {}) {
    logs = '';
    child = spawn(process.execPath, ['server.mjs'], {
      cwd: runtimeRoot,
      env: {
        ...process.env,
        YENO_AI_BASE_URL: '',
        YENO_AI_MODEL: '',
        YENO_AI_API_KEY: '',
        ...environment,
        YENO_PORT: String(port),
        YENO_HOST: '127.0.0.1',
        YENO_DATA_DIR: dir,
        YENO_TOKEN: token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { logs += chunk; });
    child.stderr.on('data', (chunk) => { logs += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}: ${logs}`);
      try {
        const response = await fetch(`${base}/api/health`);
        if (response.ok) return;
      } catch { /* The socket is not yet accepting connections. */ }
      await sleep(50);
    }
    throw new Error(`Server failed to start: ${logs}`);
  }

  async function api(route, { method = 'GET', body, token = TEST_TOKEN, headers = {} } = {}) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); } catch { value = text; }
    return { status: response.status, body: value, headers: response.headers };
  }

  async function eventually(read, predicate, message, timeout = 8000) {
    const end = Date.now() + timeout;
    let value;
    do {
      value = await read();
      if (predicate(value)) return value;
      await sleep(30);
    } while (Date.now() < end);
    assert.fail(`${message}; last observed ${JSON.stringify(value)}; server output ${logs}`);
  }

  async function state() {
    const response = await api('/api/state');
    assert.equal(response.status, 200);
    return response.body;
  }

  async function job(id) {
    const value = (await state()).jobs.find((item) => item.id === id);
    assert.ok(value, `Job ${id} should remain visible`);
    return value;
  }

  async function createJob(overrides = {}) {
    const response = await api('/api/jobs', {
      method: 'POST',
      body: { type: 'document', title: '여행 중 YENO 실행', text: '첫 번째 실제 결과물을 저장합니다.\n다음 작업을 이어갑니다.', requestId: randomUUID(), ...overrides },
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.job;
  }

  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  await start();
  return { dir, base, port, api, start, stop, eventually, state, job, createJob };
}

test('the runtime requires its token and rejects untrusted browser origins and hosts', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.api('/api/health', { token: null })).status, 200);
  assert.equal((await f.api('/api/state', { token: null })).status, 401);
  assert.equal((await f.api('/api/state', { token: 'wrong-token' })).status, 401);
  assert.equal((await f.api('/api/state', { headers: { origin: 'https://attacker.invalid' } })).status, 403);
  // Fetch rewrites Host to match its URL, so use an actual HTTP request for this check.
  assert.equal(await rawGet(`${f.base}/api/state`, { host: 'attacker.invalid', authorization: `Bearer ${TEST_TOKEN}` }), 403);
  assert.equal((await f.api('/api/state', { headers: { origin: f.base } })).status, 200);
});

test('versioned native API enrolls, persists, and revokes a device-scoped credential', async (t) => {
  const f = await fixture(t);
  const requestId = randomUUID();
  const enrollmentBody = { name: 'Owner Android', platform: 'android', requestId };
  const enrolled = await f.api('/api/v1/devices/enroll', {
    method: 'POST', body: enrollmentBody,
  });
  assert.equal(enrolled.status, 201);
  assert.equal(enrolled.body.device.name, 'Owner Android');
  const deviceToken = enrolled.body.device.deviceToken;
  assert.equal(typeof deviceToken, 'string');
  assert.equal((await f.api('/api/v1/state')).status, 401, 'pairing token is not an API v1 session token');
  assert.equal((await f.api('/api/v1/state', { token: deviceToken })).status, 200);
  const command = await f.api('/api/v1/commands', {
    method: 'POST', token: deviceToken,
    body: { text: '문서 만들어: Android 명령 결과 재접속 확인', requestId: randomUUID() },
  });
  assert.equal(command.status, 201);
  const completed = await f.eventually(
    () => f.api('/api/v1/state', { token: deviceToken }),
    (response) => response.body.jobs.find((job) => job.id === command.body.job.id)?.status === 'completed',
    'native command should produce a durable result',
  );
  const artifact = completed.body.jobs.find((job) => job.id === command.body.job.id).artifacts[0];

  for (const filename of ['state.json', 'state.json.bak']) {
    const saved = await readFile(path.join(f.dir, filename), 'utf8');
    assert.ok(!saved.includes(deviceToken), `${filename} must not persist the issued device credential`);
    const data = JSON.parse(JSON.parse(saved).payload);
    assert.ok(!Object.hasOwn(data.requests[requestId].payload.device, 'deviceToken'));
    assert.equal(data.devices[enrolled.body.device.id].tokenHash, createHash('sha256').update(deviceToken).digest('hex'));
  }

  await f.stop();
  await f.start();
  const enrollmentRetry = await f.api('/api/v1/devices/enroll', { method: 'POST', body: enrollmentBody });
  assert.equal(enrollmentRetry.status, 201);
  assert.deepEqual(enrollmentRetry.body, enrolled.body, 'a lost enrollment response is recoverable after restart');
  const afterRestart = await f.api('/api/v1/state', { token: deviceToken });
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.body.apiVersion, '1');
  assert.equal(afterRestart.body.jobs.find((job) => job.id === command.body.job.id).status, 'completed');
  const result = await f.api(`/api/v1/artifacts/${artifact.id}`, { token: deviceToken });
  assert.equal(result.status, 200);
  assert.match(result.body, /Android 명령 결과 재접속 확인/);

  const revoked = await f.api('/api/v1/devices/revoke', {
    method: 'POST', token: deviceToken, body: { requestId: randomUUID() },
  });
  assert.equal(revoked.status, 200);
  assert.equal((await f.api('/api/v1/state', { token: deviceToken })).status, 401);
  const revokedReplay = await f.api('/api/v1/devices/enroll', { method: 'POST', body: enrollmentBody });
  assert.equal(revokedReplay.status, 409, 'an enrollment retry cannot reissue a revoked credential');
  assert.ok(!JSON.stringify(revokedReplay.body).includes(deviceToken));
  assert.equal((await f.api('/api/v1/state', { token: deviceToken })).status, 401);
  await f.stop();
  await f.start();
  assert.equal((await f.api('/api/v1/devices/enroll', { method: 'POST', body: enrollmentBody })).status, 409);
  const saved = JSON.parse(JSON.parse(await readFile(path.join(f.dir, 'state.json'), 'utf8')).payload);
  assert.equal(Object.keys(saved.devices).length, 1, 'retries cannot silently enroll another device');
  for (const filename of ['state.json', 'state.json.bak']) {
    assert.ok(!(await readFile(path.join(f.dir, filename), 'utf8')).includes(deviceToken));
  }
});

test('pairing-secret rotation rejects credential recovery without invalidating issued device tokens', async (t) => {
  const f = await fixture(t);
  const body = { name: 'Owner Android', platform: 'android', requestId: randomUUID() };
  const enrolled = await f.api('/api/v1/devices/enroll', { method: 'POST', body });
  assert.equal(enrolled.status, 201);
  const deviceToken = enrolled.body.device.deviceToken;
  const rotatedToken = 'rotated-integration-pairing-token-9f371a';
  await f.stop();
  await f.start({ token: rotatedToken });

  const retry = await f.api('/api/v1/devices/enroll', { method: 'POST', body, token: rotatedToken });
  assert.equal(retry.status, 409, 'rotation must never return a successful but unusable reconstructed token');
  assert.ok(!Object.hasOwn(retry.body, 'device'));
  assert.equal((await f.api('/api/v1/state', { token: deviceToken })).status, 200);
  assert.equal((await f.api('/api/v1/devices/enroll', { method: 'POST', body })).status, 401);

  const fresh = await f.api('/api/v1/devices/enroll', {
    method: 'POST', token: rotatedToken, body: { ...body, requestId: randomUUID() },
  });
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.body.device.id, enrolled.body.device.id);
  assert.equal((await f.api('/api/v1/state', { token: fresh.body.device.deviceToken })).status, 200);
});

test('legacy enrollment receipts lose raw credentials while issued random tokens and owner state survive', async (t) => {
  const f = await fixture(t);
  const body = { name: 'Legacy Android', platform: 'android', requestId: randomUUID() };
  const enrolled = await f.api('/api/v1/devices/enroll', { method: 'POST', body });
  assert.equal(enrolled.status, 201);
  const memory = await f.api('/api/memory', {
    method: 'POST', body: { text: '마이그레이션 이후에도 남을 기억', requestId: randomUUID() },
  });
  assert.equal(memory.status, 201);
  const job = await f.createJob();
  await f.eventually(() => f.job(job.id), (item) => item.status === 'completed', 'legacy migration fixture needs a real result');
  await f.stop();

  // Reproduce the earlier candidate's random token and leaked cached response.
  const filename = path.join(f.dir, 'state.json');
  const before = JSON.parse(JSON.parse(await readFile(filename, 'utf8')).payload);
  const legacyToken = `legacy-random-device-token-${randomUUID()}`;
  before.devices[enrolled.body.device.id].tokenHash = createHash('sha256').update(legacyToken).digest('hex');
  before.requests[body.requestId].payload.device.deviceToken = legacyToken;
  const payload = JSON.stringify(before);
  const envelope = JSON.stringify({ format: 1, sha256: createHash('sha256').update(payload).digest('hex'), payload });
  await writeFile(filename, envelope);
  await writeFile(`${filename}.bak`, envelope);
  await f.start();

  assert.equal((await f.api('/api/v1/state', { token: legacyToken })).status, 200);
  assert.equal((await f.api('/api/v1/devices/enroll', { method: 'POST', body })).status, 409, 'legacy receipts must not mint a different credential');
  for (const file of [filename, `${filename}.bak`]) {
    const serialized = await readFile(file, 'utf8');
    assert.ok(!serialized.includes(legacyToken), `${path.basename(file)} must be scrubbed on load/save`);
    const savedEnvelope = JSON.parse(serialized);
    assert.equal(savedEnvelope.sha256, createHash('sha256').update(savedEnvelope.payload).digest('hex'));
    const after = JSON.parse(savedEnvelope.payload);
    assert.deepEqual(after.jobs, before.jobs);
    assert.deepEqual(after.memories, before.memories);
    assert.deepEqual(after.snapshots, before.snapshots);
    assert.deepEqual(after.artifacts, before.artifacts);
    assert.deepEqual(Object.keys(after.requests), Object.keys(before.requests));
    assert.equal(after.requests[body.requestId].hash, before.requests[body.requestId].hash);
    assert.ok(!Object.hasOwn(after.requests[body.requestId].payload.device, 'deviceToken'));
  }
  const retained = await f.job(job.id);
  assert.equal((await f.api(`/api/v1/artifacts/${retained.artifacts[0].id}`, { token: legacyToken })).status, 200);
});

test('unsupported commands are rejected instead of claiming successful work', async (t) => {
  const f = await fixture(t);
  const unsupportedCommand = await f.api('/api/commands', {
    method: 'POST',
    body: { text: '이 연결되지 않은 컴퓨터에서 내 은행 계좌로 송금해', requestId: randomUUID() },
  });
  assert.equal(unsupportedCommand.status, 422);
  const unsupportedJob = await f.api('/api/jobs', {
    method: 'POST', body: { type: 'teleportation', text: 'impossible', requestId: randomUUID() },
  });
  assert.equal(unsupportedJob.status, 422);
});

test('encoded traversal cannot expose runtime files or saved data', async (t) => {
  const f = await fixture(t);
  for (const route of [
    '/api/artifacts/%2e%2e%2fstate.json',
    '/api/artifacts/%2e%2e%2fserver.mjs',
    '/%2e%2e%2fserver.mjs',
    '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  ]) {
    const response = await f.api(route);
    assert.ok(response.status >= 400 && response.status < 500, `${route} returned ${response.status}`);
    assert.ok(!JSON.stringify(response.body).includes(TEST_TOKEN), `${route} exposed the runtime token`);
  }
});

test('retrying a request cannot duplicate a job, and reused IDs cannot change its payload', async (t) => {
  const f = await fixture(t);
  const payload = { type: 'document', title: '재시도 확인', text: '휴대폰에서 같은 요청을 다시 전송했습니다.', requestId: randomUUID() };
  const first = await f.api('/api/jobs', { method: 'POST', body: payload });
  assert.equal(first.status, 201);
  assert.ok(first.body.job.id);
  const retry = await f.api('/api/jobs', { method: 'POST', body: payload });
  assert.equal(retry.status, first.status);
  assert.equal(retry.body.job.id, first.body.job.id);
  const collision = await f.api('/api/jobs', {
    method: 'POST', body: { ...payload, text: '같은 ID로 다른 작업을 요청했습니다.' },
  });
  assert.equal(collision.status, 409);
  await f.stop();
  await f.start();
  const retryAfterRestart = await f.api('/api/jobs', { method: 'POST', body: payload });
  assert.equal(retryAfterRestart.status, first.status);
  assert.equal(retryAfterRestart.body.job.id, first.body.job.id);
});

test('a Korean memory command survives restart and is found from the phone command API', async (t) => {
  const f = await fixture(t);
  const text = '미국 여행 중에는 YENO 문서 작업부터 확인한다.';
  const saved = await f.api('/api/commands', {
    method: 'POST', body: { text: `기억해: ${text}`, requestId: randomUUID() },
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.memory.text, text);
  await f.stop();
  await f.start();
  const found = await f.api('/api/commands', {
    method: 'POST', body: { text: '찾아줘: 미국 여행', requestId: randomUUID() },
  });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.memories.map((memory) => memory.id), [saved.body.memory.id]);
  const noMatch = await f.api(`/api/memory?q=${encodeURIComponent('존재하지 않는 기억')}`);
  assert.equal(noMatch.status, 200);
  assert.deepEqual(noMatch.body.memories, []);
});

test('document completion produces a real downloadable file with verified content and SHA-256', async (t) => {
  const f = await fixture(t);
  const text = '뉴욕에서 휴대폰으로 지시한 실제 문서입니다.\n\n이 결과물은 PC 실행기가 저장합니다.';
  const created = await f.createJob({ text });
  const completed = await f.eventually(() => f.job(created.id), (job) => job.status === 'completed', 'document should complete');
  assert.equal(completed.artifacts.length, 1);
  const artifact = completed.artifacts[0];
  const download = await f.api(`/api/artifacts/${artifact.id}`);
  assert.equal(download.status, 200);
  for (const paragraph of text.split('\n\n')) assert.ok(download.body.includes(paragraph));
  const diskFile = path.join(f.dir, 'artifacts', `${artifact.id}.md`);
  const diskBytes = await readFile(diskFile);
  assert.equal(diskBytes.toString('utf8'), download.body);
  assert.equal(download.headers.get('x-content-sha256'), createHash('sha256').update(diskBytes).digest('hex'));
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal((await f.api(`/api/artifacts/${artifact.id}`, { token: null })).status, 401);
  await writeFile(diskFile, `${download.body}\nUnexpected modification`);
  assert.equal((await f.api(`/api/artifacts/${artifact.id}`)).status, 409, 'changed files must not be presented as verified output');
});

test('pause preserves a real checkpoint, resume completes it once, and cancellation creates no output', async (t) => {
  const f = await fixture(t);
  const created = await f.createJob();
  await f.eventually(() => f.job(created.id), (job) => job.status === 'running', 'job should start');
  const staleAction = await f.api(`/api/jobs/${created.id}/action`, {
    method: 'POST', body: { action: 'pause', revision: created.version },
  });
  assert.equal(staleAction.status, 409, 'an outdated phone screen must refresh before changing a newer job');
  const paused = await f.api(`/api/jobs/${created.id}/action`, { method: 'POST', body: { action: 'pause' } });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.job.status, 'paused');
  const savedStep = paused.body.job.step;
  await sleep(650);
  const stillPaused = await f.job(created.id);
  assert.equal(stillPaused.status, 'paused');
  assert.equal(stillPaused.step, savedStep);
  assert.equal(stillPaused.artifacts.length, 0);
  assert.equal((await f.api(`/api/jobs/${created.id}/action`, { method: 'POST', body: { action: 'resume' } })).status, 200);
  const completed = await f.eventually(() => f.job(created.id), (job) => job.status === 'completed', 'resumed job should complete');
  assert.equal(completed.artifacts.length, 1);
  const cancelled = await f.createJob({ title: '취소할 문서' });
  const cancelledResponse = await f.api(`/api/jobs/${cancelled.id}/action`, { method: 'POST', body: { action: 'cancel' } });
  assert.equal(cancelledResponse.status, 200);
  await sleep(650);
  const finalCancelled = await f.job(cancelled.id);
  assert.equal(finalCancelled.status, 'cancelled');
  assert.equal(finalCancelled.artifacts.length, 0);
  assert.equal((await f.api(`/api/jobs/${cancelled.id}/action`, { method: 'POST', body: { action: 'resume' } })).status, 409);
});

test('emergency stop release only unlocks the runtime and leaves every paused job awaiting individual resume', async (t) => {
  const f = await fixture(t);
  const ownerPaused = await f.createJob({ title: '수동 일시정지' });
  await f.api(`/api/jobs/${ownerPaused.id}/action`, { method: 'POST', body: { action: 'pause' } });
  const active = await f.createJob({ title: '실행 중 작업' });
  const queued = await f.createJob({ title: '대기 작업' });
  await f.eventually(() => f.job(active.id), (job) => job.status === 'running', 'first work should run');
  assert.equal((await f.job(queued.id)).status, 'queued');
  const preStopRevision = (await f.state()).revision;
  const stopped = await f.api('/api/control', { method: 'POST', body: { action: 'stop' } });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.emergencyStop, true);
  await sleep(650);
  for (const id of [active.id, queued.id, ownerPaused.id]) {
    const stoppedJob = await f.job(id);
    assert.equal(stoppedJob.status, 'paused');
    assert.equal(stoppedJob.artifacts.length, 0);
  }
  assert.equal((await f.api('/api/jobs', { method: 'POST', body: { type: 'diagnostics' } })).status, 409);
  assert.equal((await f.api(`/api/jobs/${active.id}/action`, { method: 'POST', body: { action: 'resume' } })).status, 409);
  assert.equal((await f.api('/api/control', { method: 'POST', body: { action: 'resume', revision: preStopRevision } })).status, 409, 'a stale phone must not reverse a newer emergency stop');
  assert.equal((await f.state()).emergencyStop, true);
  const frozenJobs = new Map();
  for (const id of [active.id, queued.id, ownerPaused.id]) frozenJobs.set(id, await f.job(id));
  assert.equal((await f.api('/api/control', { method: 'POST', body: { action: 'resume' } })).status, 200);
  assert.equal((await f.state()).emergencyStop, false);
  await sleep(900);
  for (const id of [active.id, queued.id, ownerPaused.id]) {
    const unchanged = await f.job(id);
    assert.deepEqual(unchanged, frozenJobs.get(id), 'unlocking must not advance a checkpoint, change a job version, or produce output');
    assert.equal(unchanged.status, 'paused');
    assert.equal(unchanged.artifacts.length, 0);
  }
  assert.equal((await f.api(`/api/jobs/${active.id}/action`, { method: 'POST', body: { action: 'resume' } })).status, 200);
  await f.eventually(() => f.job(active.id), (job) => job.status === 'completed', 'an explicitly resumed job should finish after unlocking');
  assert.deepEqual(await f.job(queued.id), frozenJobs.get(queued.id), 'resuming one job must leave another emergency-paused job unchanged');
  assert.deepEqual(await f.job(ownerPaused.id), frozenJobs.get(ownerPaused.id), 'the owner’s individual pause must remain unchanged');
});

test('module switches stop their work and the scheduler enforces the selected concurrency limit', async (t) => {
  const f = await fixture(t);
  const disabled = await f.api('/api/settings', { method: 'POST', body: { modules: { documents: false } } });
  assert.equal(disabled.status, 200);
  assert.equal((await f.api('/api/jobs', { method: 'POST', body: { type: 'document', text: '꺼진 기능' } })).status, 409);
  const unsupportedConcurrency = await f.api('/api/settings', { method: 'POST', body: { concurrency: 48 } });
  assert.equal(unsupportedConcurrency.status, 400);
  assert.equal((await f.api('/api/settings', { method: 'POST', body: { concurrency: 1.5 } })).status, 400);
  assert.equal((await f.api('/api/settings', { method: 'POST', body: { concurrency: 0 } })).status, 400);
  assert.equal((await f.api('/api/settings', { method: 'POST', body: { modules: { documents: true }, concurrency: 2 } })).status, 200);
  const jobs = [];
  for (let index = 0; index < 5; index++) jobs.push(await f.createJob({ title: `동시 실행 ${index + 1}` }));
  let observedTwo = false;
  await f.eventually(() => f.state(), (state) => {
    const running = state.jobs.filter((job) => job.status === 'running').length;
    assert.ok(running <= 2, `configured limit 2, observed ${running} running jobs`);
    if (running === 2) observedTwo = true;
    return jobs.every((item) => state.jobs.find((job) => job.id === item.id)?.status === 'completed');
  }, 'all bounded parallel work should complete');
  assert.ok(observedTwo, 'increasing concurrency should actually enable two running jobs');
  const active = await f.createJob({ title: '기능 해제 시 멈추는 문서' });
  await f.eventually(() => f.job(active.id), (job) => job.status === 'running', 'job should be active before module disable');
  await f.api('/api/settings', { method: 'POST', body: { modules: { documents: false } } });
  await sleep(600);
  assert.equal((await f.job(active.id)).status, 'paused');
  assert.equal((await f.job(active.id)).artifacts.length, 0);
});

test('restart preserves interrupted work without silently replaying it', async (t) => {
  const f = await fixture(t);
  const created = await f.createJob();
  await f.eventually(() => f.job(created.id), (job) => job.status === 'running', 'job should run before restart');
  // Simulate loss of the process without letting graceful shutdown persist a pause.
  await f.stop('SIGKILL');
  await f.start();
  await sleep(650);
  const interrupted = await f.job(created.id);
  assert.equal(interrupted.status, 'paused');
  assert.equal(interrupted.artifacts.length, 0);
  assert.equal((await f.api(`/api/jobs/${created.id}/action`, { method: 'POST', body: { action: 'resume' } })).status, 200);
  const completed = await f.eventually(() => f.job(created.id), (job) => job.status === 'completed', 'owner-resumed interrupted work should finish');
  assert.equal(completed.artifacts.length, 1);
});

test('opening the launcher twice cannot start a second writer or modify the first runtime state', async (t) => {
  const f = await fixture(t);
  await f.api('/api/memory', { method: 'POST', body: { text: '중복 실행에서도 보존할 기억' } });
  const before = await f.state();
  const duplicate = spawn(process.execPath, ['server.mjs'], {
    cwd: runtimeRoot,
    env: { ...process.env, YENO_PORT: '0', YENO_HOST: '127.0.0.1', YENO_DATA_DIR: f.dir, YENO_TOKEN: TEST_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  duplicate.stdout.resume();
  duplicate.stderr.resume();
  t.after(() => { if (duplicate.exitCode === null) duplicate.kill('SIGKILL'); });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      duplicate.kill('SIGKILL');
      reject(new Error('duplicate launch should be rejected before another server starts'));
    }, 2000);
    duplicate.once('error', (error) => { clearTimeout(timer); reject(error); });
    duplicate.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.notEqual(exitCode, 0);
  const after = await f.state();
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.memories, before.memories);
  assert.deepEqual(after.events, before.events);
});

test('snapshot restore recovers memory and settings while retaining audit, results, retry protection and a recovery point', async (t) => {
  const f = await fixture(t);
  const oldMemory = await f.api('/api/memory', { method: 'POST', body: { text: '복원 기준 기억' } });
  const snapshot = await f.api('/api/snapshots', { method: 'POST', body: { label: '여행 시작 전' } });
  assert.equal(snapshot.status, 201);
  const snapshotId = snapshot.body.snapshot.id;
  const newMemory = await f.api('/api/memory', { method: 'POST', body: { text: '복원 직전 추가 기억' } });
  await f.api('/api/settings', { method: 'POST', body: { concurrency: 2 } });
  const jobPayload = { type: 'document', title: '복원 뒤에도 남는 결과', text: '이미 수행한 작업은 복원으로 다시 실행하지 않습니다.', requestId: randomUUID() };
  const jobResponse = await f.api('/api/jobs', { method: 'POST', body: jobPayload });
  assert.equal(jobResponse.status, 201);
  const blockedRestore = await f.api(`/api/snapshots/${snapshotId}/restore`, { method: 'POST', body: { confirm: true } });
  assert.equal(blockedRestore.status, 409, 'restore must require active work to be paused');
  await f.eventually(() => f.job(jobResponse.body.job.id), (job) => job.status === 'completed', 'pre-restore document should finish');
  const before = await f.state();
  const restored = await f.api(`/api/snapshots/${snapshotId}/restore`, { method: 'POST', body: { confirm: true } });
  assert.equal(restored.status, 200);
  assert.ok(restored.body.preRestoreSnapshot.id);
  assert.notEqual(restored.body.preRestoreSnapshot.id, snapshotId);
  const after = await f.state();
  assert.equal(after.concurrency, 1);
  assert.ok(after.memories.some((memory) => memory.id === oldMemory.body.memory.id));
  assert.ok(!after.memories.some((memory) => memory.id === newMemory.body.memory.id));
  assert.ok(before.events.every((event) => after.events.some((item) => item.id === event.id)), 'restore should retain audit events');
  assert.ok(after.jobs.every((job) => !['running', 'queued'].includes(job.status)), 'restore cannot replay tasks');
  assert.equal(after.jobs.length, before.jobs.length);
  const retainedJob = after.jobs.find((job) => job.id === jobResponse.body.job.id);
  assert.equal(retainedJob.status, 'completed');
  assert.equal((await f.api(`/api/artifacts/${retainedJob.artifacts[0].id}`)).status, 200);
  const retry = await f.api('/api/jobs', { method: 'POST', body: jobPayload });
  assert.equal(retry.status, 201);
  assert.equal(retry.body.job.id, retainedJob.id, 'restore must retain post-snapshot request IDs');
  const recovery = await f.api(`/api/snapshots/${restored.body.preRestoreSnapshot.id}/restore`, { method: 'POST', body: { confirm: true } });
  assert.equal(recovery.status, 200);
  const recovered = await f.state();
  assert.equal(recovered.concurrency, 2);
  assert.ok(recovered.memories.some((memory) => memory.id === newMemory.body.memory.id), 'automatic pre-restore snapshot must actually recover the later memory');
});

test('the optional AI adapter calls a local provider, aborts paused work, and saves only the resumed response', async (t) => {
  const requests = [];
  let firstResponse;
  let firstRequestAborted = false;
  const provider = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, path: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    if (requests.length === 1) {
      firstResponse = response;
      response.once('close', () => { firstRequestAborted = !response.writableFinished; });
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '재개 후 새로 받은 AI 초안입니다.' } }] }));
  });
  await new Promise((resolve, reject) => {
    provider.once('error', reject);
    provider.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  });
  const f = await fixture(t, {
    YENO_AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
    YENO_AI_MODEL: 'fixture-model',
    YENO_AI_API_KEY: 'fixture-key',
  });
  assert.equal((await f.state()).ai.configured, true);
  assert.equal(requests.length, 0, 'configuration alone must not contact the provider');
  const enabled = await f.api('/api/settings', { method: 'POST', body: { modules: { ai: true } } });
  assert.equal(enabled.status, 200);
  const text = '미국 여행 중 YENO 제작 일정을 세 문장으로 작성해줘.';
  const created = await f.createJob({ type: 'ai', title: '실제 AI 어댑터 확인', text });
  await f.eventually(() => requests.length, (count) => count === 1, 'AI job should reach the local provider');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/v1/chat/completions');
  assert.equal(requests[0].authorization, 'Bearer fixture-key');
  assert.equal(requests[0].body.model, 'fixture-model');
  assert.ok(requests[0].body.messages.some((message) => message.role === 'user' && message.content === text));
  const paused = await f.api(`/api/jobs/${created.id}/action`, { method: 'POST', body: { action: 'pause' } });
  assert.equal(paused.status, 200);
  await f.eventually(() => firstRequestAborted, Boolean, 'pausing an in-flight AI job should abort its provider request');
  firstResponse.end(JSON.stringify({ choices: [{ message: { content: 'STALE RESPONSE MUST NOT BE SAVED' } }] }));
  await sleep(300);
  assert.equal((await f.job(created.id)).status, 'paused');
  assert.equal((await f.job(created.id)).artifacts.length, 0);
  assert.equal((await f.api(`/api/jobs/${created.id}/action`, { method: 'POST', body: { action: 'resume' } })).status, 200);
  const completed = await f.eventually(() => f.job(created.id), (job) => job.status === 'completed', 'resumed AI work should complete with a fresh request');
  assert.equal(requests.length, 2);
  assert.equal(completed.artifacts.length, 1);
  const download = await f.api(`/api/artifacts/${completed.artifacts[0].id}`);
  assert.equal(download.status, 200);
  assert.ok(download.body.includes('재개 후 새로 받은 AI 초안입니다.'));
  assert.ok(download.body.includes('fixture-model'));
  assert.ok(!download.body.includes('STALE RESPONSE MUST NOT BE SAVED'));
  assert.ok(!download.body.includes('fixture-key'));
  assert.equal(download.headers.get('x-content-sha256'), createHash('sha256').update(download.body).digest('hex'));
});
