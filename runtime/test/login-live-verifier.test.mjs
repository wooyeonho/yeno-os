import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {verifyLogin} from '../../scripts/verify-login-live.mjs';

const OWNER = 'synthetic-login-verifier-owner-key';
const HOST = 'global-iris-gyeol-98386a17.koyeb.app';
const RUN_ID = 'synthetic-20260913-run';
const ENV = {YENO_TOKEN: OWNER, YENO_VERIFY_LOGIN_ID: RUN_ID};

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-login-verifier-'));
  const core = await start({dataDir: dir, port: 0, token: OWNER, env: {YENO_ALLOWED_HOSTS: HOST}});
  t.after(() => { core.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  const requests = [], logs = [], cookies = [];
  const transport = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, `https://${HOST}`, 'verifier targets only its fixed production origin');
    requests.push({path: target.pathname, method: init.method, body: init.body ? JSON.parse(init.body) : undefined});
    // Simulate the TLS-terminating proxy explicitly. Node fetch replaces Host
    // with its target hostname, so a raw local HTTP transport is needed here.
    const response = await new Promise((resolve, reject) => {
      const request = http.request(`http://127.0.0.1:${core.server.address().port}${target.pathname}`, {
        method: init.method, headers: {...init.headers, Host: HOST}, signal: init.signal,
      }, reply => {
        const chunks = [];
        reply.on('data', chunk => chunks.push(chunk)); reply.on('error', reject);
        reply.on('end', () => {
          const headers = new Headers();
          for (let i = 0; i < reply.rawHeaders.length; i += 2) headers.append(reply.rawHeaders[i], reply.rawHeaders[i + 1]);
          resolve(new Response(Buffer.concat(chunks), {status: reply.statusCode, headers}));
        });
      });
      request.on('error', reject); if (init.body) request.write(init.body); request.end();
    });
    cookies.push(...response.headers.getSetCookie()); return response;
  };
  const enroll = async (name, platform) => {
    const response = await transport(`https://${HOST}/api/v1/devices/enroll`, {
      method: 'POST', headers: {Authorization: `Bearer ${OWNER}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({requestId: randomUUID(), name, platform}),
    });
    assert.equal(response.status, 201); return (await response.json()).device;
  };
  const native = await enroll('Owner native device', 'android');
  // Even a similarly named existing owner record must never be a cleanup target.
  const similar = await enroll(`BH login ${RUN_ID}`, 'web');
  const listDevices = async () => {
    const response = await transport(`https://${HOST}/api/devices`, {method: 'GET', headers: {Authorization: `Bearer ${OWNER}`}});
    return (await response.json()).devices;
  };
  return {core, transport, requests, logs, cookies, native, similar, listDevices,
    run: fetchImpl => verifyLogin({env: ENV, fetchImpl: fetchImpl ?? transport, write: line => logs.push(line)})};
}

test('login verifier performs current HTTPS-cookie flow, revokes only its synthetic device, and never reuses old success', async t => {
  const f = await fixture(t), report = await f.run();
  assert.equal(report.status, 'verified', JSON.stringify(report)); assert.equal(report.currentLoginVerified, true);
  assert.equal(report.preservedActiveDevices, 2); assert.equal(report.modelCallsSubmitted, 0);
  const devices = await f.listDevices();
  assert.equal(devices.length, 3); assert.equal(devices.filter(device => device.revokedAt).length, 1);
  assert.equal(devices.find(device => device.id === f.native.id).revokedAt, null);
  assert.equal(devices.find(device => device.id === f.similar.id).revokedAt, null);
  const loginCount = f.requests.filter(item => item.method === 'POST' && item.path === '/api/web/session').length;
  const repeat = await f.run();
  assert.equal(repeat.status, 'previously_finished'); assert.equal(repeat.currentLoginVerified, false);
  assert.equal(f.requests.filter(item => item.method === 'POST' && item.path === '/api/web/session').length, loginCount);
  assert.deepEqual(f.core.state().jobs, []);
  const output = f.logs.join('\n');
  for (const sensitive of [OWNER, f.native.deviceToken, f.similar.deviceToken,
    ...f.cookies.map(value => value.split(';')[0]).filter(value => !value.endsWith('='))]) assert.equal(output.includes(sensitive), false);
  assert.doesNotMatch(output, /tokenHash|storageScope|Bearer|__Host-yeno-web-v1=/);
});

test('lost login acknowledgement retries the same identity exactly once and does not enroll twice', async t => {
  const f = await fixture(t); let dropped = false;
  const report = await f.run(async (url, init) => {
    const response = await f.transport(url, init);
    if (!dropped && url.endsWith('/api/web/session') && init.method === 'POST') {
      dropped = true; await response.arrayBuffer(); throw new Error(`Dropped reply with ${OWNER}`);
    }
    return response;
  });
  assert.equal(report.currentLoginVerified, true);
  const login = f.requests.filter(item => item.method === 'POST' && item.path === '/api/web/session');
  assert.equal(login.length, 2); assert.deepEqual(login[0].body, login[1].body);
  assert.equal((await f.listDevices()).length, 3);
  assert.equal(f.logs.join('\n').includes(OWNER), false);
});

test('two lost login replies stop bounded retries and use durable reference to clean up only the synthetic browser', async t => {
  const f = await fixture(t);
  const report = await f.run(async (url, init) => {
    const response = await f.transport(url, init);
    if (url.endsWith('/api/web/session') && init.method === 'POST') {
      await response.arrayBuffer(); throw new Error(`Do not log ${OWNER}`);
    }
    return response;
  });
  assert.equal(report.currentLoginVerified, false); assert.equal(report.code, 'transport_outcome_unknown');
  assert.equal(report.cleanup, 'synthetic_device_revoked');
  assert.equal(f.requests.filter(item => item.method === 'POST' && item.path === '/api/web/session').length, 2);
  const devices = await f.listDevices();
  assert.equal(devices.length, 3); assert.equal(devices.filter(device => !device.revokedAt).length, 2);
  assert.equal(devices.find(device => device.id === f.native.id).revokedAt, null);
  assert.equal(devices.find(device => device.id === f.similar.id).revokedAt, null);
  assert.equal(f.logs.join('\n').includes(OWNER), false);
});

test('uncertain cleanup is reported as unconfirmed and never targets an unrelated owner device', async t => {
  const f = await fixture(t);
  const report = await f.run(async (url, init) => {
    if (/\/api\/devices\/[^/]+\/revoke$/.test(url)) throw new Error(`network ${OWNER}`);
    const response = await f.transport(url, init);
    if (url.endsWith('/api/web/session') && init.method === 'POST') { await response.arrayBuffer(); throw new Error('lost'); }
    return response;
  });
  assert.equal(report.currentLoginVerified, false); assert.equal(report.cleanup, 'unconfirmed');
  assert.equal((await f.listDevices()).filter(device => !device.revokedAt).length, 3);
  assert.equal(f.logs.join('\n').includes(OWNER), false);
});

test('missing stable identity and rejected owner key cannot create browser records or expose untrusted response text', async t => {
  const logs = [];
  const invalid = await verifyLogin({env: {YENO_TOKEN: OWNER}, fetchImpl: () => { throw new Error('must not call'); }, write: value => logs.push(value)});
  assert.equal(invalid.code, 'nonsecret_verification_id_required');
  const f = await fixture(t);
  const rejected = await verifyLogin({env: {...ENV, YENO_TOKEN: 'different-synthetic-owner-key'},
    fetchImpl: f.transport, write: value => logs.push(value)});
  assert.equal(rejected.httpStatus, 401); assert.equal(rejected.stage, 'owner_authentication');
  assert.equal(rejected.currentLoginVerified, false); assert.equal((await f.listDevices()).length, 2);
  assert.equal(logs.join('\n').includes(OWNER), false);
});
