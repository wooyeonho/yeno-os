// BLACKHOLE xAI Grok Provider Adapter — pure policy layer only.
//
// This module invents no second provider/router/job stack. Grok already
// flows through the existing generic transport in agent-engine.mjs (the
// same OpenAI-style chat-completions path every non-Anthropic provider
// uses) and the existing owner-declared configuration in
// provider-config-engine.mjs (`agentProfiles(env).grok`, sourced from
// YENO_GROK_*/YENO_XAI_* env vars, already used by the semantic verifier
// for provider diversity). What this module adds is the one genuinely new
// thing the mission asks for: declared modes (single-agent vs
// multi-agent), an honest, evidence-only status/failure-state report, and
// a real, durable owner-approval gate for the multi-agent tier above its
// default agent count. It does not call any provider, does not add tools,
// and does not grant any execution authority.
export const GROK_PROVIDER = 'xai';
export const GROK_DEFAULT_MODEL = 'grok-4.6';
export const GROK_MULTI_AGENT_MODEL = 'grok-4.20-multi-agent';
export const GROK_MODES = Object.freeze(['single-agent', 'multi-agent']);
export const GROK_DEFAULT_MULTI_AGENT_COUNT = 4;
export const GROK_MAX_MULTI_AGENT_COUNT = 16;

// Every capability the mission names, honestly marked enabled only where an
// actual tool already exists in the existing policy boundary
// (agent-engine.mjs's AGENT_TOOLS, which today is read-only for every
// provider, Grok included). Nothing here grants Grok anything another
// provider does not already have; nothing is enabled by naming it.
export const GROK_CAPABILITIES = Object.freeze([
  'text_generation', 'structured_output', 'function_calling',
  'web_search', 'x_search', 'code_execution', 'image_generation', 'video_generation', 'remote_mcp',
]);
const ENABLED_CAPABILITIES = Object.freeze(['text_generation', 'structured_output', 'function_calling']);

export const GROK_FAILURE_STATES = Object.freeze(['unavailable', 'unauthorized', 'rate_limited', 'cost_limited', 'degraded', 'quarantined']);
export const GROK_STATES = Object.freeze(['available', ...GROK_FAILURE_STATES]);

const SECRET_KEY = /key|secret|token|password|credential|authorization/i;
const SECRET_VALUE = /^(?:sk-|xai-|nvapi-|AIza|ya29\.|Bearer\s)/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && UUID.test(value);

export class GrokAdapterError extends Error {
  constructor(code) { super(`Grok: ${code}`); this.code = code; this.status = 400; }
}
const fail = code => { throw new GrokAdapterError(code); };

