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
import { renderConfig, verifyRenderDisk } from '../lib/render-config.mjs';

const source = fileURLToPath(new URL('../../', import.meta.url));
const skip = process.platform !== 'linux' || spawnSync('flock', ['--version']).status !== 0
  ? 'Linux with util-linux flock is required.' : false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const mountLine = root => `1 0 8:1 / ${root.replaceAll(' ', '\\040')} rw,relatime - ext4 /dev/test-disk rw\n`;

test('Render config maps platform hostname and PORT while rejecting malformed settings', () => {
  const env = { RENDER: 'true', RENDER_EXTERNAL_HOSTNAME: 'yeno-test.onrender.com', PORT: '12000' };
  const config = renderConfig(env);
  assert.equal(config.env.YENO_ALLOWED_HOSTS, 'yeno-test.onrender.com');
  assert.equal(config.env.YENO_HOST, '0.0.0.0');
  assert.equal(config.env.YENO_PORT, '12000');
  assert.equal(config.dataDir, '/var/data/yeno');
  assert.equal(renderConfig({ ...env, PORT: undefined }).env.YENO_PORT, '10000');
  assert.equal(renderConfig({ ...env, YENO_ALLOWED_HOSTS: 'core.example.net,yeno-test.onrender.com' }).env.YENO_ALLOWED_HOSTS, 'core.example.net,yeno-test.onrender.com');
  assert.equal(renderConfig({ ...env, YENO_ALLOWED_HOSTS: 'core.example.net' }).env.YENO_ALLOWED_HOSTS, 'core.example.net,yeno-test.onrender.com');
  for (const change of [
    { RENDER: undefined }, { RENDER: 'false' }, { RENDER_EXTERNAL_HOSTNAME: undefined },
    { RENDER_EXTERNAL_HOSTNAME: 'https://yeno-test.onrender.com' }, { RENDER_EXTERNAL_HOSTNAME: 'attacker.example.net' },
    { YENO_ALLOWED_HOSTS: '*.example.net' }, { YENO_ALLOWED_HOSTS: 'core.example.net/path' },
    { PORT: '0' }, { PORT: '65536' }, { PORT: '10000x' },
    { YENO_DISK_MOUNT_PATH: '/' }, { YENO_DISK_MOUNT_PATH: 'relative' },
    { YENO_DATA_DIR: '/tmp/ephemeral' }, { YENO_DATA_DIR: '/var/data' },
  ]) assert.throws(() => renderConfig({ ...env, ...change }));
});

test('Render disk verification rejects absent, ephemeral, read-only, network and symlink paths', { skip }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-mount-check-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { diskRoot: directory, dataDir: path.join(directory, 'yeno') };
  // Positive mount metadata is a fixture; no local directory is represented as
  // an actual persistent Render disk in this test or in deployment evidence.
  assert.doesNotThrow(() => verifyRenderDisk(config, mountLine(directory)));
  assert.throws(() => verifyRenderDisk(config), /separately mounted/);
  assert.throws(() => verifyRenderDisk({ ...config, diskRoot: path.join(directory, 'missing') }), /does not exist/);
  for (const filesystem of ['tmpfs', 'overlay', 'nfs4', 'cifs', 'virtiofs']) {
    assert.throws(() => verifyRenderDisk(config, mountLine(directory).replace(' ext4 ', ` ${filesystem} `)), /separately mounted/);
  }
  assert.throws(() => verifyRenderDisk(config, mountLine(directory).replace(' rw,relatime ', ' ro,relatime ')), /separately mounted/);
  const nestedMount = mountLine(directory) + `2 1 0:2 / ${directory}/yeno rw - tmpfs tmpfs rw\n`;
  assert.throws(() => verifyRenderDisk(config, nestedMount), /nested mount/);
  fs.symlinkSync(os.tmpdir(), path.join(directory, 'escape'), 'dir');
  assert.throws(() => verifyRenderDisk({ ...config, dataDir: path.join(directory, 'escape', 'yeno') }, mountLine(directory)), /symlink components/);
  assert.throws(() => verifyRenderDisk({ diskRoot: '/dev/shm', dataDir: '/dev/shm/yeno-unused' }), /separately mounted/, 'An actual tmpfs mount must be rejected.');
  assert.equal(fs.existsSync(config.dataDir), false, 'Validation alone must not create state.');
});

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yeno-render-launch-'));
  const diskRoot = path.join(directory, 'disk');
  fs.mkdirSync(diskRoot, { mode: 0o700 });
  const dataDir = path.join(diskRoot, 'yeno');
  const preload = path.join(directory, 'mount-fixture.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  if (file === '/proc/self/mountinfo') return ${JSON.stringify(mountLine(diskRoot))};
  return read.call(this, file, ...args);
};\n`);
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const token = randomBytes(32).toString('base64url');
  const env = {
    PATH: process.env.PATH, RENDER: 'true', RENDER_EXTERNAL_HOSTNAME: 'yeno-test.onrender.com',
    PORT: String(port), YENO_DISK_MOUNT_PATH: diskRoot, YENO_DATA_DIR: dataDir, YENO_TOKEN: token,
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
  };
  const children = [];
  t.after(async () => {
    for (const child of children) if (!child.result) child.process.kill('SIGKILL');
    await Promise.all(children.map(child => child.done));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  function launch(change = {}) {
    const child = { process: spawn('/bin/sh', ['scripts/start-render.sh'], { cwd: source, env: { ...env, ...change } }), logs: '', result: null };
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
      if (child.result) assert.fail(`Render launcher stopped: ${child.logs}`);
      if (child.logs.includes(`YENO core ready on port ${port}`)) return child;
      await pause(20);
    }
    assert.fail('Render launcher did not become ready.');
  }
  async function api(route, { credential, body, host = env.RENDER_EXTERNAL_HOSTNAME } = {}) {
    // Native fetch does not preserve an overridden Host in this Node release.
    // Use the wire-level HTTP client so this checks the actual proxy Host.
    return await new Promise((resolve, reject) => {
      const request = http.request(`http://127.0.0.1:${port}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { host, ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      }, response => {
        const chunks = [];
        response.on('data', value => chunks.push(value));
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }); }
          catch (error) { reject(error); }
        });
        response.on('error', reject);
      });
      request.on('error', reject);
      request.end(body ? JSON.stringify(body) : undefined);
    });
  }
  return { directory, diskRoot, dataDir, env, token, launch, boot, api };
}

