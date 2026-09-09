import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const runtimeDir = fileURLToPath(new URL('..', import.meta.url));
const source = path.resolve(runtimeDir, '..');
const dockerfile = fs.readFileSync(path.join(source, 'Dockerfile'), 'utf8');
const launcher = dockerfile.match(/COPY <<'EOF' \/opt\/yeno\/container-start\.mjs\n([\s\S]*?)\nEOF/)[1];
const entrypoint = JSON.parse(dockerfile.match(/^ENTRYPOINT (.+)$/m)[1]);
const healthcheck = JSON.parse(dockerfile.match(/^\s+CMD (\[.+\])$/m)[1]);
const skip = process.platform !== 'linux' || spawnSync('flock', ['--version']).status !== 0
  ? 'Linux with util-linux flock is required for kernel lease integration tests.' : false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(read, accept, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(20);
  }
  assert.fail(message);
}

function snapshot(directory) {
  return fs.readdirSync(directory).sort().map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    return [name, stat.isDirectory() ? snapshot(file)
      : stat.isSymbolicLink() ? ['symlink', fs.readlinkSync(file)] : fs.readFileSync(file).toString('base64')];
  });
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-container-lease-'));
  const dataDir = path.join(directory, 'data');
  fs.mkdirSync(dataDir, { mode: 0o700 });
  fs.symlinkSync(runtimeDir, path.join(directory, 'runtime'), 'dir');
  const launcherPath = path.join(directory, 'container-start.mjs');
  fs.writeFileSync(launcherPath, launcher);
  const token = randomBytes(32).toString('base64url');
  const tokenFile = path.join(directory, 'pairing-token');
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o400 });
  const guard = path.join(dataDir, '.container-runtime.flock');
  const env = {
    PATH: process.env.PATH, YENO_DATA_DIR: dataDir, YENO_HOST: '127.0.0.1',
    YENO_PORT: '0', YENO_TOKEN_FILE: tokenFile, YENO_ALLOWED_HOSTS: 'core.example.net',
    YENO_AI_BASE_URL: '', YENO_AI_MODEL: '', YENO_AI_API_KEY: '',
  };
  const children = [];
  t.after(async () => {
    for (const child of children) if (!child.result) child.process.kill('SIGKILL');
    await Promise.all(children.map(child => child.done));
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function launch({ kind = 'packaged', prelude = '', after = '' } = {}) {
    let script = launcherPath;
    if (prelude || after) {
      script = path.join(directory, `${randomUUID()}.mjs`);
      fs.writeFileSync(script, `${prelude}\nawait import(${JSON.stringify(pathToFileURL(launcherPath).href)});\n${after}\n`);
    }
    let executable = entrypoint[0];
    let args = entrypoint.slice(1).map(value => value.replaceAll('/opt/yeno/container-start.mjs', script));
    if (kind === 'direct') { executable = process.execPath; args = [script]; }
    if (kind === 'shared') args = args.map(value => value.replace('--exclusive', '--shared'));
    if (kind === 'wrong-file') args = args.map(value => value.replace('$YENO_DATA_DIR/.container-runtime.flock', `${directory}/wrong.flock`));
    const child = { process: spawn(executable, args, { env }), logs: '', result: null };
    child.process.stdout.on('data', value => { child.logs += value; });
    child.process.stderr.on('data', value => { child.logs += value; });
    child.done = new Promise((resolve, reject) => {
      child.process.once('error', reject);
      child.process.once('exit', (code, signal) => { child.result = { code, signal }; resolve(child.result); });
    });
    children.push(child);
    return child;
  }

  async function boot(options) {
    const child = launch(options);
    const port = await eventually(() => {
      if (child.result) assert.fail(`Packaged core exited before ready: ${child.logs}`);
      return child.logs.match(/YENO core ready on port (\d+)/)?.[1];
    }, Boolean, 'Packaged core did not become ready.');
    const base = `http://127.0.0.1:${port}`;
    async function api(route, { method = 'GET', credential, body } = {}) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      let value;
      try { value = JSON.parse(text); } catch { value = text; }
      return { status: response.status, body: value };
    }
    return { ...child, child, base, port, api };
  }

  return { directory, dataDir, guard, token, env, launch, boot };
}

