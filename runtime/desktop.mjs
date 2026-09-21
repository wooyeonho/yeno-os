/** Packaged desktop entry point. Reuses the canonical server/store/job engines. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { start } from './server.mjs';
import { atomicWrite } from './lib/store.mjs';
import { validateDesktopProviders, desktopProviderEnvironment, desktopProviderSummary } from './lib/desktop-provider-config.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
const EMPTY = { version: 1, providers: [], primaryProvider: null, dailyCallLimit: 5 };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
function exact(value, keys) { return value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)); }
function keyValid(key) { return typeof key === 'string' && key.length >= 16 && key.length <= 512 && !/\s/.test(key); }
function noLinks(filename) {
  for (let item = path.resolve(filename);;) {
    if (fs.existsSync(item) && fs.lstatSync(item).isSymbolicLink()) throw fail('DESKTOP_PATH_UNSAFE');
    const parent = path.dirname(item); if (parent === item) break; item = parent;
  }
}
function readBounded(file, max = 131072) {
  noLinks(file); const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > max) throw fail('DESKTOP_CONFIG_INVALID');
  return fs.readFileSync(file, 'utf8');
}
async function body(req) {
  if (req.headers['content-type'] !== 'application/json') throw fail('DESKTOP_JSON_REQUIRED', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 32768) throw fail('DESKTOP_INPUT_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('DESKTOP_JSON_INVALID'); }
}
function validateSaved(value) {
  if (!exact(value, ['version', 'pairingKey', 'providers', 'loginRequestId', 'loginCreatedAt']) || value.version !== 1 || !keyValid(value.pairingKey)
    || !/^[a-f0-9-]{36}$/.test(value.loginRequestId) || !Number.isFinite(Date.parse(value.loginCreatedAt))) throw fail('DESKTOP_CONFIG_INVALID');
  return { ...value, providers: validateDesktopProviders(value.providers) };
}
function nativeEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH'].includes(key.toUpperCase())));
}
export function nativeHelpers(executable) {
  if (!path.isAbsolute(executable) || path.basename(executable).toLowerCase() !== 'blackhole.exe') throw fail('DESKTOP_NATIVE_REQUIRED');
  noLinks(executable);
  const invoke = (args, input = '') => new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, env: nativeEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', ended = false;
    const finish = (error, result) => { if (ended) return; ended = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill(); finish(fail('DESKTOP_NATIVE_TIMEOUT')); }, 10000);
    child.on('error', () => finish(fail('DESKTOP_NATIVE_FAILED')));
    child.stdout.on('data', data => { output += data.toString('utf8'); if (output.length > 262144) { child.kill(); finish(fail('DESKTOP_NATIVE_FAILED')); } });
    child.stdin.on('error', () => {});
    child.on('close', code => finish(code === 0 ? null : fail('DESKTOP_NATIVE_FAILED'), output.trim()));
    child.stdin.end(input + '\n');
  });
  return {
    protect: async text => invoke(['--protect'], Buffer.from(text, 'utf8').toString('base64')),
    unprotect: async text => Buffer.from(await invoke(['--unprotect'], text), 'base64').toString('utf8'),
    secureDirectory: async directory => invoke(['--secure-directory', directory]),
  };
}

/** Crypto/filesystem injections exist only as direct test arguments, never a CLI bypass. */
export async function startDesktop({ home, corePort = 8791, setupPort = 8792, cryptoAdapter, secureDirectory, openBrowser = () => {}, sourceRevision = 'development', agentFetch }) {
  if (!path.isAbsolute(home) || !cryptoAdapter?.protect || !cryptoAdapter?.unprotect || typeof secureDirectory !== 'function') throw fail('DESKTOP_CONFIGURATION_REQUIRED');
  for (const port of [corePort, setupPort]) if (!Number.isInteger(port) || port < 0 || port > 65535) throw fail('DESKTOP_PORT_INVALID');
  noLinks(home);
  const configFile = path.join(home, 'desktop.dpapi');
  const dataDir = path.join(home, 'data');
  // Never reinterpret a pre-existing resident/cloud/vault directory as a fresh desktop installation.
  if (fs.existsSync(home) && !fs.existsSync(configFile) && fs.readdirSync(home).length) throw fail('DESKTOP_EXISTING_DATA_REFUSED', 409);
  await secureDirectory(home);
  let config = null, runtime = null, unlocked = false, busy = false, closing = null, coreUrl = null;
  let attempts = [], authId = crypto.randomBytes(32).toString('base64url');
  const setupServer = http.createServer(handle);
  setupServer.requestTimeout = 10000; setupServer.headersTimeout = 10000;
  let setupOrigin;
  const persist = async next => { const encrypted = await cryptoAdapter.protect(JSON.stringify(validateSaved(next))); atomicWrite(configFile, encrypted + '\n'); };
  async function stopCore() {
    if (!runtime) return;
    const current = runtime; runtime = null;
    const closed = new Promise(resolve => current.server.listening ? current.server.once('close', resolve) : resolve());
    current.shutdown(); current.server.closeAllConnections?.(); await closed;
  }
  async function bootCore() {
    if (runtime || !config) return;
    noLinks(dataDir); await secureDirectory(dataDir);
    runtime = await start({ dataDir, token: config.pairingKey, host: '127.0.0.1', port: corePort, env: desktopProviderEnvironment(config.providers), webCookieNamespace: 'blackhole-desktop-v1', agentFetch });
    coreUrl = `http://127.0.0.1:${runtime.server.address().port}`;
  }
  function authenticate(key) {
    attempts = attempts.filter(at => at > Date.now() - 60000);
    if (attempts.length >= 10) throw fail('DESKTOP_RATE_LIMITED', 429);
    attempts.push(Date.now());
    if (!config || !equal(key, config.pairingKey)) throw fail('DESKTOP_KEY_MISMATCH', 401);
    attempts = []; unlocked = true;
  }
  async function issueWebCookie(res) {
    await bootCore();
    if (Date.now() - Date.parse(config.loginCreatedAt) >= 27 * 86400000) {
      config = { ...config, loginRequestId: crypto.randomUUID(), loginCreatedAt: new Date().toISOString() }; await persist(config);
    }
    const response = await fetch(`${coreUrl}/api/web/session`, { method: 'POST', signal: AbortSignal.timeout(5000), redirect: 'error',
      headers: { Authorization: `Bearer ${config.pairingKey}`, Origin: coreUrl, 'X-Yeno-Browser': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: config.loginRequestId, name: 'BLACKHOLE Desktop', remember: true }) });
    if (!response.ok) throw fail('DESKTOP_SESSION_FAILED', 409);
    const cookie = response.headers.get('set-cookie');
    if (!cookie?.startsWith('blackhole-desktop-v1=') || !cookie.includes('HttpOnly')) throw fail('DESKTOP_SESSION_FAILED', 409);
    // Both servers are fixed to 127.0.0.1. Forward the canonical HttpOnly cookie;
    // no owner/device token is put in a URL, browser storage or response JSON.
    res.setHeader('Set-Cookie', cookie);
  }
  async function coreMutation(route, value) {
    await bootCore();
    const response = await fetch(`${coreUrl}${route}`, { method: 'POST', signal: AbortSignal.timeout(10000), redirect: 'error',
      headers: { Authorization: `Bearer ${config.pairingKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!response.ok) throw fail('DESKTOP_CORE_REQUEST_FAILED', 409);
    return response.json();
  }
  async function coreRead(route) {
    await bootCore();
    const response = await fetch(`${coreUrl}${route}`, { method: 'GET', signal: AbortSignal.timeout(5000), redirect: 'error',
      headers: { Authorization: `Bearer ${config.pairingKey}` } });
    if (!response.ok) throw fail('DESKTOP_CORE_REQUEST_FAILED', 409);
    return response.json();
  }
  function state() { return { initialized: Boolean(config), running: Boolean(runtime), unlocked, coreUrl, sourceRevision,
    providers: desktopProviderSummary(config?.providers ?? EMPTY), phoneStatus: 'not_connected' }; }
  function respond(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if (req.headers.host !== new URL(setupOrigin).host) throw fail('DESKTOP_HOST_REJECTED', 403);
      const url = new URL(req.url, setupOrigin);
      if (url.search) throw fail('DESKTOP_REQUEST_INVALID');
      const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
      if (req.method === 'GET' && Object.hasOwn(files, url.pathname)) {
        const types = { '/': 'text/html; charset=utf-8', '/app.js': 'text/javascript; charset=utf-8', '/style.css': 'text/css; charset=utf-8' };
        res.writeHead(200, { 'Content-Type': types[url.pathname] }); return res.end(fs.readFileSync(path.join(ROOT, 'desktop-ui', files[url.pathname])));
      }
      if (!equal(req.headers['x-blackhole-setup'], authId)) throw fail('DESKTOP_SESSION_REQUIRED', 403);
      if (req.headers.origin !== undefined && req.headers.origin !== setupOrigin) throw fail('DESKTOP_ORIGIN_REJECTED', 403);
      if (req.method === 'GET' && url.pathname === '/setup/state') return respond(res, 200, state());
      if (req.method !== 'POST' || req.headers.origin !== setupOrigin) throw fail('DESKTOP_ORIGIN_REJECTED', 403);
      if (busy) throw fail('DESKTOP_OPERATION_IN_PROGRESS', 409);
      busy = true;
      try {
        const input = await body(req);
        if (url.pathname === '/setup/initialize') {
          if (config || fs.existsSync(configFile)) throw fail('DESKTOP_ALREADY_INITIALIZED', 409);
          if (!exact(input, ['pairingKey', 'confirmNewStore', 'providers']) || input.confirmNewStore !== true || !keyValid(input.pairingKey)) throw fail('DESKTOP_NEW_STORE_CONFIRMATION_REQUIRED');
          const next = { version: 1, pairingKey: input.pairingKey, providers: validateDesktopProviders(input.providers), loginRequestId: crypto.randomUUID(), loginCreatedAt: new Date().toISOString() };
          await persist(next); config = next; unlocked = true;
          await bootCore(); await issueWebCookie(res);
          return respond(res, 201, { ok: true, coreUrl, redirectUrl: coreUrl });
        }
        if (url.pathname === '/setup/unlock') {
          if (!exact(input, ['pairingKey'])) throw fail('DESKTOP_INPUT_INVALID');
          authenticate(input.pairingKey); await issueWebCookie(res);
          return respond(res, 200, { ok: true, coreUrl, redirectUrl: coreUrl });
        }
        if (url.pathname === '/setup/providers') {
          if (!exact(input, ['pairingKey', 'providers'])) throw fail('DESKTOP_INPUT_INVALID');
          authenticate(input.pairingKey);
          const providers = validateDesktopProviders(input.providers);
          if (runtime?.state().jobs.some(job => ['queued', 'running'].includes(job.status))) throw fail('DESKTOP_PAUSE_JOBS_FIRST', 409);
          // Replacing credentials does not inherit the previous provider's
          // spending authorization. Use the existing settings mutation gate.
          await coreMutation('/api/settings', { requestId: crypto.randomUUID(), modules: { ai: false } });
          const previous = config, next = { ...config, providers };
          await stopCore();
          try { await persist(next); config = next; await bootCore(); }
          catch { await persist(previous); config = previous; await bootCore(); throw fail('DESKTOP_PROVIDER_UPDATE_ROLLED_BACK', 409); }
          await issueWebCookie(res);
          return respond(res, 200, { ok: true, coreUrl, redirectUrl: coreUrl, providers: desktopProviderSummary(providers) });
        }
        if (url.pathname === '/setup/provider-test') {
          if (!exact(input, ['pairingKey'])) throw fail('DESKTOP_INPUT_INVALID');
          authenticate(input.pairingKey);
          // This is an explicit owner action. It enables the existing AI
          // module, starts exactly one durable self-test, and never retries a
          // timed-out provider outcome.
          await coreMutation('/api/settings', { requestId: crypto.randomUUID(), modules: { ai: true } });
          const started = await coreMutation('/api/self-test', { requestId: crypto.randomUUID(), liveProvider: true });
          const selfTestId = started.selfTest?.id;
          if (!selfTestId) throw fail('DESKTOP_PROVIDER_TEST_FAILED', 409);
          let latest = started.selfTest;
          for (let attempt = 0; attempt < 20; attempt++) {
            const current = await coreRead('/api/self-test');
            latest = current.history?.find(item => item.id === selfTestId) ?? latest;
            const status = latest?.providerLive?.status;
            if (status && status !== 'REQUESTED') break;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          return respond(res, 200, { ok: true, selfTestId, selfTestStatus: latest?.status ?? 'RUNNING',
            liveVerification: latest?.providerLive ?? { status: 'REQUESTED' }, jobId: latest?.providerLive?.jobId ?? null });
        }
        if (url.pathname === '/setup/intake') {
          if (!exact(input, ['pairingKey'])) throw fail('DESKTOP_INPUT_INVALID');
          authenticate(input.pairingKey);
          const canonical = await coreMutation('/api/sources/import-canonical-intake', { requestId: crypto.randomUUID() });
          const keywords = await coreMutation('/api/sources/seed-required-intake', { requestId: crypto.randomUUID() });
          return respond(res, 200, { ok: true, createdCount: canonical.createdCount + keywords.createdCount,
            canonicalCount: canonical.totalCount, keywordCount: keywords.createdCount, implementationStatus: 'intake_only' });
        }
        if (url.pathname === '/setup/stop') {
          if (!exact(input, ['pairingKey'])) throw fail('DESKTOP_INPUT_INVALID');
          authenticate(input.pairingKey); await stopCore();
          return respond(res, 200, { ok: true, running: false });
        }
        throw fail('DESKTOP_NOT_FOUND', 404);
      } finally { busy = false; }
    } catch (error) {
      const code = typeof error.code === 'string' && /^DESKTOP_[A-Z_]+$/.test(error.code) ? error.code : 'DESKTOP_OPERATION_FAILED';
      if (!res.headersSent) respond(res, error.status && error.status >= 400 && error.status < 600 ? error.status : 400, { ok: false, code }); else res.end();
    }
  }
  try {
    // Bind one fixed setup port before any decryption/start: a second instance
    // cannot mutate settings or take over a first instance's data writer.
    await new Promise((resolve, reject) => { setupServer.once('error', reject); setupServer.listen(setupPort, '127.0.0.1', resolve); });
    setupOrigin = `http://127.0.0.1:${setupServer.address().port}`;
    if (fs.existsSync(configFile)) {
      try { config = validateSaved(JSON.parse(await cryptoAdapter.unprotect(readBounded(configFile).trim()))); }
      catch { throw fail('DESKTOP_CREDENTIALS_UNAVAILABLE'); }
      await bootCore();
    }
  } catch (error) { await stopCore().catch(() => {}); setupServer.close(); throw error; }
  const url = `${setupOrigin}/#setup=${authId}`;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      await stopCore();
      const closed = new Promise(resolve => setupServer.close(resolve));
      setupServer.closeAllConnections?.();
      await closed; config = null; authId = '';
    })();
    return closing;
  }
  return { url, state, close, open: () => openBrowser(url) };
}

