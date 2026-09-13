// Exercise the shipped login controller against a real disposable HTTP core.
// The DOM, browser cookie jar and Web Locks lifecycle are simulated here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server.mjs';
import {openStore} from '../lib/store.mjs';
import {connectBrowser} from '../public/web-client.mjs';

const OWNER = 'synthetic-browser-recovery-owner-key';
const ROTATED = 'synthetic-rotated-browser-owner-key';
const LOGIN = 'blackhole-web-login-request-v1';
const unrelatedKey = `blackhole-web-v1:${'z'.repeat(43)}:yeno-pending-command-v1`;
const unresolved = JSON.stringify({requestId: 'accepted-owner-job', text: 'Keep the exact unresolved request'});
const waitFor = async predicate => {
  const until = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < until, 'controller did not reach expected state'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
function memoryStorage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
}
class Element {
  constructor() { this.listeners = new Map(); this.attributes = new Map(); this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; }
  addEventListener(type, handler) { const handlers = this.listeners.get(type) ?? []; handlers.push(handler); this.listeners.set(type, handlers); }
  async fire(type, extra = {}) { for (const handler of this.listeners.get(type) ?? []) await handler({preventDefault() {}, ...extra}); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.focused = true; }
}
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-login-recovery-'));
  let owner = OWNER, core, cookie = '', loseReply = false, held = false;
  const storage = memoryStorage(), oldStorage = memoryStorage(), calls = [], pages = [];
  storage.setItem(unrelatedKey, unresolved);
  const boot = async () => { core = await start({host: '127.0.0.1', port: 0, dataDir: dir, token: owner, env: {}}); };
  await boot();
  const origin = () => `http://127.0.0.1:${core.server.address().port}`;
  const api = async (route, body, credential = owner) => {
    const response = await fetch(origin() + route, {method: body ? 'POST' : 'GET', headers: {'X-Yeno-Browser': '1', ...(credential ? {Authorization: `Bearer ${credential}`} : {}), ...(body ? {Origin: origin(), 'Content-Type': 'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: response.status, body: await response.json()};
  };
  async function open() {
    const elements = Object.fromEntries(['pair-error', 'pair-form', 'pair-token', 'pair-key-toggle', 'pair-screen', 'remember-browser', 'web-retry', 'submit'].map(id => [id, new Element()]));
    elements['pair-token'].type = 'password'; elements['remember-browser'].checked = true;
    elements['pair-form'].querySelector = selector => { assert.equal(selector, '[type="submit"]'); return elements.submit; };
    elements['pair-form'].querySelectorAll = () => [elements['pair-token'], elements['remember-browser'], elements['pair-key-toggle'], elements.submit];
    const events = new Element(); let read = false;
    const locks = {async request(name, options, fn) { if (held) return fn(null); held = true; try { return await fn({name}); } finally { held = false; } }};
    const connected = connectBrowser({document: {getElementById: id => elements[id]}, storage, oldStorage, locks, events,
      fetchImpl: async (route, init = {}) => {
        const requestBody = init.body ? JSON.parse(init.body) : null;
        const response = await fetch(origin() + route, {...init, headers: {...init.headers, ...(cookie ? {Cookie: cookie} : {}), ...(init.method === 'POST' ? {Origin: origin()} : {})}});
        if (requestBody) calls.push({body: requestBody, status: response.status, code: (await response.clone().json()).code});
        if (requestBody && loseReply) { loseReply = false; await response.arrayBuffer(); throw new TypeError('Synthetic response loss after server commit'); }
        const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
        if (!requestBody) read = true;
        return response;
      }});
    connected.catch(() => {});
    const page = {elements, connected,
      async submit(key = owner) { elements['pair-token'].value = key; await elements['pair-form'].fire('submit'); },
      async close() { await events.fire('pagehide'); await new Promise(resolve => setImmediate(resolve)); }};
    pages.push(page);
    await waitFor(() => read); await new Promise(resolve => setImmediate(resolve));
    return page;
  }
  const restart = async (newOwner = owner, change) => {
    core.shutdown();
    if (change) { const store = openStore(dir); change(store.state); store.save(); }
    owner = newOwner; await boot();
  };
  t.after(async () => { for (const page of pages) await page.close(); core.shutdown(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {storage, oldStorage, calls, open, restart, api, loseNextReply: () => { loseReply = true; }, devices: async () => (await api('/api/devices')).body.devices};
}

test('invalid local input never reaches login API; exact wrong keys cannot mutate devices or unresolved jobs', async t => {
  const f = await fixture(t), page = await f.open(), {elements: e} = page;
  for (const value of ['short', ` ${OWNER}`, `${OWNER} `, '한글연결키입니다'.repeat(3), `${OWNER}\u200b`]) {
    await page.submit(value); assert.equal(f.calls.length, 0); assert.equal(f.storage.getItem(LOGIN), null); assert.equal(e['pair-token'].value, value); assert.equal(e['pair-token'].getAttribute('aria-invalid'), 'true');
  }
  await page.submit('synthetic-wrong-key-at-least-16');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].status, 401); assert.equal((await f.devices()).length, 0);
  assert.equal(f.calls[0].code, 'AUTH_KEY_MISMATCH');
  assert.match(e['pair-error'].textContent, /현재 서버/); assert.match(e['pair-error'].textContent, /키 보기/);
  const pending = f.storage.getItem(LOGIN); assert.ok(pending); assert.equal(f.storage.getItem(unrelatedKey), unresolved);
  await e['pair-key-toggle'].fire('click'); assert.equal(e['pair-token'].type, 'text'); assert.equal(e['pair-key-toggle'].getAttribute('aria-pressed'), 'true');
  await e['pair-key-toggle'].fire('click'); assert.equal(e['pair-token'].type, 'password'); assert.equal(e['pair-key-toggle'].getAttribute('aria-pressed'), 'false');
  await page.submit(); assert.equal(f.calls.length, 2); assert.equal(f.storage.getItem(LOGIN), null); assert.equal(e['pair-screen'].hidden, true);
  assert.deepEqual(f.calls[0].body, f.calls[1].body, 'corrected credentials reconcile the same unaccepted enrollment');
  assert.equal(e['pair-token'].value, ''); assert.equal(f.storage.getItem(unrelatedKey), unresolved);
  assert.equal([...f.storage.values.values()].some(value => value.includes(OWNER)), false);
});

test('lost enrollment reply survives closing the page and replays the exact ID without duplicate devices', async t => {
  const f = await fixture(t), first = await f.open();
  f.loseNextReply(); await first.submit();
  assert.match(first.elements['pair-error'].textContent, /같은 연결 요청/); assert.equal((await f.devices()).length, 1);
  const pending = f.storage.getItem(LOGIN); assert.ok(pending);
  await first.close(); assert.equal(first.elements['pair-token'].value, '');
  const second = await f.open(); second.elements['remember-browser'].checked = false;
  await second.submit(); const connected = await second.connected;
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0].body, f.calls[1].body); assert.equal(f.calls[1].body.remember, true);
  assert.equal((await f.devices()).length, 1); assert.equal(connected.metadata.device.id, (await f.devices())[0].id);
  assert.equal(f.storage.getItem(unrelatedKey), unresolved); assert.equal(f.storage.getItem(LOGIN), null);
  await second.close(); const reopened = await f.open(), resumed = await reopened.connected;
  assert.equal(resumed.metadata.device.id, connected.metadata.device.id); assert.equal(f.calls.length, 2, 'valid HttpOnly cookie reconnects without entering a key or enrolling again');
});

test('rotated owner key renews only the authenticated stale enrollment and retains all prior request storage', async t => {
  const f = await fixture(t), first = await f.open();
  f.loseNextReply(); await first.submit(); const before = f.calls[0].body;
  await first.close(); await f.restart(ROTATED);
  const second = await f.open(); await second.submit(ROTATED); await second.connected;
  assert.deepEqual(f.calls.map(call => call.status), [201, 409, 201]);
  assert.equal(f.calls[1].code, 'WEB_ENROLLMENT_STALE');
  assert.deepEqual(f.calls[1].body, before); assert.notEqual(f.calls[2].body.requestId, before.requestId);
  assert.equal((await f.devices()).length, 2); assert.equal(f.storage.getItem(unrelatedKey), unresolved);
});

test('expired accepted enrollment recovers once with a fresh device and preserves the lost-response request until definitive rejection', async t => {
  const f = await fixture(t), first = await f.open(); first.elements['remember-browser'].checked = false;
  f.loseNextReply(); await first.submit(); const originalId = (await f.devices())[0].id;
  await first.close(); await f.restart(OWNER, state => { state.devices[originalId].createdAt = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(); });
  const second = await f.open(); second.elements['remember-browser'].checked = false;
  await second.submit(); const connected = await second.connected;
  assert.deepEqual(f.calls.map(call => call.status), [201, 409, 201]);
  assert.equal(f.calls[1].code, 'WEB_ENROLLMENT_EXPIRED');
  assert.notEqual(connected.metadata.device.id, originalId); assert.equal((await f.devices()).length, 2);
  assert.equal(f.storage.getItem(unrelatedKey), unresolved);
});

test('unknown enrollment conflicts never regenerate IDs or erase the pending request', async t => {
  const f = await fixture(t), body = {requestId: randomUUID(), name: 'Original request name', remember: true};
  assert.equal((await f.api('/api/web/session', body)).status, 201);
  f.storage.setItem(LOGIN, JSON.stringify({...body, name: 'Conflicting name under the original ID'}));
  const pending = f.storage.getItem(LOGIN), page = await f.open(); await page.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].status, 409); assert.equal(f.storage.getItem(LOGIN), pending);
  assert.equal((await f.devices()).length, 1); assert.equal(page.elements['pair-screen'].hidden, false); assert.equal(f.storage.getItem(unrelatedKey), unresolved);
});

test('server rate limit is actionable and immediate resubmission does not spend another login attempt', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.api('/api/web/session', {requestId: randomUUID()}, 'synthetic-invalid-owner')).status, 401);
  const page = await f.open(); await page.submit(); const pending = f.storage.getItem(LOGIN);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].status, 429); assert.match(page.elements['pair-error'].textContent, /\d+초 뒤 같은 요청/);
  assert.equal(f.calls[0].code, 'AUTH_RATE_LIMITED');
  await page.submit(); assert.equal(f.calls.length, 1); assert.equal(f.storage.getItem(LOGIN), pending);
  assert.equal((await f.devices()).length, 0); assert.equal(f.storage.getItem(unrelatedKey), unresolved);
});

test('missing and incorrect authentication headers have distinct safe failure codes and never enroll a browser', async t => {
  const f = await fixture(t), body = {requestId: randomUUID()};
  const missing = await f.api('/api/web/session', body, null), mismatch = await f.api('/api/web/session', body, 'synthetic-wrong-key');
  assert.equal(missing.status, 401); assert.equal(missing.body.code, 'AUTH_HEADER_MISSING');
  assert.equal(mismatch.status, 401); assert.equal(mismatch.body.code, 'AUTH_KEY_MISMATCH');
  assert.equal((await f.devices()).length, 0); assert.equal(f.storage.getItem(unrelatedKey), unresolved);
  assert.equal(JSON.stringify([missing.body, mismatch.body]).includes('synthetic-wrong-key'), false);
});