test('packaged kernel lease survives SIGKILL and preserves device auth, memory, receipts and artifacts', { skip }, async t => {
  const f = fixture(t);
  const first = await f.boot();
  assert.equal((await first.api('/api/v1/health')).status, 200);
  assert.equal((await first.api('/api/v1/state')).status, 401);
  const health = spawnSync(healthcheck[0], healthcheck.slice(1), { env: { ...f.env, YENO_PORT: first.port } });
  assert.equal(health.status, 0, 'Exact Docker healthcheck should pass without credentials.');
  const enrolled = await first.api('/api/v1/devices/enroll', {
    method: 'POST', credential: f.token,
    body: { name: 'Lease test', platform: 'test', requestId: randomUUID() },
  });
  assert.equal(enrolled.status, 201);
  const credential = enrolled.body.device.deviceToken;
  const memoryBody = { text: 'Memory survives an abrupt core exit.', requestId: randomUUID() };
  const memory = await first.api('/api/v1/memory', { method: 'POST', credential, body: memoryBody });
  assert.equal(memory.status, 201);
  const created = await first.api('/api/v1/jobs', {
    method: 'POST', credential,
    body: { type: 'document', text: 'A real persistent artifact.', requestId: randomUUID() },
  });
  const completed = await eventually(async () => (await first.api('/api/v1/state', { credential })).body.jobs.find(job => job.id === created.body.job.id), job => job.status === 'completed', 'Document did not complete.');
  const artifactPath = `/api/v1/artifacts/${completed.artifacts[0].id}`;
  const artifact = await first.api(artifactPath, { credential });
  assert.equal(artifact.status, 200);
  assert.match(artifact.body, /A real persistent artifact\./);

  const beforeDuplicate = snapshot(f.dataDir);
  assert.equal((await f.launch().done).code, 1, 'Another packaged writer must fail at flock.');
  assert.deepEqual(snapshot(f.dataDir), beforeDuplicate);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'runtime.lock')), false, 'Verified container mode must not leave a PID lock.');
  const guardInode = fs.statSync(f.guard, { bigint: true }).ino;
  const pending = await first.api('/api/v1/jobs', {
    method: 'POST', credential,
    body: { type: 'document', text: 'Require explicit resume after crash.', requestId: randomUUID() },
  });
  first.process.kill('SIGKILL');
  assert.equal((await first.done).signal, 'SIGKILL', 'This must be an actual ungraceful process termination.');

  const second = await f.boot();
  assert.equal(fs.statSync(f.guard, { bigint: true }).ino, guardInode, 'Guard inode must survive crash/restart.');
  const state = await second.api('/api/v1/state', { credential });
  assert.equal(state.status, 200, 'Existing device bearer must remain valid.');
  assert.equal(state.body.memories.filter(value => value.id === memory.body.memory.id).length, 1);
  assert.equal(state.body.jobs.find(job => job.id === pending.body.job.id).status, 'paused');
  assert.equal(state.body.jobs.find(job => job.id === pending.body.job.id).pauseReason, 'restart');
  const retry = await second.api('/api/v1/memory', { method: 'POST', credential, body: memoryBody });
  assert.equal(retry.body.memory.id, memory.body.memory.id, 'Retry receipt must remain durable.');
  assert.deepEqual(await second.api(artifactPath, { credential }), artifact);
  assert.equal(state.body.ai.configured, false);
  assert.equal(first.child.logs.includes(f.token) || second.child.logs.includes(f.token), false);
  assert.equal(first.child.logs.includes(credential) || second.child.logs.includes(credential), false);
  second.process.kill('SIGTERM');
  assert.equal((await second.done).code, 0);
  const third = await f.boot();
  assert.equal((await third.api('/api/v1/state', { credential })).status, 200, 'Normal restart must also work.');
});

