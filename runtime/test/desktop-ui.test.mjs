import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { startDesktop } from '../desktop.mjs';

const require = createRequire(new URL('../../apps/controller/package.json', import.meta.url));
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await check()) return; await sleep(20); }
  throw new Error(`Desktop UI condition not reached: ${label}`);
}

// A synthetic encryption adapter and directory permission boundary are injected.
// HTTP, frontend code, core/store, cookies, request parsing and jobs are real.
// This is not Windows DPAPI, a physical browser or live provider acceptance.
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-desktop-ui-'));
  const key = crypto.randomBytes(32);
  const cryptoAdapter = {
    async protect(text) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    async unprotect(text) {
      const bytes = Buffer.from(text, 'base64'), decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  const app = await startDesktop({ home: path.join(root, 'home'), corePort: 0, setupPort: 0, cryptoAdapter,
    secureDirectory: async directory => fs.mkdirSync(directory, { recursive: true, mode: 0o700 }), sourceRevision: '1234567890abcdef1234567890abcdef12345678' });
  const jar = new CookieJar(), requests = [], windows = [], errors = [];
  const origin = new URL(app.url).origin;
  t.after(async () => { windows.forEach(window => window.close()); await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  async function browserFetch(url, options = {}, record = false) {
    const absolute = new URL(url, origin).href;
    const headers = new Headers(options.headers);
    const cookie = jar.getCookieStringSync(absolute);
    if (cookie) headers.set('Cookie', cookie);
    if ((options.method || 'GET') !== 'GET') headers.set('Origin', origin);
    const response = await fetch(absolute, { ...options, headers });
    for (const value of response.headers.getSetCookie()) jar.setCookieSync(value, absolute);
    if (record) requests.push({ path: new URL(absolute).pathname, method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : undefined, status: response.status,
      setupHeader: headers.get('X-Blackhole-Setup') });
    return response;
  }
  async function open(withBootstrap = true) {
    const page = await browserFetch('/');
    assert.equal(page.status, 200);
    const vc = new VirtualConsole(); vc.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(await page.text(), { url: withBootstrap ? app.url : `${origin}/`, runScripts: 'outside-only', cookieJar: jar, virtualConsole: vc });
    windows.push(dom.window);
    // Fetch the exact paths declared by the HTML. A route mismatch must fail.
    for (const link of dom.window.document.querySelectorAll('link[rel="stylesheet"]')) {
      const stylesheet = await browserFetch(link.href); assert.equal(stylesheet.status, 200);
      assert.match(stylesheet.headers.get('content-type'), /^text\/css/); assert((await stylesheet.text()).length > 100);
    }
    const script = dom.window.document.querySelector('script[type="module"]');
    const javascript = await browserFetch(script.src); assert.equal(javascript.status, 200);
    assert.match(javascript.headers.get('content-type'), /^text\/javascript/);
    dom.window.fetch = (url, options) => browserFetch(url, options, true);
    dom.window.AbortController = AbortController; // Match the Node fetch realm.
    dom.window.eval(await javascript.text());
    await until(() => dom.window.document.getElementById('setup-panel').getAttribute('aria-busy') === 'false', 'initial setup state');
    return dom.window;
  }
  const coreFetch = (route, options = {}) => {
    const url = new URL(route, app.state().coreUrl);
    const headers = { Cookie: jar.getCookieStringSync(url.href), Origin: url.origin, 'X-Yeno-Browser': '1', ...options.headers };
    return fetch(url, { ...options, headers });
  };
  return { app, open, requests, jar, errors, coreFetch };
}

function submit(window, id) {
  window.document.getElementById(id).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
async function idle(window) { await until(() => window.document.getElementById('setup-panel').getAttribute('aria-busy') === 'false', 'form response'); }

test('desktop frontend loads real assets and completes initialization, canonical cookie session, intake, provider update and stop/reunlock', async t => {
  const f = await fixture(t), window = await f.open();
  const $ = id => window.document.getElementById(id);
  assert.equal(window.location.hash, '');
  assert.equal($('first-setup').hidden, false, $('setup-message').textContent);
  assert.equal(window.localStorage.length, 0); assert.equal(window.sessionStorage.length, 0);
  assert.equal($('provider-openai-model').maxLength, 120);
  const pairingKey = `synthetic-pairing-${crypto.randomBytes(20).toString('hex')}`;
  $('new-pairing-key').value = pairingKey;
  $('confirm-new-store').checked = true;
  $('provider-openai-apiKey').value = 'synthetic-provider-key-not-live';
  $('provider-openai-model').value = 'synthetic-model-not-live';
  $('daily-call-limit').value = '2';
  submit(window, 'initialize-form');
  await idle(window);
  assert.equal($('ready-panel').hidden, false, $('setup-message').textContent);
  assert.equal($('new-pairing-key').value, ''); assert.equal($('provider-openai-apiKey').value, '');
  const initialization = f.requests.find(row => row.path === '/setup/initialize');
  assert.equal(initialization.status, 201);
  assert.deepEqual(Object.keys(initialization.body).sort(), ['confirmNewStore', 'pairingKey', 'providers']);
  assert.deepEqual(initialization.body.providers, { version: 1, providers: [{ provider: 'openai', apiKey: 'synthetic-provider-key-not-live', model: 'synthetic-model-not-live' }], primaryProvider: 'openai', dailyCallLimit: 2 });
  assert(f.requests.every(row => row.setupHeader === new URLSearchParams(new URL(f.app.url).hash.slice(1)).get('setup')));
  assert.equal(window.document.cookie, '', 'Canonical authentication cookie must be HttpOnly');
  assert.match(f.jar.getCookieStringSync(f.app.state().coreUrl), /^blackhole-desktop-v1=/);
  let response = await f.coreFetch('/api/state'); assert.equal(response.status, 200);
  const initial = await response.json(); assert.equal(initial.modules.ai, false); assert.equal(initial.agent.usage.attempts, 0);
  assert.match($('provider-state').textContent, /1개 설정/);

  // The setup cookie directly opens the existing runtime command path.
  response = await f.coreFetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), text: '문서 만들어: desktop frontend actual result' }) });
  assert.equal(response.status, 201); const jobId = (await response.json()).job.id;
  let job;
  await until(async () => { const state = await (await f.coreFetch('/api/state')).json(); job = state.jobs.find(item => item.id === jobId); return job?.status === 'completed'; }, 'real document result');
  const artifactRef = job.artifacts[0].id;
  const artifact = Buffer.from(await (await f.coreFetch(`/api/artifacts/${artifactRef}`)).arrayBuffer());
  assert(artifact.length > 0);

  $('intake-pairing-key').value = pairingKey; submit(window, 'intake-form'); await idle(window);
  assert.equal($('intake-result').hidden, false, $('setup-message').textContent);
  assert.equal(f.requests.find(row => row.path === '/setup/intake').status, 200);
  assert.match($('intake-result').textContent, /실행·완료된 프로젝트가 아닙니다/);
  const intakeFirst = $('intake-result').textContent;
  $('intake-pairing-key').value = pairingKey; submit(window, 'intake-form'); await idle(window);
  assert.match($('intake-result').textContent, /^0개 항목/);
  assert.notEqual(intakeFirst, $('intake-result').textContent);

  $('provider-details').open = true;
  $('provider-gemini-apiKey').value = 'synthetic-gemini-key-not-live'; $('provider-gemini-model').value = 'synthetic-gemini-model-not-live';
  $('daily-call-limit').value = '3'; $('providers-pairing-key').value = pairingKey;
  submit(window, 'providers-form'); await idle(window);
  assert.equal(f.requests.find(row => row.path === '/setup/providers').status, 200, $('setup-message').textContent);
  assert.equal($('provider-gemini-apiKey').value, '');
  assert.equal(f.app.state().providers.primaryProvider, 'gemini');
  assert.equal((await (await f.coreFetch('/api/state')).json()).modules.ai, false);

  $('stop-pairing-key').value = pairingKey; submit(window, 'stop-form'); await idle(window);
  assert.equal(f.requests.find(row => row.path === '/setup/stop').status, 200);
  assert.equal(f.app.state().running, false); assert.equal($('stopped-panel').hidden, false);
  $('reconnect-core').click(); await idle(window);
  assert.equal($('unlock-form').hidden, false);
  $('unlock-pairing-key').value = 'synthetic-wrong-pairing-key'; submit(window, 'unlock-form'); await idle(window);
  assert.match($('setup-message').textContent, /연결 키가 일치하지/);
  assert.equal(f.app.state().running, false);
  $('unlock-pairing-key').value = pairingKey; submit(window, 'unlock-form'); await idle(window);
  assert.equal($('ready-panel').hidden, false, $('setup-message').textContent);
  assert.equal(f.app.state().running, true);
  const recovered = await (await f.coreFetch('/api/state')).json();
  assert.deepEqual(recovered.core.identity, initial.core.identity);
  assert.equal(recovered.jobs.filter(item => item.id === jobId).length, 1);
  assert.deepEqual(Buffer.from(await (await f.coreFetch(`/api/artifacts/${artifactRef}`)).arrayBuffer()), artifact);
  assert.equal(window.localStorage.length, 0); assert.equal(window.sessionStorage.length, 0);
  assert(!window.location.href.includes(pairingKey));
  assert(!window.document.body.textContent.includes(pairingKey));
  assert.equal(f.requests.filter(row => row.path === '/setup/initialize').length, 1);
  assert.equal(recovered.agent.usage.attempts, 0);
  assert.deepEqual(f.errors, []);
});

test('desktop page without launcher bootstrap fails closed before making an API request', async t => {
  const f = await fixture(t), window = await f.open(false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.app.state().initialized, false);
  assert.match(window.document.getElementById('setup-message').textContent, /BLACKHOLE.exe를 다시/);
  assert.equal(window.document.getElementById('first-setup').hidden, true);
  assert.equal(window.localStorage.length, 0); assert.equal(window.sessionStorage.length, 0);
  assert.deepEqual(f.errors, []);
});
