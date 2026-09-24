import crypto from 'node:crypto';

// JEV recovery planning is an advisory, fail-closed contract. It reads a
// caller-supplied resource snapshot and independent verifier review, emits a
// bounded recommendation, and can never dispatch work.
export const JEV_RECOVERY_VERSION = 'jev-recovery-v1';
export const JEV_RECOVERY_LOG_CAP = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ACTIONS = Object.freeze(['wait', 'reconcile', 'owner_review', 'local_read', 'local_write', 'provider_call', 'qpu_submit']);
const RESOURCE_STATUSES = Object.freeze(['available', 'unavailable', 'unknown']);
const RISK_CLASSES = Object.freeze(['low', 'moderate', 'high', 'prohibited']);
const SIDE_EFFECTS = Object.freeze(['read_private', 'local_write', 'external_network', 'provider_call', 'spend', 'irreversible']);
const VERDICTS = Object.freeze(['PASS', 'FAIL', 'INCONCLUSIVE']);
const SECRET_KEY = /key|secret|token|password|credential|authorization/i;
const SECRET_VALUE = /^(?:sk-|xai-|nvapi-|AIza|ya29\.|Bearer\s)/;

export class JevRecoveryError extends Error {
  constructor(message, code = 'JEV_RECOVERY_INVALID') { super(message); this.name = 'JevRecoveryError'; this.code = code; }
}

const fail = (message, code) => { throw new JevRecoveryError(message, code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const iso = value => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const uuid = value => typeof value === 'string' && UUID.test(value);
const hash = value => typeof value === 'string' && HASH.test(value);
const text = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
const int = value => Number.isSafeInteger(value) && value >= 0;
const unique = values => new Set(values).size === values.length;
const sorted = values => [...values].sort((a, b) => a.localeCompare(b));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : JSON.stringify(value);
const fingerprint = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

export function assertNoRecoverySecrets(value, path = '$') {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) fail(`${path}: credential-shaped values are not allowed.`, 'JEV_RECOVERY_SECRET');
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoRecoverySecrets(item, `${path}[${index}]`)); return; }
  if (object(value)) for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) fail(`${path}.${key}: credential-shaped fields are not allowed.`, 'JEV_RECOVERY_SECRET');
    assertNoRecoverySecrets(item, `${path}.${key}`);
  }
}

export function validateRecoveryEvidenceRefs(refs, label = 'evidenceRefs') {
  if (!Array.isArray(refs) || refs.length > 40 || refs.some(ref => !exact(ref, ['type', 'id', 'sha256'])
      || !text(ref.type, 40) || !text(ref.id, 200) || !hash(ref.sha256))) fail(`${label} must contain bounded, hashed evidence references.`);
  const keys = refs.map(ref => `${ref.type}:${ref.id}:${ref.sha256}`);
  if (!unique(keys)) fail(`${label} contains duplicate evidence references.`);
}

