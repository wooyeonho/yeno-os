// BLACKHOLE typed browser-decision provider routing contract.
//
// This module is policy only. It reuses the existing provider configuration
// and never calls a provider. Browser decisions require a typed Jev adapter;
// generic GPT/Gemini/Grok/Kimi/NVIDIA text providers are reported honestly
// but cannot be used as a typed-decision fallback.
//
// A configured environment is not live proof. "configured" means only that
// the owner supplied an HTTPS endpoint, model, credential name/value, and an
// explicit confirmation flag. The credential itself never enters a result.
import {configuredProviders} from './model-router.mjs';

export const BROWSER_PROVIDER_ROUTING_VERSION = 1;
export const BROWSER_DECISION_TASK = 'browser-decision';
export const BROWSER_TYPED_PROVIDER = 'typesafe-jev';
export const GENERIC_DECISION_PROVIDERS = Object.freeze(['openai', 'anthropic', 'gemini', 'xai', 'moonshot', 'nvidia']);
export const BROWSER_DECISION_STATES = Object.freeze(['configured', 'unavailable', 'invalid']);
const ISO = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$/;
const URL_MAX = 2000;
const ROUTE_FIELDS = Object.freeze(['version', 'task', 'provider', 'model', 'status', 'typedDecision', 'authorizesCall', 'reason', 'observedAt']);