for (const kind of ['direct', 'shared', 'wrong-file', 'unlocked-descriptor', 'symlink']) {
  test(`container lease rejects ${kind} guard before modifying state`, { skip }, async t => {
    const f = fixture(t);
    const stateFile = path.join(f.dataDir, 'state.json');
    fs.writeFileSync(stateFile, 'Opaque existing state must not be read or rewritten.');
    if (kind === 'symlink') {
      const target = path.join(f.directory, 'linked.flock');
      fs.writeFileSync(target, '');
      fs.symlinkSync(target, f.guard);
    } else fs.writeFileSync(f.guard, '', { mode: 0o600 });
    const before = snapshot(f.dataDir);
    const child = f.launch(kind === 'unlocked-descriptor' ? {
      kind: 'direct', prelude: `import fs from 'node:fs'; fs.openSync(${JSON.stringify(f.guard)}, 'r');`,
    } : { kind: kind === 'symlink' ? 'packaged' : kind });
    assert.equal((await child.done).code, 1);
    assert.match(child.logs, /container flock could not be verified|guard must be a regular file/);
    assert.deepEqual(snapshot(f.dataDir), before);
  });
}

test('a verified container lease refuses legacy runtime.lock without deleting or rewriting data', { skip }, async t => {
  const f = fixture(t);
  fs.writeFileSync(f.guard, '', { mode: 0o600 });
  fs.writeFileSync(path.join(f.dataDir, 'state.json'), 'Preserve the existing state.');
  fs.writeFileSync(path.join(f.dataDir, 'runtime.lock'), JSON.stringify({ pid: 1, nonce: 'legacy-owner' }));
  const before = snapshot(f.dataDir);
  const child = f.launch();
  assert.equal((await child.done).code, 1);
  assert.match(child.logs, /legacy runtime.lock remains/);
  assert.deepEqual(snapshot(f.dataDir), before);
});

test('bare and repeated in-process starts cannot share a container-owned store, including worker threads', { skip }, async t => {
  const f = fixture(t);
  const serverURL = pathToFileURL(path.join(runtimeDir, 'server.mjs')).href;
  const workerPath = path.join(f.directory, 'worker.mjs');
  fs.writeFileSync(workerPath, `import { parentPort } from 'node:worker_threads';
import { start } from ${JSON.stringify(serverURL)};
try { await start({containerLease:true}); parentPort.postMessage('unexpected success'); }
catch (error) { parentPort.postMessage(error.message); }
`);
  const running = await f.boot({ after: `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { start } from ${JSON.stringify(serverURL)};
const file = process.env.YENO_DATA_DIR + '/state.json';
const before = fs.readFileSync(file);
await assert.rejects(start({ containerLease:true }), /already claimed/);
await assert.rejects(start({ containerLease:'true' }), /requires the verified container lease/);
await assert.rejects(start(), /requires the verified container lease/);
const worker = new Worker(${JSON.stringify(workerPath)});
const message = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
assert.match(message, /only be claimed by the main thread/);
assert.deepEqual(fs.readFileSync(file), before);
console.log('COMPETING_STARTS_REJECTED');
` });
  await eventually(() => running.child.logs, value => value.includes('COMPETING_STARTS_REJECTED'), 'Competing starts were not safely rejected.');
});

test('default PID locking detects a container marker created during its own lock acquisition', { skip }, async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dataDir, 'state.json'), 'Existing state remains opaque on a failed guard.');
  const serverURL = pathToFileURL(path.join(runtimeDir, 'server.mjs')).href;
  const script = path.join(f.directory, 'startup-race.mjs');
  fs.writeFileSync(script, `
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { start } from ${JSON.stringify(serverURL)};
const open = fs.openSync;
fs.openSync = function(file, ...args) {
  const fd = open.call(this, file, ...args);
  if (file === process.env.YENO_DATA_DIR + '/runtime.lock') {
    const marker = open(process.env.YENO_DATA_DIR + '/.container-runtime.flock', 'wx', 0o600);
    fs.closeSync(marker);
  }
  return fd;
};
await assert.rejects(start(), /requires the verified container lease/);
assert.equal(fs.existsSync(process.env.YENO_DATA_DIR + '/runtime.lock'), false);
`);
  const result = spawnSync(process.execPath, [script], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(f.dataDir, 'state.json'), 'utf8'), 'Existing state remains opaque on a failed guard.');
  assert.equal(fs.existsSync(path.join(f.dataDir, 'runtime.lock')), false, 'Only the just-created own PID lock should be released.');
});
