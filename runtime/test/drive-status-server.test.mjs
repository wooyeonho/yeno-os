import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { start } from '../server.mjs';

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-status-server-'));
  const token = 'synthetic-owner-token';
  const runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token });
  const request = async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const post = (route, body = {}) => request('POST', route, { requestId: randomUUID(), ...body });
  const get = route => request('GET', route);
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { post, get };
}

test('GET /api/drives/status returns all seven canonical drives, honestly unmeasured on a fresh runtime', async t => {
  const app = await setup(t);
  const res = await app.get('/api/drives/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.version, 1);
  assert.equal(res.body.measuredAt, null);
  assert.equal(res.body.drives.length, 7);
  for (const drive of res.body.drives) {
    assert.equal(drive.pressure, null);
    assert.equal(drive.trend, null);
    assert.equal(typeof drive.worldName, 'string');
  }
});

test('GET /api/drives/status reflects a real proposed quest and its project link', async t => {
  const app = await setup(t);
  const project = await app.post('/api/projects', { name: '실제 프로젝트' });
  await app.post('/api/quests', { goal: '실제 목표', drive: 'greed', projectId: project.body.project.id });
  const res = await app.get('/api/drives/status');
  assert.equal(res.status, 200);
  assert.ok(typeof res.body.measuredAt === 'string');
  const greed = res.body.drives.find(d => d.driveId === 'greed');
  assert.ok(greed.pressure > 0);
  assert.equal(greed.linkedGoal, '실제 목표');
  assert.equal(greed.linkedProjectId, project.body.project.id);
});

test('GET /api/drives/status requires authentication', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-status-noauth-'));
  const runtime = await start({ host: '127.0.0.1', port: 0, dataDir: dir, token: 'synthetic-real-token' });
  t.after(() => { runtime.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  const r = await fetch(`http://127.0.0.1:${runtime.server.address().port}/api/drives/status`);
  assert.equal(r.status, 401);
});
