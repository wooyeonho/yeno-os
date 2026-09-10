import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { koyebConfig } from '../lib/koyeb-config.mjs';

const source = fileURLToPath(new URL('../../', import.meta.url));
const skip = process.platform !== 'linux' || spawnSync('flock', ['--version']).status !== 0
  ? 'Linux with util-linux flock is required.' : false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Koyeb config maps the assigned hostname and port with an isolated volume data directory', () => {
  const env = { KOYEB_SERVICE_ID: 'fixture-service', KOYEB_PUBLIC_DOMAIN: 'yeno-fixture-gyeol.koyeb.app' };
  const config = koyebConfig(env);
  assert.equal(config.env.YENO_HOST, '0.0.0.0');
  assert.equal(config.env.YENO_PORT, '8790');
  assert.equal(config.env.YENO_ALLOWED_HOSTS, env.KOYEB_PUBLIC_DOMAIN);
  assert.equal(config.diskRoot, '/var/lib/yeno');
  assert.equal(config.dataDir, '/var/lib/yeno/data');
  assert.equal(koyebConfig({ ...env, PORT: '12000', YENO_PORT: '12000' }).env.YENO_PORT, '12000');
  assert.equal(koyebConfig({ ...env, YENO_ALLOWED_HOSTS: 'core.example.net' }).env.YENO_ALLOWED_HOSTS, `core.example.net,${env.KOYEB_PUBLIC_DOMAIN}`);
  for (const change of [
    { KOYEB_SERVICE_ID: '' }, { KOYEB_PUBLIC_DOMAIN: '' },
    { KOYEB_PUBLIC_DOMAIN: 'https://yeno-fixture-gyeol.koyeb.app' },
    { KOYEB_PUBLIC_DOMAIN: 'attacker.example.net' },
    { KOYEB_PUBLIC_DOMAIN: '*.koyeb.app' }, { YENO_ALLOWED_HOSTS: '*.example.net' },
    { PORT: '0' }, { PORT: '65536' }, { PORT: '8790x' },
    { PORT: '8000', YENO_PORT: '8790' },
    { YENO_DISK_MOUNT_PATH: '/' }, { YENO_DISK_MOUNT_PATH: 'relative' },
    { YENO_DATA_DIR: '/tmp/ephemeral' }, { YENO_DATA_DIR: '/var/lib/yeno' },
  ]) assert.throws(() => koyebConfig({ ...env, ...change }));
});

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-koyeb-launch-'));
  const diskRoot = path.join(directory, 'volume');
  fs.mkdirSync(diskRoot, { mode: 0o700 });
  const dataDir = path.join(diskRoot, 'data');
  const mountInfo = `1 0 8:1 / ${diskRoot} rw,relatime - ext4 /dev/test-disk rw\n`;
  const preload = path.join(directory, 'mount-fixture.mjs');
  const permissionPreload = path.join(directory, 'permission-fixture.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  if (file === '/proc/self/mountinfo') return ${JSON.stringify(mountInfo)};
  return read.call(this, file, ...args);
};\n`);
  fs.writeFileSync(permissionPreload, `import ${JSON.stringify(pathToFileURL(preload).href)};
import fs from 'node:fs';
const access = fs.accessSync;
fs.accessSync = function(file, ...args) {
  if (file === ${JSON.stringify(diskRoot)}) throw Object.assign(new Error('fixture EACCES'), {code:'EACCES'});
  return access.call(this, file, ...args);
};\n`);
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const token = randomBytes(32).toString('base64url');
  const env = {
    PATH: process.env.PATH, KOYEB_SERVICE_ID: 'fixture-service', KOYEB_PUBLIC_DOMAIN: 'yeno-fixture-gyeol.koyeb.app',
    PORT: String(port), YENO_PORT: String(port), YENO_DISK_MOUNT_PATH: diskRoot, YENO_DATA_DIR: dataDir, YENO_TOKEN: token,
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
  };
  const children = [];
  t.after(async () => {
    for (const child of children) if (!child.result) child.process.kill('SIGKILL');
    await Promise.all(children.map(child => child.done));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  function launch(change = {}) {
    const child = { process: spawn('/bin/sh', ['scripts/start-koyeb.sh'], { cwd: source, env: { ...env, ...change } }), logs: '', result: null };
    child.process.stdout.on('data', value => { child.logs += value; });
    child.process.stderr.on('data', value => { child.logs += value; });
    child.done = new Promise((resolve, reject) => {
      child.process.once('error', reject);
      child.process.once('exit', (code, signal) => { child.result = { code, signal }; resolve(child.result); });
    });
    children.push(child);
    return child;
  }
  async function boot() {
    const child = launch();
    for (let attempt = 0; attempt < 250; attempt++) {
      if (child.result) assert.fail(`Koyeb launcher stopped: ${child.logs}`);
      if (child.logs.includes(`YENO core ready on port ${port}`)) return child;
      await pause(20);
    }
    assert.fail('Koyeb launcher did not become ready.');
  }
  async function api(route, { credential, body, host = env.KOYEB_PUBLIC_DOMAIN } = {}) {
    return await new Promise((resolve, reject) => {
      const request = http.request(`http://127.0.0.1:${port}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { host, ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      }, response => {
        const chunks = [];
        response.on('data', value => chunks.push(value));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let value;
          try { value = JSON.parse(raw); } catch { value = raw; }
          resolve({ status: response.statusCode, body: value });
        });
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end(body ? JSON.stringify(body) : undefined);
    });
  }
  return { directory, diskRoot, dataDir, env, token, permissionPreload, launch, boot, api };
}

