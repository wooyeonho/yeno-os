import {connectorDescriptors} from './descriptors.mjs';
import {connectorConfiguration} from './configuration.mjs';
import {probeConnector} from './probes.mjs';

export class ConnectorError extends Error {
  constructor(code, status, retryAfterSeconds = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function createConnectorRegistry({env = {}, dataDir, now = Date.now,
  ttlMs = 300000, cooldownMs = 30000, timeoutMs = 10000, fetchImpl, ollamaProbe, synthetic = false} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 3600000
      || !Number.isSafeInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 3600000
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new ConnectorError('connector_invalid_limits', 400);
  const descriptors = connectorDescriptors();
  const receipts = new Map();
  const attempts = new Map();
  const signatures = new Map();
  const invalidated = new Set();
  let active = null;
  const configuration = id => {
    const config = connectorConfiguration(id, {env, dataDir});
    if (signatures.has(id) && signatures.get(id) !== config.signature) {
      receipts.delete(id);
      invalidated.add(id);
    }
    signatures.set(id, config.signature);
    return config;
  };
  function status(descriptor) {
    const config = configuration(descriptor.id);
    const receipt = receipts.get(descriptor.id);
    const fresh = receipt && now() < Date.parse(receipt.expiresAt);
    return {...structuredClone(descriptor), status: !config.ready ? config.status : fresh ? (receipt.ok ? 'connected' : 'blocked') : config.status,
      reason: !config.ready ? config.reason : fresh ? (receipt.ok ? 'check_passed' : receipt.failure) : receipt ? 'check_expired' : invalidated.has(descriptor.id) ? 'config_changed' : config.reason,
      canCheck: config.ready, checking: active === descriptor.id, lastCheck: receipt ? structuredClone(receipt) : null};
  }
  return {
    list: () => descriptors.map(status),
    async check(id) {
      const descriptor = descriptors.find(item => item.id === id);
      if (!descriptor) throw new ConnectorError('connector_not_found', 404);
      const config = configuration(id);
      if (!config.ready) return status(descriptor);
      if (active !== null) throw new ConnectorError('connector_busy', 409);
      const started = now();
      const previous = attempts.get(id);
      if (previous !== undefined && started - previous < cooldownMs) {
        throw new ConnectorError('connector_rate_limited', 429, Math.max(1, Math.ceil((cooldownMs - started + previous) / 1000)));
      }
      attempts.set(id, started);
      active = id;
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new ConnectorError('connector_timeout', 504));
      }, timeoutMs); });
      const probe = probeConnector(id, config, {fetchImpl: fetchImpl ?? fetch, signal: controller.signal,
        ollamaProbe, synthetic: synthetic || fetchImpl !== undefined});
      // A timed-out adapter keeps the serial lock until its underlying request
      // settles. Existing Obsidian HTTPS also has its own 5-second abort bound.
      probe.then(() => { active = null; }, () => { active = null; });
      let receipt;
      try {
        const evidence = await Promise.race([probe, timeout]);
        receipt = {ok: true, evidence};
      } catch {
        receipt = {ok: false, evidence: null, failure: controller.signal.aborted ? 'check_timeout' : 'check_failed'};
      } finally { clearTimeout(timer); }
      const checked = now();
      if (configuration(id).signature !== config.signature) return status(descriptor);
      const evidenceClass = id === 'quantum-circuit' ? 'live' : synthetic || fetchImpl !== undefined ? 'synthetic' : 'live';
      receipts.set(id, {...receipt, evidenceClass, checkedAt: new Date(checked).toISOString(),
        expiresAt: new Date(checked + ttlMs).toISOString(), roundTripMs: Math.max(0, checked - started)});
      invalidated.delete(id);
      return status(descriptor);
    },
  };
}
