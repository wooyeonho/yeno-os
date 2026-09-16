import crypto from 'node:crypto';
import {AGENT_ENDPOINTS, agentConfig} from './provider-config-engine.mjs';

// BLACKHOLE Multi-Model Router (pure policy, no wiring yet).
//
//   task request -> Brain Pool (owner-declared per-model metadata + configured
//   evidence from provider-config) -> ranked eligible candidates -> one
//   selection + durable provenance -> pure failover verdicts.
//
// Nothing here calls a provider, reads a key into a result, or grants a call.
// Every capability, cost and quota fact is owner-declared or evidence-backed;
// a model's name or provider grants it nothing ("NVIDIA" is not "free",
// "grok" is not "realtime"). `unknown` cost/quota ranks worst, never best.
export const ROUTER_VERSION = 1;
export const PROVIDERS = Object.freeze(Object.keys(AGENT_ENDPOINTS));
export const TASK_CLASSES = Object.freeze({
  classify: Object.freeze({capabilities: ['text'], reasoning: 'basic', coding: 'none'}),
  summarize: Object.freeze({capabilities: ['text'], reasoning: 'basic', coding: 'none'}),
  chat: Object.freeze({capabilities: ['text'], reasoning: 'standard', coding: 'none'}),
  coding: Object.freeze({capabilities: ['text', 'coding'], reasoning: 'standard', coding: 'standard'}),
  reasoning: Object.freeze({capabilities: ['text', 'reasoning'], reasoning: 'high', coding: 'none'}),
  'tool-use': Object.freeze({capabilities: ['text', 'tool-calling'], reasoning: 'standard', coding: 'none', toolCalling: true}),
  vision: Object.freeze({capabilities: ['text', 'vision'], reasoning: 'basic', coding: 'none', vision: true}),
  'realtime-voice': Object.freeze({capabilities: ['audio-live'], reasoning: 'basic', coding: 'none', realtime: true, audioLive: true}),
  'realtime-voice-reasoning': Object.freeze({capabilities: ['audio-live', 'reasoning', 'tool-calling'], reasoning: 'high', coding: 'none', realtime: true, audioLive: true, toolCalling: true})
});
export const CAPABILITIES = Object.freeze(['text', 'coding', 'reasoning', 'tool-calling', 'vision', 'audio-live', 'search', 'long-context']);
export const CLASS_RANK = Object.freeze({none: 0, basic: 1, standard: 2, high: 3, frontier: 4});
export const COST_TIERS = Object.freeze(['free', 'low', 'medium', 'high', 'unknown']);
export const QUOTA_CLASSES = Object.freeze(['verified-free', 'metered', 'prepaid', 'none', 'unknown']);
export const AVAILABILITY = Object.freeze(['available', 'degraded', 'unavailable', 'disabled', 'unknown']);
export const CANDIDATE_FIELDS = Object.freeze(['provider', 'model', 'taskCapabilities', 'reasoningClass', 'codingClass', 'realtime', 'vision', 'audioLive', 'toolCalling', 'contextLimit', 'configured', 'costTier', 'quotaClass', 'dailyBudget', 'availability', 'lastVerifiedAt']);
export const DECLARED_FIELDS = Object.freeze(CANDIDATE_FIELDS.filter(field => field !== 'configured'));
export const PRE_SEND_FAILURES = Object.freeze(['providerMissing', 'configurationMissing', 'quotaUnavailable']);
export const POST_SEND_FAILURES = Object.freeze(['timeout', 'connectionAmbiguous', 'completionUnknown']);
const SECRET_KEY = /key|secret|token|password|credential|authorization/i;
const SECRET_VALUE = /^(?:sk-|xai-|nvapi-|AIza|ya29\.|Bearer\s)/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export class RouterError extends Error {
  constructor(message, code = 'ROUTER_INVALID') {super(message); this.code = code;}
}
const fail = (message, code) => {throw new RouterError(message, code);};
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const sha256 = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const modelId = candidate => `${candidate.provider}/${candidate.model}`;