export class BrowserProviderRoutingError extends Error {
  constructor(code) { super('Browser provider routing: ' + code); this.code = code; this.status = 400; }
}
const fail = code => { throw new BrowserProviderRoutingError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const nonEmpty = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const safeModel = value => value === null || (typeof value === 'string' && /^[A-Za-z0-9._\\/:@-]{1,160}$/.test(value));

function endpointStatus(env) {
  const endpoint = env.YENO_JEV_BASE_URL;
  if (!nonEmpty(endpoint, URL_MAX)) return {valid: false, reason: 'official_endpoint_missing'};
  let parsed;
  try { parsed = new URL(endpoint); } catch { return {valid: false, reason: 'official_endpoint_invalid'}; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return {valid: false, reason: 'official_endpoint_must_be_https_without_credentials_or_query'}; 
  return {valid: true, reason: null};
}

// This is an environment/configuration status, not a health check. The only
// positive state is "configured"; a live call is a later, owner-approved
// acceptance with a real provider.
export function typesafeJevDecisionStatus(env = process.env) {
  const missing = [];
  const endpoint = endpointStatus(env);
  if (!endpoint.valid) missing.push('YENO_JEV_BASE_URL');
  if (!nonEmpty(env.YENO_JEV_API_KEY, 4096)) missing.push('YENO_JEV_API_KEY');
  if (!nonEmpty(env.YENO_JEV_MODEL, 160)) missing.push('YENO_JEV_MODEL');
  if (env.YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED !== 'true') missing.push('YENO_JEV_OFFICIAL_ENDPOINT_CONFIRMED');
  if (missing.length) {
    return {
      provider: BROWSER_TYPED_PROVIDER,
      model: nonEmpty(env.YENO_JEV_MODEL, 160) ? env.YENO_JEV_MODEL : null,
      status: 'unavailable',
      typedDecision: true,
      configured: false,
      missing: [...new Set(missing)],
      reason: endpoint.valid ? 'official_endpoint_or_credential_not_configured' : endpoint.reason
    };
  }
  return {
    provider: BROWSER_TYPED_PROVIDER,
    model: env.YENO_JEV_MODEL,
    status: 'configured',
    typedDecision: true,
    configured: true,
    missing: [],
    reason: null
  };
}

function genericProviderStatuses(env) {
  let entries;
  try { entries = configuredProviders(env); }
  catch { entries = {}; }
  return GENERIC_DECISION_PROVIDERS.map(provider => {
    const entry = entries[provider] ?? {model: null, configured: false, missing: ['configuration']};
    return {
      provider,
      model: safeModel(entry.model) ? entry.model : null,
      status: entry.configured === true ? 'configured' : 'unavailable',
      typedDecision: false,
      configured: entry.configured === true,
      missing: Array.isArray(entry.missing) ? [...entry.missing] : ['configuration'],
      reason: entry.configured === true ? 'generic_text_provider_not_typed_decision_adapter' : 'provider_not_configured'
    };
  });
}

// Public status contains no endpoint, key, headers, or raw environment. It is
// safe to store in state and show in the phone/Web UI.
export function browserDecisionProviderStatuses(env = process.env) {
  return [typesafeJevDecisionStatus(env), ...genericProviderStatuses(env)];
}

export function validateBrowserDecisionProviderStatus(status) {
  const keys = ['provider', 'model', 'status', 'typedDecision', 'configured', 'missing', 'reason'];
  if (!exact(status, keys)) fail('invalid_provider_status_shape');
  if (typeof status.provider !== 'string' || !/^[a-z0-9-]{1,80}$/.test(status.provider)) fail('invalid_provider');
  if (!safeModel(status.model)) fail('invalid_model');
  if (!BROWSER_DECISION_STATES.includes(status.status) || typeof status.typedDecision !== 'boolean' || typeof status.configured !== 'boolean') fail('invalid_provider_status');
  if (!Array.isArray(status.missing) || status.missing.some(item => typeof item !== 'string' || item.length > 120)) fail('invalid_missing');
  if (status.status === 'configured' && (!status.configured || status.missing.length)) fail('configured_status_inconsistent');
  if (status.status !== 'configured' && status.configured) fail('unavailable_status_inconsistent');
  if (status.provider === BROWSER_TYPED_PROVIDER && !status.typedDecision) fail('jev_must_be_typed');
  if (!status.typedDecision && status.provider === BROWSER_TYPED_PROVIDER) fail('jev_typed_flag_required');
  return true;
}

export function routeBrowserDecision({env = process.env, at, ownerProvider = null} = {}) {
  if (typeof at !== 'string' || !ISO.test(at)) fail('invalid_observed_at');
  if (ownerProvider !== null && ownerProvider !== BROWSER_TYPED_PROVIDER) fail('generic_provider_cannot_authorize_typed_decision');
  const statuses = browserDecisionProviderStatuses(env);
  const jev = statuses.find(item => item.provider === BROWSER_TYPED_PROVIDER);
  const selected = jev?.status === 'configured' ? jev : null;
  const route = {
    version: BROWSER_PROVIDER_ROUTING_VERSION,
    task: BROWSER_DECISION_TASK,
    provider: selected?.provider ?? null,
    model: selected?.model ?? null,
    status: selected?.status ?? 'unavailable',
    typedDecision: selected?.typedDecision === true,
    authorizesCall: false,
    reason: selected ? 'typed_jev_configured_but_live_acceptance_pending' : 'typed_jev_unavailable_no_text_fallback',
    observedAt: at
  };
  validateBrowserDecisionRoute(route);
  return {route, providers: statuses};
}

export function validateBrowserDecisionRoute(route) {
  if (!exact(route, ROUTE_FIELDS)) fail('invalid_route_shape');
  if (route.version !== BROWSER_PROVIDER_ROUTING_VERSION || route.task !== BROWSER_DECISION_TASK) fail('invalid_route_version');
  if (route.provider !== null && typeof route.provider !== 'string') fail('invalid_route_provider');
  if (!safeModel(route.model)) fail('invalid_route_model');
  if (!BROWSER_DECISION_STATES.includes(route.status)) fail('invalid_route_status');
  if (typeof route.typedDecision !== 'boolean' || typeof route.authorizesCall !== 'boolean' || route.authorizesCall !== false) fail('route_authority_forbidden');
  if (route.status === 'configured' && (route.provider !== BROWSER_TYPED_PROVIDER || route.typedDecision !== true)) fail('only_typed_jev_may_be_configured');
  if (route.status !== 'configured' && (route.provider !== null || route.model !== null || route.typedDecision)) fail('unavailable_route_must_not_select');
  if (typeof route.reason !== 'string' || route.reason.length < 1 || route.reason.length > 200 || !ISO.test(route.observedAt)) fail('invalid_route_evidence');
  return true;
}

export function validateBrowserDecisionProviderSnapshot(snapshot) {
  if (!object(snapshot) || !exact(snapshot, ['route', 'providers'])) fail('invalid_provider_snapshot');
  validateBrowserDecisionRoute(snapshot.route);
  if (!Array.isArray(snapshot.providers) || snapshot.providers.length !== 1 + GENERIC_DECISION_PROVIDERS.length) fail('invalid_provider_snapshot');
  const seen = new Set();
  for (const status of snapshot.providers) {
    validateBrowserDecisionProviderStatus(status);
    if (seen.has(status.provider)) fail('duplicate_provider');
    seen.add(status.provider);
  }
  if (!seen.has(BROWSER_TYPED_PROVIDER)) fail('missing_typed_provider');
  return true;
}