export function validateResourceSnapshot(snapshot) {
  const fields = ['version', 'missionId', 'projectId', 'capturedAt', 'validUntil', 'scope', 'budget', 'resources', 'evidenceRefs'];
  if (!exact(snapshot, fields) || snapshot.version !== 1 || !uuid(snapshot.missionId) || !uuid(snapshot.projectId)
      || !iso(snapshot.capturedAt) || !iso(snapshot.validUntil) || snapshot.validUntil < snapshot.capturedAt) fail('Invalid ResourceSnapshot shape or time range.');
  if (!exact(snapshot.scope, ['projectIds', 'actionTypes']) || !Array.isArray(snapshot.scope.projectIds) || !snapshot.scope.projectIds.every(uuid)
      || !unique(snapshot.scope.projectIds) || !Array.isArray(snapshot.scope.actionTypes) || !snapshot.scope.actionTypes.every(action => ACTIONS.includes(action))
      || !unique(snapshot.scope.actionTypes)) fail('Invalid ResourceSnapshot scope.');
  if (!exact(snapshot.budget, ['currency', 'limitMinor', 'reservedMinor', 'spentMinor'])
      || !/^[A-Z]{3}$/.test(snapshot.budget.currency) || !int(snapshot.budget.limitMinor)
      || !int(snapshot.budget.reservedMinor) || !int(snapshot.budget.spentMinor)) fail('Invalid ResourceSnapshot budget.');
  if (!Array.isArray(snapshot.resources) || snapshot.resources.length > 64) fail('ResourceSnapshot resources exceed their bound.');
  const ids = [];
  for (const resource of snapshot.resources) {
    if (!exact(resource, ['id', 'capabilityIds', 'status', 'projectIds', 'checkedAt', 'validUntil', 'evidenceRefs'])
        || !text(resource.id, 120) || !Array.isArray(resource.capabilityIds) || !resource.capabilityIds.every(id => text(id, 120))
        || !unique(resource.capabilityIds) || !RESOURCE_STATUSES.includes(resource.status)
        || !Array.isArray(resource.projectIds) || !resource.projectIds.every(uuid) || !unique(resource.projectIds)
        || !iso(resource.checkedAt) || !iso(resource.validUntil) || resource.validUntil < resource.checkedAt) fail('Invalid resource entry in ResourceSnapshot.');
    ids.push(resource.id);
    validateRecoveryEvidenceRefs(resource.evidenceRefs, 'resource evidenceRefs');
  }
  if (!unique(ids)) fail('ResourceSnapshot contains duplicate resource ids.');
  validateRecoveryEvidenceRefs(snapshot.evidenceRefs, 'snapshot evidenceRefs');
  assertNoRecoverySecrets(snapshot, 'resourceSnapshot');
  return snapshot;
}

export function validateRecoveryAlternative(alternative, missionId, projectId) {
  const fields = ['id', 'missionId', 'projectId', 'actionType', 'requiredResourceIds', 'requiredCapabilityIds', 'evidenceRefs', 'cost', 'riskClass', 'sideEffects', 'reversible', 'approvalId'];
  if (!exact(alternative, fields) || !text(alternative.id, 120) || alternative.missionId !== missionId || alternative.projectId !== projectId
      || !ACTIONS.includes(alternative.actionType) || !Array.isArray(alternative.requiredResourceIds) || !alternative.requiredResourceIds.every(id => text(id, 120))
      || !unique(alternative.requiredResourceIds) || !Array.isArray(alternative.requiredCapabilityIds) || !alternative.requiredCapabilityIds.every(id => text(id, 120))
      || !unique(alternative.requiredCapabilityIds)) fail('Invalid Alternative shape or mission/project link.');
  if (!exact(alternative.cost, ['currency', 'amountMinor']) || !/^[A-Z]{3}$/.test(alternative.cost.currency)
      || !(alternative.cost.amountMinor === null || int(alternative.cost.amountMinor))) fail('Invalid Alternative cost.');
  if (!RISK_CLASSES.includes(alternative.riskClass) || !Array.isArray(alternative.sideEffects)
      || !alternative.sideEffects.every(effect => SIDE_EFFECTS.includes(effect)) || !unique(alternative.sideEffects)
      || typeof alternative.reversible !== 'boolean' || !(alternative.approvalId === null || text(alternative.approvalId, 120))) fail('Invalid Alternative risk, effects, reversibility, or approval.');
  validateRecoveryEvidenceRefs(alternative.evidenceRefs, 'alternative evidenceRefs');
  assertNoRecoverySecrets(alternative, 'alternative');
  return alternative;
}

export function validateRecoveryVerifierReview(review, missionId, alternativeId) {
  const fields = ['missionId', 'alternativeId', 'verifierId', 'checkedAt', 'validUntil', 'objectiveFit', 'preconditions', 'evidenceRefs'];
  if (!exact(review, fields) || review.missionId !== missionId || review.alternativeId !== alternativeId
      || !text(review.verifierId, 120) || review.verifierId === 'jev' || !iso(review.checkedAt) || !iso(review.validUntil)
      || review.validUntil < review.checkedAt || !VERDICTS.includes(review.objectiveFit) || !VERDICTS.includes(review.preconditions)) fail('Invalid independent Verifier review.');
  validateRecoveryEvidenceRefs(review.evidenceRefs, 'verifier evidenceRefs');
  if (!review.evidenceRefs.length) fail('Verifier review must cite evidence.');
  assertNoRecoverySecrets(review, 'verifierReview');
  return review;
}

