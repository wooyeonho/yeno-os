// Provider credentials stay bound to their own fixed endpoint. Selection happens
// once at startup; a failed/unknown request is never retried on another provider.
export const AGENT_ENDPOINTS = Object.freeze({
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  moonshot: 'https://api.moonshot.ai/v1/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
});
const PROVIDERS = Object.keys(AGENT_ENDPOINTS);
export class AgentError extends Error { constructor(code) { super(`Agent: ${code}`); this.code = code; } }

function entry(env, provider, legacy, dailyCallLimit) {
  const prefix = `YENO_${provider.toUpperCase()}`;
  // Never mix a scoped model with a generic key (or the reverse). An explicit
  // provider can keep its old complete YENO_AGENT_* credential/model pair.
  const scoped = env[`${prefix}_MODEL`] !== undefined || env[`${prefix}_API_KEY`] !== undefined;
  const model = (scoped ? env[`${prefix}_MODEL`] : legacy ? env.YENO_AGENT_MODEL : '') || '';
  const key = (scoped ? env[`${prefix}_API_KEY`] : legacy ? env.YENO_AGENT_API_KEY : '') || '';
  const valid = typeof model === 'string' && typeof key === 'string' && model.length <= 120 && !/[\u0000-\u001f\u007f]/.test(model + key);
  const missing = !valid ? ['invalidConfiguration'] : [!model.trim() && 'model', !key.trim() && 'key', !dailyCallLimit && 'callLimit'].filter(Boolean);
  return {provider, model: valid ? model : '', key: valid ? key : '', endpoint: AGENT_ENDPOINTS[provider], dailyCallLimit, ready: missing.length === 0, valid, missing};
}

export function agentConfig(env) {
  const requested = env.YENO_AGENT_PROVIDER || 'anthropic';
  const limit = env.YENO_AGENT_DAILY_CALL_LIMIT || '0';
  if ((requested !== 'auto' && !Object.hasOwn(AGENT_ENDPOINTS, requested)) || !/^(?:0|[1-9]|1[0-9]|20)$/.test(limit)) throw new AgentError('invalid_configuration');
  const automatic = requested === 'auto';
  const order = automatic ? (env.YENO_AGENT_PROVIDER_ORDER || PROVIDERS.join(',')).split(',').map(s => s.trim()) : [requested];
  if (!order.length || new Set(order).size !== order.length || order.some(p => !Object.hasOwn(AGENT_ENDPOINTS, p))) throw new AgentError('invalid_provider_order');
  const choices = PROVIDERS.map(provider => entry(env, provider, !automatic && provider === requested, Number(limit)));
  const selected = (automatic && order.map(provider => choices.find(c => c.provider === provider)).find(c => c.ready)) || choices.find(c => c.provider === order[0]);
  if (!automatic && !selected.valid) throw new AgentError('invalid_configuration');
  const {valid, missing, ...config} = selected;
  return {...config, auto: env.YENO_AGENT_AUTORUN === 'true', selectionMode: automatic ? 'configured-order' : 'explicit',
    // Status is a whitelist: never expose keys or raw environment variables.
    providers: choices.map(c => ({provider:c.provider, model:c.model || null, eligible:order.includes(c.provider), configured:c.ready, missing:c.missing}))};
}

export function agentProfiles(env) {
  const primary = agentConfig(env);
  const grok = agentConfig({YENO_AGENT_PROVIDER:'xai',
    YENO_AGENT_MODEL:env.YENO_GROK_MODEL || env.YENO_XAI_MODEL || '',
    YENO_AGENT_API_KEY:env.YENO_GROK_API_KEY || env.YENO_XAI_API_KEY || '',
    YENO_AGENT_DAILY_CALL_LIMIT:env.YENO_GROK_DAILY_CALL_LIMIT || '0'});
  grok.dailyCallLimit = Math.min(primary.dailyCallLimit, grok.dailyCallLimit);
  grok.ready = grok.ready && grok.dailyCallLimit > 0;
  return {primary, grok};
}