// Owner (or contained caller) safety: no credential-shaped field or value
// may ever leave this module - mirrors the exact same discipline jev.mjs
// and model-router.mjs already apply to their own owner-facing output.
export function assertNoSecrets(value, path = '$') {
  if (typeof value === 'string') { if (SECRET_VALUE.test(value)) fail('secret_value_leak'); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`)); return; }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) fail('secret_field_leak');
      assertNoSecrets(item, `${path}.${key}`);
    }
  }
}

// Each capability's declared, honestly-labeled reachability. This never
// changes what the model can do - it only reports whether the existing tool
// policy boundary already exposes it, so a caller can never present a
// declared capability as active when no tool implements it.
export function grokCapabilityReport() {
  return GROK_CAPABILITIES.map(capability => ({
    capability,
    enabled: ENABLED_CAPABILITIES.includes(capability),
    reason: ENABLED_CAPABILITIES.includes(capability) ? 'reuses_existing_generic_transport' : 'not_in_existing_tool_policy_boundary',
  }));
}

// A mode+agentCount request is only ever valid against a real, durable
// owner approval record for that count - never a client-supplied boolean,
// never inferred from anything else. `approval` is null (no approval on
// file) or the exact {requestId, approvedAgentCount, approvedAt} shape
// validateGrokMultiAgentApproval already accepted.
export function validateGrokModeRequest({ mode, agentCount }, { approval = null } = {}) {
  if (!GROK_MODES.includes(mode)) fail('invalid_mode');
  if (mode === 'single-agent') {
    if (agentCount !== undefined && agentCount !== 1) fail('single_agent_mode_requires_one_agent');
    return { mode, model: GROK_DEFAULT_MODEL, agentCount: 1, approvalRequired: false, approved: true };
  }
  const count = agentCount ?? GROK_DEFAULT_MULTI_AGENT_COUNT;
  if (!Number.isSafeInteger(count) || count < 1 || count > GROK_MAX_MULTI_AGENT_COUNT) fail('invalid_agent_count');
  const approvalRequired = count > GROK_DEFAULT_MULTI_AGENT_COUNT;
  const approved = !approvalRequired || (approval !== null && approval.approvedAgentCount >= count);
  if (approvalRequired && !approved) fail('owner_approval_required');
  return { mode, model: GROK_MULTI_AGENT_MODEL, agentCount: count, approvalRequired, approved };
}

const APPROVAL_FIELDS = Object.freeze(['requestId', 'approvedAgentCount', 'approvedAt']);
export function validateGrokMultiAgentApproval(approval) {
  if (approval === null) return;
  if (!exact(approval, APPROVAL_FIELDS)) fail('invalid_approval_shape');
  if (typeof approval.requestId !== 'string' || !approval.requestId.trim() || approval.requestId.length > 160) fail('invalid_approval_request_id');
  if (!Number.isSafeInteger(approval.approvedAgentCount) || approval.approvedAgentCount < 1 || approval.approvedAgentCount > GROK_MAX_MULTI_AGENT_COUNT) fail('invalid_approval_agent_count');
  if (typeof approval.approvedAt !== 'string' || !ISO.test(approval.approvedAt)) fail('invalid_approval_timestamp');
  assertNoSecrets(approval);
}

// Real evidence only, never guessed:
// - `profile` is provider-config-engine's own agentProfiles(env).grok (or an
//   equivalent shape) - `ready`/`missing` are already computed from real
//   configured key/model/dailyCallLimit, never re-derived here.
// - `usage` is agentUsage(state.jobs, at) - real recorded call receipts for
//   today, exactly what the deterministic dailyCallLimit gate already uses.
// - `quarantined` is a real, owner-set flag (never inferred).
// - `costEvidence` is optional real {used, limit} numbers from wherever
//   actual dollar-cost tracking exists; absent means "not yet trackable",
//   which never fabricates a cost_limited state.
// A provider is reported `available` only when none of the honest failure
// checks below fire - never asserted positively from configuration alone.
export function grokStatus({ profile, usage, quarantined = false, costEvidence = null }) {
  if (!object(profile) || typeof profile.ready !== 'boolean' || !Array.isArray(profile.missing) || !Number.isSafeInteger(profile.dailyCallLimit) || profile.dailyCallLimit < 0) fail('invalid_profile');
  if (!object(usage) || !Number.isSafeInteger(usage.attempts) || !Number.isSafeInteger(usage.unknown)) fail('invalid_usage');
  if (quarantined) return { state: 'quarantined', ready: false, evidence: { quarantined: true } };
  // A missing model means nothing is even declared to call - 'unavailable' -
  // regardless of whether a key also happens to be missing. Only once a
  // model is actually declared does a missing key mean specifically
  // 'unauthorized' (a real intent to use Grok that cannot authenticate).
  if (profile.missing.includes('model')) return { state: 'unavailable', ready: false, evidence: { missing: [...profile.missing] } };
  if (profile.missing.includes('key')) return { state: 'unauthorized', ready: false, evidence: { missing: [...profile.missing] } };
  if (!profile.ready) return { state: 'unavailable', ready: false, evidence: { missing: [...profile.missing] } };
  if (costEvidence !== null) {
    if (!object(costEvidence) || !Number.isFinite(costEvidence.used) || !Number.isFinite(costEvidence.limit) || costEvidence.limit <= 0) fail('invalid_cost_evidence');
    if (costEvidence.used >= costEvidence.limit) return { state: 'cost_limited', ready: false, evidence: { costEvidence: { ...costEvidence } } };
  }
  if (usage.attempts >= profile.dailyCallLimit) return { state: 'rate_limited', ready: false, evidence: { attempts: usage.attempts, dailyCallLimit: profile.dailyCallLimit } };
  if (usage.attempts > 0 && usage.unknown > 0) return { state: 'degraded', ready: true, evidence: { attempts: usage.attempts, unknown: usage.unknown } };
  return { state: 'available', ready: true, evidence: {} };
}

export function validateGrokStatus(status) {
  if (!object(status) || Object.keys(status).sort().join() !== ['evidence', 'ready', 'state'].join()) fail('invalid_status_shape');
  if (!GROK_STATES.includes(status.state)) fail('invalid_status_state');
  if (typeof status.ready !== 'boolean') fail('invalid_status_ready');
  if (!object(status.evidence)) fail('invalid_status_evidence');
  assertNoSecrets(status);
}