const verdictRank = verdict => verdict === 'PASS' ? 0 : verdict === 'INCONCLUSIVE' ? 1 : 2;

function verifyAlternative({alternative, review, snapshot, policy, at}) {
  const reasons = [];
  let status = 'PASS';
  const reject = reason => { status = 'FAIL'; reasons.push(reason); };
  const uncertain = reason => { if (status !== 'FAIL') status = 'INCONCLUSIVE'; reasons.push(reason); };
  if (policy.emergencyStop) reject('emergency_stop');
  if (at < snapshot.capturedAt || at > snapshot.validUntil) uncertain('resource_snapshot_stale');
  if (!snapshot.scope.projectIds.includes(alternative.projectId)) reject('project_out_of_scope');
  if (!snapshot.scope.actionTypes.includes(alternative.actionType)) reject('action_out_of_scope');
  if (policy.allowedRiskClasses && !policy.allowedRiskClasses.includes(alternative.riskClass)) reject('risk_not_allowed');
  if (alternative.riskClass === 'prohibited' || alternative.sideEffects.includes('irreversible')) reject('prohibited_or_irreversible_effect');
  if (alternative.approvalId !== null && !policy.approvedApprovalIds.includes(alternative.approvalId)) reject('approval_missing');
  if (alternative.cost.amountMinor === null) uncertain('cost_unknown');
  else if (alternative.cost.currency !== snapshot.budget.currency) reject('budget_currency_mismatch');
  else {
    const remaining = snapshot.budget.limitMinor - snapshot.budget.reservedMinor - snapshot.budget.spentMinor;
    if (alternative.cost.amountMinor > remaining || alternative.cost.amountMinor > policy.maxCostMinor) reject('budget_exceeded');
  }
  const resourcesById = new Map(snapshot.resources.map(resource => [resource.id, resource]));
  for (const id of alternative.requiredResourceIds) {
    const resource = resourcesById.get(id);
    if (!resource || resource.status === 'unavailable') reject(`resource_unavailable:${id}`);
    else if (resource.status === 'unknown') uncertain(`resource_unknown:${id}`);
    else if (at < resource.checkedAt || at > resource.validUntil) uncertain(`resource_stale:${id}`);
    else if (resource.projectIds.length && !resource.projectIds.includes(alternative.projectId)) reject(`resource_scope_mismatch:${id}`);
  }
  for (const capabilityId of alternative.requiredCapabilityIds) {
    const candidates = snapshot.resources.filter(resource => resource.capabilityIds.includes(capabilityId));
    if (!candidates.length || candidates.every(resource => resource.status === 'unavailable')) reject(`capability_unavailable:${capabilityId}`);
    else if (!candidates.some(resource => resource.status === 'available' && resource.validUntil >= at && resource.checkedAt <= at
        && (!resource.projectIds.length || resource.projectIds.includes(alternative.projectId)))) uncertain(`capability_not_confirmed:${capabilityId}`);
  }
  if (!review || at < review.checkedAt || at > review.validUntil) uncertain('verifier_review_missing_or_stale');
  else {
    if (review.objectiveFit === 'FAIL') reject('objective_fit_failed');
    else if (review.objectiveFit !== 'PASS') uncertain('objective_fit_unconfirmed');
    if (review.preconditions === 'FAIL') reject('preconditions_failed');
    else if (review.preconditions !== 'PASS') uncertain('preconditions_unconfirmed');
  }
  const evidenceRefs = [...new Map([...alternative.evidenceRefs, ...(review?.evidenceRefs ?? [])]
    .map(ref => [`${ref.type}:${ref.id}:${ref.sha256}`, ref])).values()];
  return {alternativeId: alternative.id, status, reasons: sorted(reasons), verifierId: review?.verifierId ?? null, evidenceRefs};
}

