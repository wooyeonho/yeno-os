// Runtime glue between the pure Multi-Model Router (model-router.mjs) and the
// real provider transport (agent-engine.mjs). Routing happens once when an
// agent job is created; the persisted `job.routing` block is provenance only.
// The transport authority check is separate from the routing decision and is
// re-run immediately before anything leaves this process.
import {
  brainPool, configuredProviders, parseDeclaredModels, routeModel, routeRequest,
  validateRoutingDecision, failoverDecision, assertNoSecrets, TASK_CLASSES
} from './model-router.mjs';
import {agentConfigForProvider} from './provider-config-engine.mjs';

export const ROUTING_VERSION = 1;
export const ROUTING_KEYS = Object.freeze(['version', 'routingFingerprint', 'taskClass', 'requiredCapabilities', 'selectedProvider', 'selectedModel', 'reason', 'costTier', 'quotaEvidence', 'ownerOverride', 'trigger', 'risk', 'poolDeclared', 'candidates', 'failover', 'requestedAt', 'transportStartedAt', 'transportOutcome', 'usage', 'ownerReviewRequired']);
export const TRANSPORT_OUTCOMES = Object.freeze(['notSent', 'settled', 'outcomeUnknown', 'blocked']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class RoutingError extends Error {
  constructor(code, detail = null) { super(`Routing: ${code}`); this.code = code; this.detail = detail; }
}

// Owner-declared Brain Pool: JSON text in YENO_BRAIN_POOL. Absent -> empty
// declaration. The pool is never inferred from provider or model names.
export function declaredBrainPool(env) {
  const text = env.YENO_BRAIN_POOL;
  if (text === undefined || text === '') return [];
  return parseDeclaredModels(text);
}

export function currentBrainPool(env, declared = declaredBrainPool(env)) {
  return brainPool(declared, configuredProviders(env));
}

// Route one job. When the owner declared no pool, the router still runs (and
// records that it had nothing to choose from); the legacy explicit provider
// config is then the only path and is recorded as such - never as a router
// selection. When a pool exists the router's selection is binding: a pre-send
// configuration failure walks the ranked list via failoverDecision, and a
// pinned provider never falls through.
export function routeAgentJob({env, declared, taskClass = 'tool-use', trigger = 'owner', risk = 'local-reversible', pinnedProvider = null, legacyConfig = null, at}) {
  if (!Object.hasOwn(TASK_CLASSES, taskClass)) throw new RoutingError('invalid_task_class');
  const pool = currentBrainPool(env, declared);
  const ownerOverride = pinnedProvider ? {provider: pinnedProvider, model: null} : null;
  const decision = routeModel(pool, routeRequest(taskClass, {trigger, risk}), {ownerOverride, at, policy: {backgroundOptIn: false}});
  const failover = [];
  const finish = (config, reason, extra = {}) => ({
    decision, config,
    routing: provenance(decision, {reason, requestedAt: at, poolDeclared: pool.models.length > 0, failover, ...extra})
  });
  if (!pool.models.length) {
    if (!legacyConfig || !legacyConfig.ready) throw new RoutingError('configuration_missing', {reason: 'brain_pool_undeclared_and_no_configured_provider'});
    return finish(legacyConfig, 'brain_pool_undeclared_legacy_config', {selectedProvider: legacyConfig.provider, selectedModel: legacyConfig.model});
  }
  let current = decision.selectedProvider ? {provider: decision.selectedProvider, model: decision.selectedModel} : null;
  const attempted = [];
  while (current) {
    let config = null;
    try { config = agentConfigForProvider(env, current.provider); } catch { config = null; }
    if (config && config.ready && config.model === current.model) return finish(config, decision.reason, {selectedProvider: current.provider, selectedModel: current.model});
    const verdict = failoverDecision(decision, {provider: current.provider, model: current.model, phase: 'pre-send', failure: 'configurationMissing', attempted});
    failover.push({from: `${current.provider}/${current.model}`, phase: 'pre-send', failure: 'configurationMissing', action: verdict.action, reason: verdict.reason});
    attempted.push(`${current.provider}/${current.model}`);
    current = verdict.next;
    if (!current) throw new RoutingError('no_eligible_model', {reason: verdict.reason, decision: publicDecision(decision)});
  }
  throw new RoutingError('no_eligible_model', {reason: decision.reason, decision: publicDecision(decision)});
}

function publicDecision(decision) {
  return {reason: decision.reason, considered: decision.consideredModels.map(c => ({provider: c.provider, model: c.model, eligible: c.eligible, reasons: c.reasons}))};
}

function provenance(decision, {reason, requestedAt, poolDeclared, failover, selectedProvider, selectedModel}) {
  validateRoutingDecision(decision);
  const routing = {
    version: ROUTING_VERSION, routingFingerprint: decision.fingerprint, taskClass: decision.taskClass,
    requiredCapabilities: [...decision.requiredCapabilities], selectedProvider, selectedModel, reason,
    costTier: decision.costTier, quotaEvidence: decision.quotaEvidence, ownerOverride: decision.ownerOverride,
    trigger: decision.trigger, risk: decision.risk, poolDeclared,
    candidates: decision.consideredModels.map(c => ({provider: c.provider, model: c.model, eligible: c.eligible, reasons: [...c.reasons]})),
    failover: failover.map(f => ({...f})),
    requestedAt, transportStartedAt: null, transportOutcome: 'notSent', usage: null, ownerReviewRequired: false
  };
  validateRouting(routing);
  return routing;
}

export function validateRouting(routing) {
  if (!routing || typeof routing !== 'object' || Object.keys(routing).sort().join() !== [...ROUTING_KEYS].sort().join()) throw new RoutingError('invalid_routing_record');
  if (routing.version !== ROUTING_VERSION || !/^[a-f0-9]{64}$/.test(routing.routingFingerprint) || !Object.hasOwn(TASK_CLASSES, routing.taskClass)) throw new RoutingError('invalid_routing_record');
  if (typeof routing.selectedProvider !== 'string' || typeof routing.selectedModel !== 'string' || typeof routing.reason !== 'string') throw new RoutingError('invalid_routing_record');
  if (!ISO.test(routing.requestedAt) || (routing.transportStartedAt !== null && !ISO.test(routing.transportStartedAt))) throw new RoutingError('invalid_routing_record');
  if (!TRANSPORT_OUTCOMES.includes(routing.transportOutcome) || typeof routing.ownerReviewRequired !== 'boolean' || typeof routing.poolDeclared !== 'boolean') throw new RoutingError('invalid_routing_record');
  if (routing.usage !== null && (typeof routing.usage !== 'object' || !Number.isInteger(routing.usage.calls))) throw new RoutingError('invalid_routing_record');
  assertNoSecrets(routing, 'routing');
  return true;
}

// Independent of the router: the last word before a request leaves. The
// router's selection is not authority; each gate is re-read from live state.
export function transportAuthority({routing, job, config, state, usage, at, willSend = true}) {
  const blockers = [];
  if (state.emergencyStop) blockers.push('emergency_stop');
  if (!config || !config.ready) blockers.push('configuration_missing');
  else if (config.provider !== routing.selectedProvider || config.model !== routing.selectedModel) blockers.push('provider_changed_since_routing');
  if (!willSend) return {allowed: blockers.length === 0, blockers, checkedAt: at};
  if (routing.trigger === 'background') blockers.push('background_model_calls_disabled');
  if (usage.attempts >= (config?.dailyCallLimit ?? 0)) blockers.push('global_daily_budget_exhausted');
  if (routing.quotaEvidence?.dailyBudget && routing.quotaEvidence.dailyBudget.used >= routing.quotaEvidence.dailyBudget.calls) blockers.push('provider_daily_budget_exhausted');
  if (routing.risk !== 'local-reversible' && !job.questId) blockers.push('risk_requires_owner_quest');
  if (job.agentJournal?.calls.some(call => call.status !== 'settled')) blockers.push('previous_call_outcome_unknown');
  return {allowed: blockers.length === 0, blockers, checkedAt: at};
}

// Transport outcome is read from the durable call receipts, never guessed:
// every receipt settled -> settled; any `unknown` receipt -> outcomeUnknown
// (owner review, no re-run anywhere); no receipt -> notSent.
export function settleRouting(routing, journal, at) {
  const calls = journal?.calls ?? [];
  const unknown = calls.filter(call => call.status === 'unknown').length;
  const settled = calls.filter(call => call.status === 'settled');
  routing.transportStartedAt ??= at;
  routing.transportOutcome = calls.length === 0 ? 'notSent' : unknown ? 'outcomeUnknown' : 'settled';
  routing.ownerReviewRequired = unknown > 0;
  routing.usage = calls.length === 0 ? null : {
    calls: calls.length, settled: settled.length, unknown,
    promptUnits: settled.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
    completionUnits: settled.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0)
  };
  validateRouting(routing);
  return routing;
}