// Secrets never enter the pool, the decision or the provenance: any key name
// that looks like a credential, or any value shaped like one, is rejected.
export function assertNoSecrets(value, path = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail(`${path}: 자격 증명 형태의 값은 라우터에 들어올 수 없습니다.`, 'ROUTER_SECRET');
    return;
  }
  if (Array.isArray(value)) {value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`)); return;}
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) fail(`${path}.${key}: 자격 증명 이름의 필드는 라우터에 들어올 수 없습니다.`, 'ROUTER_SECRET');
      assertNoSecrets(item, `${path}.${key}`);
    }
  }
}

// One owner-declared model. Every fact is explicit; nothing is defaulted from
// the provider or model name. `configured` is NOT declared here - it comes only
// from provider-config evidence in `brainPool`.
export function validateDeclaredModel(declared) {
  if (!exact(declared, DECLARED_FIELDS)) fail(`모델 선언은 정확히 ${DECLARED_FIELDS.join(', ')} 필드를 가져야 합니다.`);
  assertNoSecrets(declared, 'model');
  const d = declared;
  if (!PROVIDERS.includes(d.provider)) fail(`알 수 없는 provider: ${d.provider}`);
  if (typeof d.model !== 'string' || !/^[A-Za-z0-9._\/:-]{1,120}$/.test(d.model)) fail('model 이름이 올바르지 않습니다.');
  if (!Array.isArray(d.taskCapabilities) || !d.taskCapabilities.length || d.taskCapabilities.some(c => !CAPABILITIES.includes(c)) || new Set(d.taskCapabilities).size !== d.taskCapabilities.length) fail(`${modelId(d)}: taskCapabilities는 ${CAPABILITIES.join('|')} 중 중복 없는 목록이어야 합니다.`);
  for (const field of ['reasoningClass', 'codingClass']) if (!Object.hasOwn(CLASS_RANK, d[field])) fail(`${modelId(d)}: ${field}는 ${Object.keys(CLASS_RANK).join('|')} 중 하나여야 합니다.`);
  for (const field of ['realtime', 'vision', 'audioLive', 'toolCalling']) if (typeof d[field] !== 'boolean') fail(`${modelId(d)}: ${field}는 boolean이어야 합니다.`);
  if (d.audioLive && !d.taskCapabilities.includes('audio-live')) fail(`${modelId(d)}: audioLive면 taskCapabilities에 audio-live가 있어야 합니다.`);
  if (!d.audioLive && d.taskCapabilities.includes('audio-live')) fail(`${modelId(d)}: audio-live capability는 audioLive:true 증거가 필요합니다.`);
  if (d.toolCalling !== d.taskCapabilities.includes('tool-calling')) fail(`${modelId(d)}: toolCalling과 tool-calling capability가 일치해야 합니다.`);
  if (d.vision !== d.taskCapabilities.includes('vision')) fail(`${modelId(d)}: vision과 vision capability가 일치해야 합니다.`);
  if (d.taskCapabilities.includes('coding') && d.codingClass === 'none') fail(`${modelId(d)}: coding capability는 codingClass none일 수 없습니다.`);
  if (d.taskCapabilities.includes('reasoning') && CLASS_RANK[d.reasoningClass] < CLASS_RANK.high) fail(`${modelId(d)}: reasoning capability는 reasoningClass high 이상이어야 합니다.`);
  if (!Number.isInteger(d.contextLimit) || d.contextLimit < 1000 || d.contextLimit > 100_000_000) fail(`${modelId(d)}: contextLimit은 1000 이상의 정수여야 합니다.`);
  if (!COST_TIERS.includes(d.costTier)) fail(`${modelId(d)}: costTier는 ${COST_TIERS.join('|')} 중 하나여야 합니다.`);
  if (!QUOTA_CLASSES.includes(d.quotaClass)) fail(`${modelId(d)}: quotaClass는 ${QUOTA_CLASSES.join('|')} 중 하나여야 합니다.`);
  if (d.costTier === 'free' && d.quotaClass !== 'verified-free') fail(`${modelId(d)}: costTier free는 quotaClass verified-free 증거가 있어야 합니다.`);
  if (d.dailyBudget !== null && (!exact(d.dailyBudget, ['calls', 'used']) || !Number.isInteger(d.dailyBudget.calls) || d.dailyBudget.calls < 0 || !Number.isInteger(d.dailyBudget.used) || d.dailyBudget.used < 0)) fail(`${modelId(d)}: dailyBudget은 null 또는 {calls, used} 정수여야 합니다.`);
  if (!AVAILABILITY.includes(d.availability)) fail(`${modelId(d)}: availability는 ${AVAILABILITY.join('|')} 중 하나여야 합니다.`);
  if (d.lastVerifiedAt !== null && (typeof d.lastVerifiedAt !== 'string' || !ISO.test(d.lastVerifiedAt))) fail(`${modelId(d)}: lastVerifiedAt은 null 또는 ISO 시각이어야 합니다.`);
  if ((d.costTier !== 'unknown' || d.quotaClass !== 'unknown' || d.availability !== 'unknown') && d.lastVerifiedAt === null) fail(`${modelId(d)}: 비용·quota·가용성 증거에는 lastVerifiedAt이 필요합니다.`);
  return true;
}

export function validateBrainPool(pool) {
  if (!exact(pool, ['version', 'models'])) fail('brain pool은 {version, models}여야 합니다.');
  if (pool.version !== ROUTER_VERSION) fail('brain pool 버전이 다릅니다.');
  if (!Array.isArray(pool.models) || pool.models.length > 64) fail('models는 64개 이하의 목록이어야 합니다.');
  const seen = new Set();
  for (const candidate of pool.models) {
    if (!exact(candidate, CANDIDATE_FIELDS) || typeof candidate.configured !== 'boolean') fail('candidate 필드가 올바르지 않습니다.');
    const {configured, ...declared} = candidate;
    validateDeclaredModel(declared);
    const id = modelId(candidate);
    if (seen.has(id)) fail(`중복 모델: ${id}`);
    seen.add(id);
  }
  return true;
}

// Owner-declared pool text (e.g. from a config file the server reads later).
export function parseDeclaredModels(text) {
  if (typeof text !== 'string' || text.length > 65536) fail('모델 선언 텍스트가 필요합니다(64KB 이하).');
  let parsed;
  try {parsed = JSON.parse(text);} catch {fail('모델 선언 JSON을 읽을 수 없습니다.');}
  if (!Array.isArray(parsed) || parsed.length > 64) fail('모델 선언은 64개 이하의 배열이어야 합니다.');
  parsed.forEach(validateDeclaredModel);
  return parsed;
}

// `configured` evidence: provider-config already tells us, without exposing a
// key, whether the provider has a complete model+key+limit. Only a declared
// model whose name equals the configured model of that provider is configured.
// A configured key is evidence of readiness for an owner call, nothing more.
export function configuredProviders(env) {
  const summary = agentConfig({...env, YENO_AGENT_PROVIDER: 'auto', YENO_AGENT_PROVIDER_ORDER: PROVIDERS.join(',')}).providers;
  return Object.fromEntries(summary.map(entry => [entry.provider, {configured: entry.configured, model: entry.model, missing: entry.missing}]));
}
export function brainPool(declared, configuration) {
  declared.forEach(validateDeclaredModel);
  assertNoSecrets(configuration, 'configuration');
  const models = declared.map(model => {
    const evidence = configuration?.[model.provider];
    const configured = Boolean(evidence && evidence.configured === true && evidence.model === model.model);
    return {...model, taskCapabilities: [...model.taskCapabilities], dailyBudget: model.dailyBudget ? {...model.dailyBudget} : null, configured};
  }).sort((a, b) => modelId(a).localeCompare(modelId(b)));
  const pool = {version: ROUTER_VERSION, models};
  validateBrainPool(pool);
  return pool;
}

export function validateRouteRequest(request) {
  if (!exact(request, ['taskClass', 'requiredCapabilities', 'minReasoningClass', 'minCodingClass', 'minContext', 'trigger', 'risk'])) fail('route request 필드가 올바르지 않습니다.');
  if (!Object.hasOwn(TASK_CLASSES, request.taskClass)) fail(`알 수 없는 taskClass: ${request.taskClass}`);
  if (!Array.isArray(request.requiredCapabilities) || request.requiredCapabilities.some(c => !CAPABILITIES.includes(c))) fail('requiredCapabilities가 올바르지 않습니다.');
  for (const field of ['minReasoningClass', 'minCodingClass']) if (request[field] !== null && !Object.hasOwn(CLASS_RANK, request[field])) fail(`${field}가 올바르지 않습니다.`);
  if (request.minContext !== null && (!Number.isInteger(request.minContext) || request.minContext < 0)) fail('minContext가 올바르지 않습니다.');
  if (!['owner', 'background'].includes(request.trigger)) fail('trigger는 owner|background여야 합니다.');
  if (!['local-reversible', 'capability-change', 'external-effect'].includes(request.risk)) fail('risk가 올바르지 않습니다.');
  return true;
}
export const routeRequest = (taskClass, overrides = {}) => {
  const request = {taskClass, requiredCapabilities: [], minReasoningClass: null, minCodingClass: null, minContext: null, trigger: 'owner', risk: 'local-reversible', ...overrides};
  validateRouteRequest(request);
  return request;
};

const requirementOf = request => {
  const base = TASK_CLASSES[request.taskClass];
  const rank = (a, b) => CLASS_RANK[a] >= CLASS_RANK[b] ? a : b;
  return {
    capabilities: [...new Set([...base.capabilities, ...request.requiredCapabilities])].sort(),
    reasoning: rank(base.reasoning, request.minReasoningClass ?? 'none'),
    coding: rank(base.coding, request.minCodingClass ?? 'none'),
    realtime: base.realtime === true, audioLive: base.audioLive === true, toolCalling: base.toolCalling === true, vision: base.vision === true,
    minContext: request.minContext ?? 0
  };
};

// Ranking after every gate passed: cheapest verified tier first (`unknown`
// last - it is never assumed cheap), then the freshest evidence, then a
// stable name order so the same pool + request always selects the same model.
const costRank = tier => COST_TIERS.indexOf(tier);
const compare = (a, b) => costRank(a.costTier) - costRank(b.costTier)
  || String(b.lastVerifiedAt ?? '').localeCompare(String(a.lastVerifiedAt ?? ''))
  || modelId(a).localeCompare(modelId(b));

// Priority (fixed): 1 required capability -> 2 owner pin -> 3 safety/risk ->
// 4 configured + available + quota -> 5 quality -> 6 lowest cost among the rest.
// The result is provenance only: it authorizes nothing and holds no secret.
export function routeModel(pool, request, options = {}) {
  validateBrainPool(pool); validateRouteRequest(request);
  const {ownerOverride = null, policy = {}, at} = options;
  if (typeof at !== 'string' || !ISO.test(at)) fail('at(ISO 시각)이 필요합니다.');
  if (ownerOverride !== null && (!exact(ownerOverride, ['provider', 'model']) || !PROVIDERS.includes(ownerOverride.provider) || (ownerOverride.model !== null && typeof ownerOverride.model !== 'string'))) fail('ownerOverride는 {provider, model|null}여야 합니다.');
  assertNoSecrets(policy, 'policy');
  const backgroundOptIn = policy.backgroundOptIn === true;
  const requirement = requirementOf(request);
  const considered = pool.models.map(candidate => {
    const reasons = [];
    const missing = requirement.capabilities.filter(c => !candidate.taskCapabilities.includes(c));
    if (missing.length) reasons.push(`capability_missing:${missing.join('+')}`);
    if (requirement.realtime && !candidate.realtime) reasons.push('realtime_required');
    if (requirement.audioLive && !candidate.audioLive) reasons.push('audio_live_required');
    if (requirement.toolCalling && !candidate.toolCalling) reasons.push('tool_calling_required');
    if (requirement.vision && !candidate.vision) reasons.push('vision_required');
    const stage1 = reasons.length === 0;
    const pinned = ownerOverride ? candidate.provider === ownerOverride.provider && (ownerOverride.model === null || candidate.model === ownerOverride.model) : true;
    if (!pinned) reasons.push('owner_pinned_elsewhere');
    if (candidate.availability === 'disabled') reasons.push('owner_disabled');
    if (request.trigger === 'background') {
      if (!backgroundOptIn) reasons.push('background_not_opted_in');
      if (request.risk !== 'local-reversible') reasons.push('background_risk_requires_owner');
      if (candidate.dailyBudget === null) reasons.push('background_budget_missing');
    }
    if (!candidate.configured) reasons.push('configuration_missing');
    if (['unavailable', 'unknown'].includes(candidate.availability)) reasons.push(`availability_${candidate.availability}`);
    if (['none', 'unknown'].includes(candidate.quotaClass)) reasons.push(`quota_${candidate.quotaClass}`);
    if (candidate.dailyBudget && candidate.dailyBudget.used >= candidate.dailyBudget.calls) reasons.push('daily_budget_exhausted');
    if (CLASS_RANK[candidate.reasoningClass] < CLASS_RANK[requirement.reasoning]) reasons.push(`reasoning_below_${requirement.reasoning}`);
    if (CLASS_RANK[candidate.codingClass] < CLASS_RANK[requirement.coding]) reasons.push(`coding_below_${requirement.coding}`);
    if (candidate.contextLimit < requirement.minContext) reasons.push('context_too_small');
    return {provider: candidate.provider, model: candidate.model, costTier: candidate.costTier, quotaClass: candidate.quotaClass, availability: candidate.availability, configured: candidate.configured, lastVerifiedAt: candidate.lastVerifiedAt, capabilityFit: stage1, eligible: reasons.length === 0, reasons};
  });
  const eligible = pool.models.filter((candidate, index) => considered[index].eligible).sort(compare);
  const ranked = eligible.map(modelId);
  const selected = eligible[0] ?? null;
  const pinnedProvider = ownerOverride?.provider ?? null;
  const reason = selected
    ? ownerOverride ? 'owner_pinned' : eligible.length === 1 ? 'only_eligible' : `lowest_cost_${selected.costTier}`
    : ownerOverride ? 'owner_pin_ineligible' : request.trigger === 'background' && !backgroundOptIn ? 'background_not_opted_in' : 'no_eligible_model';
  const decision = {
    version: ROUTER_VERSION, taskClass: request.taskClass, requiredCapabilities: requirement.capabilities,
    quality: {reasoning: requirement.reasoning, coding: requirement.coding, minContext: requirement.minContext},
    trigger: request.trigger, risk: request.risk,
    consideredModels: considered, ranked,
    selectedProvider: selected?.provider ?? null, selectedModel: selected?.model ?? null,
    reason, costTier: selected?.costTier ?? null,
    quotaEvidence: selected ? {quotaClass: selected.quotaClass, dailyBudget: selected.dailyBudget ? {...selected.dailyBudget} : null, lastVerifiedAt: selected.lastVerifiedAt} : null,
    ownerOverride: ownerOverride ? {provider: pinnedProvider, model: ownerOverride.model} : null,
    timestamp: at, authorizesCall: false
  };
  decision.fingerprint = sha256({...decision, timestamp: null});
  assertNoSecrets(decision, 'decision');
  return decision;
}

export function validateRoutingDecision(decision) {
  if (!exact(decision, ['version', 'taskClass', 'requiredCapabilities', 'quality', 'trigger', 'risk', 'consideredModels', 'ranked', 'selectedProvider', 'selectedModel', 'reason', 'costTier', 'quotaEvidence', 'ownerOverride', 'timestamp', 'authorizesCall', 'fingerprint'])) fail('routing decision 필드가 올바르지 않습니다.');
  if (decision.version !== ROUTER_VERSION || decision.authorizesCall !== false || !ISO.test(decision.timestamp)) fail('routing decision 값이 올바르지 않습니다.');
  const {fingerprint, ...body} = decision;
  if (fingerprint !== sha256({...body, timestamp: null})) fail('routing decision 지문이 다릅니다.', 'ROUTER_TAMPERED');
  assertNoSecrets(decision, 'decision');
  return true;
}

// Failover is a verdict, not an action. Before anything left this process a
// clear local failure may move to the next ranked candidate (never past an
// owner pin). Once a request has been sent, nothing is re-run anywhere: the
// attempt is `outcomeUnknown` and goes to the owner.
export function failoverDecision(decision, attempt) {
  validateRoutingDecision(decision);
  if (!exact(attempt, ['provider', 'model', 'phase', 'failure', 'attempted'])) fail('attempt는 {provider, model, phase, failure, attempted}여야 합니다.');
  if (!['pre-send', 'post-send'].includes(attempt.phase)) fail('phase는 pre-send|post-send여야 합니다.');
  if (!Array.isArray(attempt.attempted) || attempt.attempted.some(id => typeof id !== 'string')) fail('attempted는 문자열 목록이어야 합니다.');
  const current = `${attempt.provider}/${attempt.model}`;
  const attempted = new Set([...attempt.attempted, current]);
  if (attempt.phase === 'post-send') {
    if (!POST_SEND_FAILURES.includes(attempt.failure) && attempt.failure !== 'providerError') fail(`post-send failure가 올바르지 않습니다: ${attempt.failure}`);
    return {action: 'hold', outcome: 'outcomeUnknown', retry: false, next: null, ownerReviewRequired: true, reason: `post_send_${attempt.failure}`, attempted: [...attempted]};
  }
  if (!PRE_SEND_FAILURES.includes(attempt.failure)) fail(`pre-send failure가 올바르지 않습니다: ${attempt.failure}`);
  if (decision.ownerOverride) return {action: 'hold', outcome: 'notSent', retry: false, next: null, ownerReviewRequired: true, reason: 'owner_pinned_no_failover', attempted: [...attempted]};
  const nextId = decision.ranked.find(id => !attempted.has(id)) ?? null;
  if (!nextId) return {action: 'hold', outcome: 'notSent', retry: false, next: null, ownerReviewRequired: true, reason: 'no_remaining_candidate', attempted: [...attempted]};
  const [provider, ...rest] = nextId.split('/');
  return {action: 'next_candidate', outcome: 'notSent', retry: true, next: {provider, model: rest.join('/')}, ownerReviewRequired: false, reason: `pre_send_${attempt.failure}`, attempted: [...attempted]};
}