test('exact Koyeb launcher preserves device auth, command receipt and real result across SIGKILL with fixture mount metadata', { skip }, async t => {
  const f = await fixture(t);
  const first = await f.boot();
  assert.equal((await f.api('/api/v1/health')).status, 200);
  assert.equal((await f.api('/api/v1/health', { host: 'wrong.example.net' })).status, 403);
  assert.equal((await f.api('/api/v1/state')).status, 401);
  const enrolled = await f.api('/api/v1/devices/enroll', { credential: f.token, body: { name: 'Koyeb launcher', platform: 'test', requestId: randomUUID() } });
  assert.equal(enrolled.status, 201);
  const credential = enrolled.body.device.deviceToken;
  const body = { text: '문서 만들어: A persistent Koyeb candidate result.', requestId: randomUUID() };
  const saved = await f.api('/api/v1/commands', { credential, body });
  assert.equal(saved.status, 201);
  let completed;
  for (let attempt = 0; attempt < 250; attempt++) {
    const state = await f.api('/api/v1/state', { credential });
    completed = state.body.jobs.find(job => job.id === saved.body.job.id);
    if (completed?.status === 'completed') break;
    await pause(20);
  }
  assert.equal(completed.status, 'completed');
  const artifactPath = `/api/v1/artifacts/${completed.artifacts[0].id}`;
  const artifact = await f.api(artifactPath, { credential });
  assert.equal(artifact.status, 200);
  assert.match(artifact.body, /A persistent Koyeb candidate result\./);
  assert.equal((await f.launch().done).code, 1, 'A second launcher cannot write the same volume.');
  first.process.kill('SIGKILL');
  assert.equal((await first.done).signal, 'SIGKILL');
  const second = await f.boot();
  assert.deepEqual(await f.api('/api/v1/commands', { credential, body }), saved);
  assert.deepEqual(await f.api(artifactPath, { credential }), artifact);
  assert.equal((await f.api('/api/v1/state', { credential })).body.ai.configured, false);
  assert.equal(fs.existsSync(path.join(f.dataDir, 'runtime.lock')), false);
  for (const logs of [first.logs, second.logs]) {
    assert.equal(logs.includes(f.token), false);
    assert.equal(logs.includes(credential), false);
  }
  second.process.kill('SIGTERM');
  assert.equal((await second.done).code, 0);
});

test('Koyeb launcher rejects missing volume, credentials, mismatched port, mixed provider and nonwritable mount before data creation', { skip }, async t => {
  const f = await fixture(t);
  for (const change of [
    { YENO_DISK_MOUNT_PATH: path.join(f.directory, 'absent'), YENO_DATA_DIR: path.join(f.directory, 'absent', 'data') },
    { NODE_OPTIONS: '' }, { KOYEB_SERVICE_ID: '' }, { KOYEB_PUBLIC_DOMAIN: '' },
    { YENO_TOKEN: '' }, { YENO_TOKEN: 'short' }, { YENO_PORT: '8790', PORT: '8000' },
    { RENDER: 'true', RENDER_EXTERNAL_HOSTNAME: 'other.onrender.com' },
  ]) {
    const child = f.launch(change);
    assert.equal((await child.done).code, 1);
    assert.equal(fs.existsSync(f.dataDir), false);
    assert.equal(child.logs.includes(f.token), false);
  }
  // EACCES is injected: this environment cannot run a UID1000 container. The
  // actual Koyeb mount ownership remains a deployment acceptance requirement.
  const denied = f.launch({ NODE_OPTIONS: `--import=${pathToFileURL(f.permissionPreload).href}` });
  assert.equal((await denied.done).code, 1);
  assert.match(denied.logs, /not writable by the service user/);
  assert.equal(fs.existsSync(f.dataDir), false);
  assert.deepEqual(fs.readdirSync(f.diskRoot), []);
});
