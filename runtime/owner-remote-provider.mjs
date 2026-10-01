import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from './lib/store.mjs';
import { validateDesktopProviders } from './lib/desktop-provider-config.mjs';
import { assertNoSecrets } from './lib/jev.mjs';
import { residentProviderCrypto, validateResidentConfig } from './resident.mjs';

export async function ownerRemoteProvider(home, input, fetchImpl = fetch, protect = residentProviderCrypto, write = atomicWrite) {
  if (!path.isAbsolute(home) || !input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'apiKey,model,provider') throw new Error('OWNER_PROVIDER_INPUT_INVALID');
  const configFile = path.join(home, 'config.json');
  const config = validateResidentConfig(JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')));
  const providers = validateDesktopProviders({ version: 1, providers: [input], primaryProvider: input.provider, dailyCallLimit: 2 });
  if (input.provider === 'local') throw new Error('OWNER_REMOTE_PROVIDER_REQUIRED');
  const providerFile = path.join(path.dirname(config.tokenFile), 'provider.dpapi');
  if (fs.existsSync(providerFile) && (!fs.lstatSync(providerFile).isFile() || fs.lstatSync(providerFile).isSymbolicLink())) throw new Error('OWNER_PROVIDER_FILE_UNSAFE');
  const token = fs.readFileSync(config.tokenFile, 'utf8').replace(/^\uFEFF/, '').trim();
  const origin = `http://127.0.0.1:${config.port}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const stateResponse = await fetchImpl(`${origin}/api/state`, { redirect: 'error', signal: AbortSignal.timeout(5000), headers });
  if (!stateResponse.ok) throw new Error('OWNER_CORE_NOT_READY');
  const state = await stateResponse.json();
  if (state.jobs.some(job => ['queued', 'running'].includes(job.status))) throw new Error('OWNER_WAIT_FOR_ACTIVE_JOBS');
  const settingsResponse = await fetchImpl(`${origin}/api/settings`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers,
    body: JSON.stringify({ requestId: crypto.randomUUID(), modules: { ai: false } }) });
  if (!settingsResponse.ok) throw new Error('OWNER_DISABLE_AI_FAILED');
  const encoded = Buffer.from(JSON.stringify(providers), 'utf8').toString('base64');
  const encrypted = await protect('Protect', encoded);
  if (typeof encrypted !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted) || encrypted.length > 32768) throw new Error('OWNER_PROVIDER_ENCRYPTION_FAILED');
  const next = { ...config, providerFile };
  delete next.localModel;
  validateResidentConfig(next);
  // Keep the selected ciphertext intact if the config commit is rejected.
  // Both files are private, but a failed save must not silently rotate the
  // provider used by the still-selected resident configuration.
  const previousCiphertext = fs.existsSync(providerFile) ? fs.readFileSync(providerFile, 'utf8') : null;
  write(providerFile, encrypted + '\n');
  try {
    write(configFile, JSON.stringify(next) + '\n');
  } catch (error) {
    try {
      if (previousCiphertext === null) fs.unlinkSync(providerFile);
      else write(providerFile, previousCiphertext);
    } catch { throw new Error('OWNER_PROVIDER_ROLLBACK_FAILED', { cause: error }); }
    throw error;
  }
  return { saved: true, provider: input.provider, model: input.model, requiresRestart: true, aiEnabled: false };
}

export async function ownerRemoteProviderTest(home, fetchImpl = fetch) {
  if (!path.isAbsolute(home)) throw new Error('OWNER_PROVIDER_HOME_INVALID');
  const config = validateResidentConfig(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8').replace(/^\uFEFF/, '')));
  if (!config.providerFile) throw new Error('OWNER_PROVIDER_NOT_CONFIGURED');
  const token = fs.readFileSync(config.tokenFile, 'utf8').replace(/^\uFEFF/, '').trim();
  const origin = `http://127.0.0.1:${config.port}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const call = async (route, body) => {
    const response = await fetchImpl(origin + route, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers,
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error('OWNER_PROVIDER_TEST_UNAVAILABLE');
    return response.json();
  };
  const state = await call('/api/state');
  if (state.jobs.some(job => ['queued', 'running'].includes(job.status))) throw new Error('OWNER_WAIT_FOR_ACTIVE_JOBS');
  const started = await call('/api/self-test', { requestId: crypto.randomUUID(), liveProvider: true, oneShot: true });
  const id = started.selfTest?.id;
  if (!id) throw new Error('OWNER_PROVIDER_TEST_UNAVAILABLE');
  let item = started.selfTest;
  for (let attempt = 0; attempt < 20 && item.providerLive?.status === 'REQUESTED'; attempt++) {
    const history = await call('/api/self-test');
    item = history.history?.find(record => record.id === id) ?? item;
    if (item.providerLive?.status !== 'REQUESTED') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { status: item.providerLive?.status ?? 'REQUESTED', reason: item.providerLive?.reason ?? null, jobId: item.providerLive?.jobId ?? null };
}

export async function ownerRemoteConnectors(home, input, fetchImpl = fetch) {
  if (typeof home !== 'string' || !path.isAbsolute(home) || !input || typeof input !== 'object' || Array.isArray(input)
    || !((input.action === 'list' && Object.keys(input).join(',') === 'action')
      || (input.action === 'check' && Object.keys(input).sort().join(',') === 'action,id'
        && typeof input.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(input.id)))) throw new Error('OWNER_CONNECTOR_INPUT_INVALID');
  const config = validateResidentConfig(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8').replace(/^\uFEFF/, '')));
  const token = fs.readFileSync(config.tokenFile, 'utf8').replace(/^\uFEFF/, '').trim();
  const checking = input.action === 'check';
  const route = checking ? `/api/connectors/${input.id}/check` : '/api/connectors';
  let response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${config.port}${route}`, {
      method: checking ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(checking ? 45000 : 10000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(checking ? { body: JSON.stringify({ requestId: crypto.randomUUID() }) } : {}),
    });
  } catch { throw new Error('OWNER_CONNECTOR_UNAVAILABLE'); }
  if (!response.ok) throw new Error('OWNER_CONNECTOR_UNAVAILABLE');
  try {
    const result = await response.json();
    if (JSON.stringify(result).includes(token) || (checking
      ? Object.keys(result).join(',') !== 'connector' || result.connector?.id !== input.id
      : Object.keys(result).join(',') !== 'connectors' || !Array.isArray(result.connectors))) throw new Error('Invalid connector response');
    const secretScan = structuredClone(result);
    for (const row of checking ? [secretScan.connector] : secretScan.connectors) {
      const evidence = row?.lastCheck?.evidence;
      if (evidence && Object.hasOwn(evidence, 'maxOutputTokens')) {
        // This exact numeric generation bound is evidence, not a credential.
        if (evidence.maxOutputTokens !== 8) throw new Error('Invalid generation bound');
        delete evidence.maxOutputTokens;
      }
    }
    assertNoSecrets(secretScan);
    return result;
  } catch { throw new Error('OWNER_CONNECTOR_RESPONSE_INVALID'); }
}
