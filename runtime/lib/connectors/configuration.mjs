import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {agentConfigForProvider} from '../provider-config-engine.mjs';

const require = createRequire(import.meta.url);

function trustedCa(dataDir) {
  if (typeof dataDir !== 'string') return '';
  try {
    const filename = path.join(dataDir, 'obsidian-local-rest-api.crt');
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 16384) return '';
    return fs.readFileSync(filename, 'utf8');
  } catch { return ''; }
}

function ollama(env) {
  const identity = ['YENO_LOCAL_BASE_URL', 'YENO_LOCAL_MODEL', 'YENO_AGENT_PROVIDER',
    'YENO_AGENT_MODEL', 'YENO_AGENT_DAILY_CALL_LIMIT', 'YENO_AGENT_DAILY_COST_LIMIT_USD']
    .map(key => env[key] ?? null);
  try {
    const config = agentConfigForProvider(env, 'local');
    return {signature: JSON.stringify(identity), status: config.ready ? 'installed' : 'needs_owner',
      reason: config.ready ? 'ready_for_check' : 'configuration_required',
      endpoint: config.endpoint, model: config.model, ready: config.ready};
  } catch {
    return {signature: JSON.stringify(identity), status: 'blocked', reason: 'invalid_configuration', ready: false};
  }
}

function obsidian(env, dataDir) {
  const endpoint = env.YENO_OBSIDIAN_REST_ENDPOINT ?? 'https://127.0.0.1:27124/';
  const apiKey = env.YENO_OBSIDIAN_REST_API_KEY;
  const enabled = env.YENO_OBSIDIAN_REST_ENABLED;
  const caPem = trustedCa(dataDir);
  const base = {signature: JSON.stringify([enabled, endpoint, apiKey, caPem]), endpoint, apiKey, caPem, ready: false};
  if (enabled !== 'true') return {...base, status: 'needs_owner', reason: 'disabled'};
  let url;
  try { url = new URL(endpoint); } catch { return {...base, status: 'blocked', reason: 'invalid_configuration'}; }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return {...base, status: 'blocked', reason: 'invalid_configuration'};
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) return {...base, status: 'needs_owner', reason: 'configuration_required'};
  if (url.protocol === 'https:' && !caPem) return {...base, status: 'needs_owner', reason: 'trusted_ca_required'};
  return {...base, status: 'installed', reason: 'ready_for_check', ready: true};
}

// Private signatures compare configuration inside this process only. They must
// never enter persisted state, logs, status responses, or evidence hashes.
export function connectorConfiguration(id, {env, dataDir}) {
  switch (id) {
    case 'quantum-circuit': {
      try {
        require.resolve('quantum-circuit');
        return {signature: 'quantum-circuit@0.9.251', status: 'installed', reason: 'ready_for_check', ready: true};
      } catch { return {signature: '', status: 'not_installed', reason: 'dependency_not_installed', ready: false}; }
    }
    case 'ollama': return ollama(env);
    case 'obsidian': return obsidian(env, dataDir);
    default: return {signature: '', status: 'not_implemented', reason: 'connector_probe_not_implemented', ready: false};
  }
}
