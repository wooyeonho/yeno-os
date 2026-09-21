/** Windows/local supervisor; the existing runtime remains the only job/store engine. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { start } from './server.mjs';

const exec = promisify(execFile);
const CONFIG_KEYS = ['version', 'dataDir', 'tokenFile', 'controlDir', 'port', 'phone'];
const DNS_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\.ts\.net$/;
const coded = code => Object.assign(new Error(code), { code });
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function validateResidentConfig(value) {
  if (!exactKeys(value, CONFIG_KEYS) || value.version !== 1) throw coded('RESIDENT_CONFIG_INVALID');
  for (const key of ['dataDir', 'tokenFile', 'controlDir']) {
    if (typeof value[key] !== 'string' || !path.isAbsolute(value[key]) || /[\r\n\0]/.test(value[key])) throw coded('RESIDENT_PATH_INVALID');
  }
  if (value.dataDir === value.controlDir || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || value.port === 9443) throw coded('RESIDENT_PORT_OR_DIRECTORY_INVALID');
  if (value.phone !== null && (!exactKeys(value.phone, ['dnsName', 'executable'])
    || typeof value.phone.dnsName !== 'string' || !DNS_NAME.test(value.phone.dnsName)
    || typeof value.phone.executable !== 'string' || !path.isAbsolute(value.phone.executable)
    || /[\r\n\0]/.test(value.phone.executable))) throw coded('RESIDENT_PHONE_CONFIG_INVALID');
  return structuredClone(value);
}
function readJson(filename, maxBytes = 32768) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw coded('RESIDENT_FILE_INVALID');
  return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
}
function writeJson(filename, value) {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}
function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
// Empty/null defaults are allowed. Any nested configured value is a conflict,
// including foreground sessions; no existing Serve route is taken over.
export function serveConfigurationIsEmpty(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value).every(serveConfigurationIsEmpty);
  return false;
}
function childEnvironment() {
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
}
async function runTailscale(executable, args) {
  try {
    const result = await exec(executable, args, { timeout: 7000, maxBuffer: 262144, windowsHide: true, shell: false, env: childEnvironment() });
    return JSON.parse(result.stdout);
  } catch { throw coded('RESIDENT_TAILSCALE_PROBE_FAILED'); }
}
export function probePhoneHealth(dnsName) {
  return new Promise(resolve => {
    let deadline;
    const finish = value => { clearTimeout(deadline); resolve(value); };
    const request = https.get(`https://${dnsName}:9443/api/health`, { timeout: 3000 }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16384) { response.destroy(); finish(false); } else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const health = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          finish(response.statusCode === 200 && health.name === 'YENO OS' && health.apiVersion === '1'
            && health.authRequired === true && health.authentication === 'device-bearer');
        } catch { finish(false); }
      });
      response.on('error', () => finish(false));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => finish(false));
    deadline = setTimeout(() => { request.destroy(); finish(false); }, 3500);
  });
}
function bounded(promise, milliseconds, code) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(coded(code)), milliseconds); })])
    .finally(() => clearTimeout(timer));
}
function childEnded(child) { return child.exitCode !== null || child.signalCode !== null; }
async function stopChild(child) {
  if (!child || childEnded(child)) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill('SIGTERM'); // Only the child owned by this supervisor, never taskkill/reset.
  try { await bounded(closed, 5000, 'RESIDENT_PHONE_STOP_TIMEOUT'); }
  catch {
    child.kill('SIGKILL');
    await bounded(closed, 3000, 'RESIDENT_PHONE_STOP_TIMEOUT');
  }
}

/** Adapters are dependency injection for tests, never environment flags or CLI bypasses. */
export async function startResident(input, adapters = {}) {
  const config = validateResidentConfig(input);
  const instanceFile = path.join(config.controlDir, 'instance.json');
  const stopFile = path.join(config.controlDir, 'stop.json');
  const info = { version: 1, pid: process.pid, phonePid: null, startedAt: new Date().toISOString(), instanceId: crypto.randomUUID(), port: config.port,
    state: 'starting', phone: { status: config.phone ? 'pending' : 'disabled', verified: false } };
  for (const directory of [config.controlDir, config.dataDir]) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw coded('RESIDENT_DIRECTORY_INVALID');
  }
  if (fs.existsSync(instanceFile)) {
    const previous = readJson(instanceFile);
    if (previous.state !== 'stopped' && processExists(previous.pid)) throw coded('RESIDENT_ALREADY_RUNNING');
    if (processExists(previous.phonePid)) throw coded('RESIDENT_ORPHANED_BRIDGE');
  }
  const tokenStat = fs.lstatSync(config.tokenFile);
  if (!tokenStat.isFile() || tokenStat.isSymbolicLink() || tokenStat.size > 4096) throw coded('RESIDENT_TOKEN_FILE_INVALID');
  const token = fs.readFileSync(config.tokenFile, 'utf8').replace(/^\uFEFF/, '').trim();
  if (token.length < 16 || /\s/.test(token)) throw coded('RESIDENT_TOKEN_INVALID');

  const execute = adapters.runTailscale ?? runTailscale;
  let phoneReady = false;
  // Check on every run, not just on installation. Reading status never changes routing.
  if (config.phone) {
    try {
      const status = await execute(config.phone.executable, ['status', '--json']);
      if (status?.BackendState !== 'Running' || status?.Self?.DNSName?.replace(/\.$/, '') !== config.phone.dnsName) throw coded('RESIDENT_TAILSCALE_NOT_READY');
      const serving = await execute(config.phone.executable, ['serve', 'status', '--json']);
      if (!serveConfigurationIsEmpty(serving)) throw coded('RESIDENT_TAILSCALE_CONFLICT');
      phoneReady = true;
    } catch (error) {
      const reason = ['RESIDENT_TAILSCALE_NOT_READY', 'RESIDENT_TAILSCALE_CONFLICT'].includes(error.code) ? error.code : 'RESIDENT_TAILSCALE_PROBE_FAILED';
      info.phone = { status: 'blocked', verified: false, reason };
    }
  }
  // Dedicated local mode: only explicit config controls host, data and token.
  // Do not inherit provider credentials, proxy hosts or cloud deployment settings.
  const runtime = await (adapters.start ?? start)({ dataDir: config.dataDir, token, host: '127.0.0.1', port: config.port,
    env: { YENO_ALLOWED_HOSTS: phoneReady ? `${config.phone.dnsName}:9443` : '' } });
  let child = null, stopping = null, poll = null, probeTimer = null, phoneProbe = null;
  let resolveClosed, rejectClosed;
  const closed = new Promise((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject; });
  // A caller may wait for close later; retain a handler without swallowing its result.
  closed.catch(() => {});
  const persist = () => (adapters.writeInstance ?? writeJson)(instanceFile, info);
  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      clearInterval(poll); clearInterval(probeTimer);
      let problem = null;
      info.state = 'stopping';
      try { persist(); } catch (error) { problem = error; }
      // Metadata failures must never prevent resource cleanup.
      const serverClosed = new Promise(resolve => runtime.server.listening ? runtime.server.once('close', resolve) : resolve());
      const childClosed = stopChild(child);
      try { runtime.shutdown(); } catch (error) { problem ??= error; }
      try { runtime.server.closeAllConnections?.(); } catch (error) { problem ??= error; }
      const outcomes = await Promise.allSettled([childClosed, bounded(serverClosed, 7000, 'RESIDENT_CORE_STOP_TIMEOUT')]);
      const failed = outcomes.find(outcome => outcome.status === 'rejected');
      if (!failed) {
        info.phone = { status: config.phone ? 'stopped' : 'disabled', verified: false };
        info.phonePid = null; info.state = 'stopped';
      } else {
        info.state = 'stop-failed'; info.phone.verified = false;
        problem ??= failed.reason;
      }
      try { persist(); } catch (error) { problem ??= error; }
      if (problem) { rejectClosed(problem); throw problem; }
      resolveClosed();
    })();
    return stopping;
  }
  try {
    persist();
    if (phoneReady) {
      child = (adapters.spawn ?? spawn)(config.phone.executable,
        ['serve', '--https=9443', `http://127.0.0.1:${config.port}`],
        { shell: false, windowsHide: true, stdio: 'ignore', env: childEnvironment() });
      await bounded(new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(coded('RESIDENT_PHONE_START_FAILED'))); }), 7000, 'RESIDENT_PHONE_START_TIMEOUT');
      info.phonePid = child.pid ?? null; persist();
      const persistChildStatus = () => { if (!stopping) { try { persist(); } catch { void stop().catch(() => {}); } } };
      child.on('error', () => { info.phone = { status: 'unavailable', verified: false }; persistChildStatus(); });
      child.on('exit', () => { info.phone = { status: 'unavailable', verified: false }; persistChildStatus(); });
      child.on('close', () => { info.phonePid = null; persistChildStatus(); });
      const probe = async () => {
        if (stopping || phoneProbe || childEnded(child)) return;
        phoneProbe = Promise.resolve((adapters.probePhoneHealth ?? probePhoneHealth)(config.phone.dnsName)).catch(() => false);
        const ok = await phoneProbe; phoneProbe = null;
        if (!stopping && !childEnded(child)) { info.phone = { status: ok === true ? 'available' : 'pending', verified: ok === true }; persist(); }
      };
      await probe();
      probeTimer = setInterval(() => { void probe().catch(() => stop().catch(() => {})); }, 10000);
    }
    info.state = 'running'; persist();
    poll = setInterval(() => {
      try {
        if (fs.existsSync(stopFile) && readJson(stopFile, 2048)?.instanceId === info.instanceId) void stop().catch(() => {});
      } catch { /* Partial/stale/untrusted control input never grants a stop. */ }
    }, 200);
    return { runtime, info, closed, stop };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--config' || !path.isAbsolute(process.argv[3])) throw coded('RESIDENT_CONFIG_ARGUMENT_REQUIRED');
  process.umask(0o077);
  const resident = await startResident(readJson(process.argv[3]));
  const halt = () => { void resident.stop().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', halt); process.once('SIGTERM', halt);
  await resident.closed;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^(?:RESIDENT_[A-Z_]+|EADDRINUSE|EACCES|EPERM|ENOENT)$/.test(error?.code ?? '') ? error.code : 'RESIDENT_START_OR_STOP_FAILED';
    console.error(`BLACKHOLE resident error: ${code}. Use status and the local diagnostic checks.`);
    process.exitCode = 1;
  });
}
