import { AGENT_ENDPOINTS, agentConfig } from './provider-config-engine.mjs';

// Configuration only: no network, persistence, model discovery, AI enabling or
// new router. The desktop host must encrypt this private input before storage.
// Credential presence is not provider authentication or permission to run jobs.
export class DesktopProviderConfigError extends Error {
  constructor() {
    super('Desktop provider configuration is invalid.');
    this.name = 'DesktopProviderConfigError';
    this.code = 'invalid_desktop_provider_configuration';
  }
}

const invalid = () => { throw new DesktopProviderConfigError(); };
const providerIds = Object.freeze(Object.keys(AGENT_ENDPOINTS));
const configFields = ['version', 'providers', 'primaryProvider', 'dailyCallLimit'];
const providerFields = ['provider', 'model', 'apiKey'];
export const EMPTY_DESKTOP_PROVIDERS = Object.freeze({
  version: 1, providers: Object.freeze([]), primaryProvider: null, dailyCallLimit: 1,
});

// Accept JSON-shaped data, not objects with behavior/getters or hidden fields.
function exactRecord(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) invalid();
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
  }
}

function exactArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > providerIds.length) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) invalid();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
  }
}

/** Return a detached validated private record. Never send this to a status UI. */
export function validateDesktopProviders(input) {
  exactRecord(input, configFields);
  if (input.version !== 1 || !Number.isSafeInteger(input.dailyCallLimit) || input.dailyCallLimit < 1 || input.dailyCallLimit > 20) invalid();
  exactArray(input.providers);
  const seen = new Set();
  const providers = input.providers.map(entry => {
    exactRecord(entry, providerFields);
    const { provider, model, apiKey } = entry;
    if (typeof provider !== 'string' || !Object.hasOwn(AGENT_ENDPOINTS, provider) || seen.has(provider)) invalid();
    // No inferred model IDs or user-controlled URLs; owner supplies the actual
    // provider's model identifier. Disallow common credentials pasted as a model.
    if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,119}$/.test(model)
      || model.includes('://') || /^(?:sk-|nvapi-|AIza)/.test(model)) invalid();
    if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 4096 || !/^[\x21-\x7e]+$/.test(apiKey)) invalid();
    seen.add(provider);
    return { provider, model, apiKey };
  });
  if (providers.length ? (typeof input.primaryProvider !== 'string' || !seen.has(input.primaryProvider)) : input.primaryProvider !== null) invalid();
  // A mistakenly pasted key must not become a public model label, even if it
  // belongs to a different provider in this same saved configuration.
  if (providers.some(entry => providers.some(secret => entry.model.includes(secret.apiKey)))) invalid();
  return { version: 1, providers, primaryProvider: input.primaryProvider, dailyCallLimit: input.dailyCallLimit };
}

/** Fresh server options.env. Never spread process.env or an earlier key set. */
export function desktopProviderEnvironment(input) {
  const config = validateDesktopProviders(input);
  const env = {
    NODE_ENV: 'production',
    YENO_DEVELOPMENT_BACKGROUND_MODEL_CALLS: 'false',
    YENO_AGENT_AUTORUN: 'false',
    YENO_AGENT_PROVIDER: config.primaryProvider ?? 'auto',
    YENO_AGENT_DAILY_CALL_LIMIT: String(config.dailyCallLimit),
    YENO_GROK_DAILY_CALL_LIMIT: config.providers.some(entry => entry.provider === 'xai') ? String(config.dailyCallLimit) : '0',
  };
  for (const { provider, model, apiKey } of config.providers) {
    const prefix = `YENO_${provider.toUpperCase()}`;
    env[`${prefix}_MODEL`] = model;
    env[`${prefix}_API_KEY`] = apiKey;
  }
  // Reuse the existing configuration engine as the final compatibility gate.
  agentConfig(env);
  return env;
}

/** Safe, allowlisted metadata only. 'configured' never means a live call passed. */
export function desktopProviderSummary(input) {
  const config = validateDesktopProviders(input);
  const actual = agentConfig(desktopProviderEnvironment(config));
  return {
    version: 1,
    configured: actual.ready,
    primaryProvider: config.primaryProvider,
    dailyCallLimit: config.dailyCallLimit,
    automaticCalls: false,
    liveVerification: 'not_checked',
    providers: actual.providers.map(({ provider, model, configured }) => ({
      provider, model, configured, status: configured ? 'configured' : 'not_configured', liveVerification: 'not_checked',
    })),
  };
}
