import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {start} from '../server.mjs';

async function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-invite-'));
  const token = crypto.randomBytes(32).toString('base64url');
  const core = await start({dataDir, token, port: 0, host: '127.0.0.1', env: {YENO_ALLOWED_HOSTS: 'acceptance.example.ts.net:9443'}});
  t.after(async () => { core.shutdown(); await new Promise(resolve => core.server.close(resolve)); fs.rmSync(dataDir, {recursive: true, force: true}); });
  const origin = `http://127.0.0.1:${core.server.address().port}`;
  async function call(route, body, credential = token) {
    const response = await fetch(origin + route, {method: 'POST', headers: {'content-type':'application/json', authorization: `Bearer ${credential}`, origin: 'http://tauri.localhost'}, body: JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  }
  return {call, dataDir, token};
}

test('owner invitation enrolls once, recovers exact retry and never persists a raw credential', async t => {
  const {call, dataDir, token} = await fixture(t);
  const issued = await call('/api/v1/pairing/invites', {requestId: crypto.randomUUID()});
  assert.equal(issued.status, 201);
  const invitation = issued.body.invitation;
  assert.equal(invitation.origin, 'https://acceptance.example.ts.net:9443');
  assert.equal(invitation.token === token, false);
  const payload = {requestId: crypto.randomUUID(), name:'Acceptance Android', platform:'android'};
  const enrolled = await call('/api/v1/devices/enroll-invite', payload, invitation.token);
  assert.equal(enrolled.status, 201);
  const retry = await call('/api/v1/devices/enroll-invite', payload, invitation.token);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.device.id, enrolled.body.device.id);
  assert.equal(retry.body.device.deviceToken === enrolled.body.device.deviceToken, true);
  assert.equal((await call('/api/v1/devices/enroll-invite', {...payload, requestId:crypto.randomUUID()}, invitation.token)).status, 409);
  assert.equal((await call('/api/v1/pairing/invites', {requestId:crypto.randomUUID()}, enrolled.body.device.deviceToken)).status, 403);
  const stored = fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8');
  for (const secret of [token, invitation.token, enrolled.body.device.deviceToken]) assert.equal(stored.includes(secret), false);
});

test('unauthenticated issuance, invalid redemption and cancelled invitations fail closed', async t => {
  const {call} = await fixture(t);
  assert.equal((await call('/api/v1/pairing/invites', {requestId:crypto.randomUUID()}, 'invalid')).status, 401);
  const issued = await call('/api/v1/pairing/invites', {requestId:crypto.randomUUID()});
  assert.equal(issued.status, 201);
  assert.equal((await call(`/api/v1/pairing/invites/${issued.body.invitation.id}/cancel`, {})).status, 200);
  assert.equal((await call('/api/v1/devices/enroll-invite', {requestId:crypto.randomUUID(), name:'Android', platform:'android'}, issued.body.invitation.token)).status, 410);
  assert.equal((await call('/api/v1/devices/enroll-invite', {requestId:crypto.randomUUID(),name:'Android',platform:'android'}, 'invalid')).status, 401);
});

import {createNativePairings} from '../lib/native-pairing.mjs';

test('invitation expiry, restart and capacity have explicit fail-closed behavior', () => {
  let clock = 1000;
  const pairings = createNativePairings({now:()=>clock, lifetime:100, capacity:1});
  const requestId = crypto.randomUUID();
  const first = pairings.issue(requestId, 'https://acceptance.example.ts.net:9443');
  assert.equal(pairings.issue(requestId, first.origin).token === first.token, true);
  assert.throws(()=>pairings.issue(crypto.randomUUID(),first.origin), {status:429});
  assert.throws(()=>createNativePairings().claim(first.token,crypto.randomUUID()), {status:401});
  clock = 1100;
  assert.throws(()=>pairings.claim(first.token,crypto.randomUUID()), {status:410});
  assert.throws(()=>pairings.issue(requestId,first.origin), {status:410});
  assert.ok(pairings.issue(crypto.randomUUID(),first.origin));
  clock = 1200;
  const replacement = pairings.issue(requestId,first.origin);
  assert.equal(replacement.token === first.token,false);
  assert.throws(()=>pairings.claim(first.token,crypto.randomUUID()), {status:401});
  assert.throws(()=>pairings.issue(crypto.randomUUID(),'http://remote.example'), {status:409});
});

import {ownerPairing} from '../owner-pairing.mjs';
test('owner GUI bridge issues through authenticated loopback and returns only an in-memory QR image', async t => {
  const {dataDir, call, token} = await fixture(t);
  const home=path.join(dataDir,'gui'); fs.mkdirSync(home);
  const tokenFile=path.join(home,'pairing.token'); fs.writeFileSync(tokenFile,token);
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({version:1,dataDir,controlDir:path.join(home,'control'),tokenFile,port:8790,phone:{dnsName:'acceptance.example.ts.net',executable:path.join(home,'tailscale.exe')}}));
  const result=await ownerPairing(home,'issue',crypto.randomUUID(),async (url,options)=>{
    assert.equal(new URL(url).origin,'http://127.0.0.1:8790');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.authorization === `Bearer ${token}`,true);
    const reply=await call(new URL(url).pathname,JSON.parse(options.body));
    return Response.json(reply.body,{status:reply.status});
  });
  assert.match(result.image,/^data:image\/png;base64,/);
  assert.equal(result.origin,'https://acceptance.example.ts.net:9443');
  assert.equal(Object.hasOwn(result,'token'),false);
  assert.equal(JSON.stringify(result).includes(token),false);
  assert.deepEqual(fs.readdirSync(home).sort(),['config.json','pairing.token']);
});

import {ownerLocalModel} from '../owner-local-model.mjs';
test('owner model choice saves installed loopback model without altering key or enabling automation', async t => {
  const {dataDir,token}=await fixture(t);
  const home=path.join(dataDir,'settings');fs.mkdirSync(home);
  const tokenFile=path.join(home,'pairing.token');fs.writeFileSync(tokenFile,token);
  const config={version:1,dataDir,controlDir:path.join(home,'control'),tokenFile,port:8790,phone:null};
  fs.writeFileSync(path.join(home,'config.json'),JSON.stringify(config));
  const transport=async url=>Response.json(url.endsWith('/api/tags')?{models:[{name:'qwen2.5:3b'}]}:{jobs:[]});
  const result=await ownerLocalModel(home,'save-model','qwen2.5:3b',transport);
  assert.equal(result.requiresRestart,true);assert.equal(result.aiEnabled,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home,'config.json'),'utf8')).localModel,'qwen2.5:3b');
  assert.equal(fs.readFileSync(tokenFile,'utf8')===token,true);
  await assert.rejects(ownerLocalModel(home,'save-model','cloud-model',transport));
  await assert.rejects(ownerLocalModel(home,'save-model','qwen2.5:3b',async url=>Response.json(url.endsWith('/api/tags')?{models:[{name:'qwen2.5:3b'}]}:{jobs:[{status:'running'}]})));
});