export function validateRecoveryPolicy(policy) {
  if (!exact(policy, ['emergencyStop', 'approvedApprovalIds', 'allowedRiskClasses', 'maxCostMinor'])
      || typeof policy.emergencyStop !== 'boolean' || !Array.isArray(policy.approvedApprovalIds)
      || !policy.approvedApprovalIds.every(id => text(id, 120)) || !unique(policy.approvedApprovalIds)
      || !Array.isArray(policy.allowedRiskClasses) || !policy.allowedRiskClasses.every(risk => RISK_CLASSES.includes(risk))
      || !unique(policy.allowedRiskClasses) || !int(policy.maxCostMinor)) fail('Invalid recovery policy context.');
  assertNoRecoverySecrets(policy, 'policy');
}

export function planRecovery({missionId, projectId, blocker, resourceSnapshot, alternatives, verifierReviews, policy, at}) {
  if (!uuid(missionId) || !uuid(projectId) || !text(blocker?.code, 100) || !iso(at)) fail('Invalid recovery decision context.');
  validateRecoveryEvidenceRefs(blocker.evidenceRefs, 'blocker evidenceRefs');
  validateResourceSnapshot(resourceSnapshot);
  if (resourceSnapshot.missionId !== missionId || resourceSnapshot.projectId !== projectId) fail('ResourceSnapshot does not belong to the blocked mission/project.');
  validateRecoveryPolicy(policy);
  if (!Array.isArray(alternatives) || alternatives.length > 24) fail('Alternatives must be a bounded array.');
  const checked = alternatives.map(alternative => validateRecoveryAlternative(alternative, missionId, projectId));
  if (!unique(checked.map(alternative => alternative.id))) fail('Alternative ids must be unique.');
  if (!Array.isArray(verifierReviews) || verifierReviews.length > 24) fail('Verifier reviews must be a bounded array.');
  const reviews = verifierReviews.map(review => validateRecoveryVerifierReview(review, missionId, review.alternativeId));
  if (!unique(reviews.map(review => review.alternativeId))) fail('There may be only one independent Verifier review per alternative.');
  const reviewById = new Map(reviews.map(review => [review.alternativeId, review]));
  for (const review of reviews) if (!checked.some(alternative => alternative.id === review.alternativeId)) fail('Verifier review references an unknown alternative.');

  const assessments = checked.map(alternative => verifyAlternative({alternative, review: reviewById.get(alternative.id), snapshot: resourceSnapshot, policy, at}));
  const riskOrder = {low: 0, moderate: 1, high: 2, prohibited: 3};
  const alternativeById = new Map(checked.map(alternative => [alternative.id, alternative]));
  const eligible = assessments.filter(item => item.status === 'PASS').map(item => alternativeById.get(item.alternativeId))
    .sort((a, b) => riskOrder[a.riskClass] - riskOrder[b.riskClass]
      || a.cost.amountMinor - b.cost.amountMinor || a.id.localeCompare(b.id));
  const assessmentById = new Map(assessments.map(item => [item.alternativeId, item]));
  const eligibleIds = eligible.map(alternative => alternative.id);
  const noCandidateReason = assessments.some(item => item.status === 'INCONCLUSIVE') ? 'evidence_or_resource_uncertain'
    : assessments.some(item => item.reasons.includes('emergency_stop')) ? 'emergency_stop'
      : assessments.some(item => item.reasons.some(reason => reason.startsWith('resource_') || reason.startsWith('capability_'))) ? 'required_resource_unavailable'
        : assessments.some(item => item.reasons.some(reason => reason.includes('budget'))) ? 'budget_blocked'
          : assessments.length ? 'no_verified_objective_fit' : 'no_alternatives_provided';
  const nextStep = eligibleIds.length ? 'owner_or_policy_gate_review'
    : noCandidateReason === 'emergency_stop' ? 'hold_until_emergency_stop_cleared'
      : noCandidateReason === 'evidence_or_resource_uncertain' || noCandidateReason === 'required_resource_unavailable' ? 'refresh_resources_and_verifier_evidence'
        : noCandidateReason === 'budget_blocked' ? 'request_owner_budget_decision'
          : 'ask_owner_to_replan';
  const core = {
    version: JEV_RECOVERY_VERSION, missionId, projectId, blocker: {code: blocker.code, evidenceRefs: blocker.evidenceRefs},
    resourceSnapshot: structuredClone(resourceSnapshot), resourceSnapshotHash: fingerprint(resourceSnapshot), assessedAt: at,
    assessments: assessments.map(item => ({...item, evidenceRefs: item.evidenceRefs.map(ref => ({...ref}))})),
    recommendedAlternativeIds: eligibleIds.slice(0, 4), nextStep,
    decisionStatus: eligibleIds.length ? 'ready_for_review' : assessments.some(item => item.status === 'INCONCLUSIVE') ? 'uncertain' : 'blocked',
    authorizesDispatch: false,
  };
  const result = {...core, fingerprint: fingerprint(core)};
  validateRecoveryDecision(result);
  return result;
}