test('exact Render launcher preserves authentication and memory across SIGKILL with simulated provider mount metadata', { skip }, async t => {
  const f = await fixture(t);
  const first = await f.boot();
  assert.equal((await f.api('/api/v1/health')).status, 200, 'Assigned public hostname must pass provider health checks.');
  assert.equal((await f.api('/api/v1/health', { host: 'wrong.example.net' })).status, 403);
  assert.equal((await f.api('/api/v1/state')).status, 401);
  const enrolled = await f.api('/api/v1/devices/enroll', { credential: f.token, body: { name: 'Render launcher', platform: 'test', requestId: randomUUID() } });
  assert.equal(enrolled.status, 201);
  const credential = enrolled.body.device.deviceToken;
  const body = { text: '기억해: Hosted startup keeps the same identity.', requestId: randomUUID() };
  const saved = await f.api('/api/v1/commands', { credential, body });
  assert.equal(saved.status, 201);
  assert.equal((await f.launch().done).code, 1, 'A second exact launcher must fail at the kernel lock.');
  first.process.kill('SIGKILL');
  assert.equal((await first.done).signal, 'SIGKILL');
  const second = await f.boot();
  const state = await f.api('/api/v1/state', { credential });
  assert.equal(state.status, 200);
  assert.equal(state.body.memories[0].id, saved.body.memory.id);
  assert.equal(state.body.ai.configured, false);
  assert.deepEqual(await f.api('/api/v1/commands', { credential, body }), saved, 'Request identity survives restart.');
  assert.equal(fs.existsSync(path.join(f.dataDir, 'runtime.lock')), false);
  for (const logs of [first.logs, second.logs]) {
    assert.equal(logs.includes(f.token), false);
    assert.equal(logs.includes(credential), false);
  }
  second.process.kill('SIGTERM');
  assert.equal((await second.done).code, 0);
});

test('Render launcher refuses missing disk, real ephemeral directory, hostname and secret before creating data', { skip }, async t => {
  const f = await fixture(t);
  for (const change of [
    { YENO_DISK_MOUNT_PATH: path.join(f.directory, 'absent'), YENO_DATA_DIR: path.join(f.directory, 'absent', 'yeno') },
    { NODE_OPTIONS: '' }, { RENDER_EXTERNAL_HOSTNAME: '' }, { YENO_TOKEN: '' },
    { YENO_TOKEN: 'short' }, { YENO_TOKEN: 'secret-must-never-appear-in-logs\nmore' },
  ]) {
    const child = f.launch(change);
    assert.equal((await child.done).code, 1);
    assert.equal(fs.existsSync(f.dataDir), false);
    assert.equal(child.logs.includes(f.token), false);
    assert.equal(child.logs.includes('secret-must-never-appear-in-logs'), false);
  }
});