async function main() {
  if (process.platform !== 'win32') throw fail('DESKTOP_WINDOWS_REQUIRED');
  process.umask(0o077);
  const executable = process.env.BLACKHOLE_DESKTOP_NATIVE;
  const native = nativeHelpers(executable ?? '');
  const home = process.env.BLACKHOLE_DESKTOP_HOME ?? path.join(process.env.LOCALAPPDATA ?? '', 'BLACKHOLE', 'desktop-v1');
  let sourceRevision = 'development';
  try { const revision = readBounded(path.join(ROOT, '..', 'SOURCE_COMMIT.txt'), 100).trim(); if (/^[a-f0-9]{40}$/.test(revision)) sourceRevision = revision; } catch {}
  const openBrowser = url => {
    if (process.env.BLACKHOLE_DESKTOP_NO_BROWSER === '1') return;
    const rundll = path.join(process.env.SYSTEMROOT, 'System32', 'rundll32.exe');
    execFile(rundll, ['url.dll,FileProtocolHandler', url], { windowsHide: true, shell: false, env: nativeEnvironment() }, () => {});
  };
  const app = await startDesktop({ home, cryptoAdapter: native, secureDirectory: native.secureDirectory, openBrowser, sourceRevision });
  // Private launcher IPC only. The native parent MUST NOT persist this nonce URL.
  process.stdout.write(JSON.stringify({ type: 'ready', url: app.url, status: app.state().initialized ? 'locked' : 'setup-required' }) + '\n');
  app.open();
  const lines = readline.createInterface({ input: process.stdin });
  const stop = async () => {
    lines.close();
    // Readline.close() only pauses its input. Release the owned IPC pipe as
    // well, otherwise a pending Windows read can keep the core alive on STOP.
    process.stdin.destroy();
    await app.close(); process.exitCode = 0;
  };
  lines.on('line', line => { if (line === 'OPEN') app.open(); else if (line === 'STOP') void stop().catch(() => { process.exitCode = 1; }); });
  lines.once('close', () => { void app.close().catch(() => { process.exitCode = 1; }); });
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Emit a fixed category only; messages/stacks may contain owner paths or keys.
    const category = typeof error.code === 'string' && /^(?:DESKTOP_[A-Z_]+|EADDRINUSE|EACCES|EPERM|ENOENT)$/.test(error.code) ? error.code : 'DESKTOP_START_FAILED';
    process.stderr.write(`BLACKHOLE_CORE_FAILED:${category}\n`); process.exitCode = 1;
  });
}