export function validateRecoveryDecision(decision) {
  const fields = ['version', 'missionId', 'projectId', 'blocker', 'resourceSnapshot', 'resourceSnapshotHash', 'assessedAt', 'assessments', 'recommendedAlternativeIds', 'nextStep', 'decisionStatus', 'authorizesDispatch', 'fingerprint'];
  if (!exact(decision, fields) || decision.version !== JEV_RECOVERY_VERSION || !uuid(decision.missionId) || !uuid(decision.projectId)
      || !exact(decision.blocker, ['code', 'evidenceRefs']) || !text(decision.blocker.code, 100) || !hash(decision.resourceSnapshotHash)
      || !iso(decision.assessedAt) || !Array.isArray(decision.assessments) || decision.assessments.length > 24
      || !Array.isArray(decision.recommendedAlternativeIds) || decision.recommendedAlternativeIds.length > 4
      || !decision.recommendedAlternativeIds.every(id => text(id, 120)) || !unique(decision.recommendedAlternativeIds)
      || !['owner_or_policy_gate_review', 'hold_until_emergency_stop_cleared', 'refresh_resources_and_verifier_evidence', 'request_owner_budget_decision', 'ask_owner_to_replan'].includes(decision.nextStep)
      || !['ready_for_review', 'uncertain', 'blocked'].includes(decision.decisionStatus) || decision.authorizesDispatch !== false || !hash(decision.fingerprint)) fail('Invalid JEV recovery decision.');
  validateResourceSnapshot(decision.resourceSnapshot);
  if (decision.resourceSnapshot.missionId !== decision.missionId || decision.resourceSnapshot.projectId !== decision.projectId
      || fingerprint(decision.resourceSnapshot) !== decision.resourceSnapshotHash) fail('Recovery decision resource snapshot hash or mission link mismatch.');
  validateRecoveryEvidenceRefs(decision.blocker.evidenceRefs, 'decision blocker evidenceRefs');
  const ids = [];
  for (const assessment of decision.assessments) {
    if (!exact(assessment, ['alternativeId', 'status', 'reasons', 'verifierId', 'evidenceRefs']) || !text(assessment.alternativeId, 120)
        || !VERDICTS.includes(assessment.status === 'PASS' ? 'PASS' : assessment.status === 'FAIL' ? 'FAIL' : assessment.status === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : '')
        || !Array.isArray(assessment.reasons) || !assessment.reasons.every(reason => text(reason, 200))
        || !(assessment.verifierId === null || text(assessment.verifierId, 120)) || !Array.isArray(assessment.evidenceRefs)) fail('Invalid alternative assessment.');
    ids.push(assessment.alternativeId);
    validateRecoveryEvidenceRefs(assessment.evidenceRefs, 'assessment evidenceRefs');
  }
  if (!unique(ids) || decision.recommendedAlternativeIds.some(id => !ids.includes(id) || decision.assessments.find(item => item.alternativeId === id)?.status !== 'PASS')) fail('Recovery recommendation references an ineligible alternative.');
  const {fingerprint: supplied, ...core} = decision;
  if (fingerprint(core) !== supplied) fail('JEV recovery decision fingerprint mismatch.');
  assertNoRecoverySecrets(decision, 'recoveryDecision');
  return decision;
}

export function validateJevRecoveryLog(log) {
  if (!Array.isArray(log) || log.length > JEV_RECOVERY_LOG_CAP) fail('jevRecoveryLog exceeds its bounded schema.');
  for (const entry of log) validateRecoveryDecision(entry);
  const ids = log.map(entry => `${entry.missionId}:${entry.fingerprint}`);
  if (!unique(ids)) fail('jevRecoveryLog contains a duplicate decision.');
  return log;
}
