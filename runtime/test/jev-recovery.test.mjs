import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JevRecoveryError, JEV_RECOVERY_VERSION, planRecovery, validateRecoveryDecision, validateJevRecoveryLog,
} from '../lib/jev-recovery.mjs';

const missionId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const AT = '2026-09-24T12:00:00.000Z';
const ref = (id, seed) => ({type: 'artifact', id, sha256: seed.repeat(64)});

function snapshot(overrides = {}) {
  return {
    version: 1, missionId, projectId, capturedAt: AT, validUntil: '2026-09-24T12:10:00.000Z',
    scope: {projectIds: [projectId], actionTypes: ['reconcile', 'owner_review', 'provider_call']},
    budget: {currency: 'USD', limitMinor: 1000, reservedMinor: 100, spentMinor: 100},
    resources: [{id: 'local-index', capabilityIds: ['memory.read'], status: 'available', projectIds: [projectId], checkedAt: AT,
      validUntil: '2026-09-24T12:05:00.000Z', evidenceRefs: [ref('index-health', 'a')]}],
    evidenceRefs: [ref('mission-goal', 'b')], ...overrides,
  };
}

function alternative(id, overrides = {}) {
  return {
    id, missionId, projectId, actionType: 'reconcile', requiredResourceIds: ['local-index'], requiredCapabilityIds: ['memory.read'],
    evidenceRefs: [ref(`input-${id}`, 'c')], cost: {currency: 'USD', amountMinor: 0}, riskClass: 'low', sideEffects: ['read_private'],
    reversible: true, approvalId: null, ...overrides,
  };
}

function review(altId, overrides = {}) {
  return {
    missionId, alternativeId: altId, verifierId: 'independent-preflight-v1', checkedAt: AT,
    validUntil: '2026-09-24T12:03:00.000Z', objectiveFit: 'PASS', preconditions: 'PASS', evidenceRefs: [ref(`review-${altId}`, 'd')], ...overrides,
  };
}

const policy = {emergencyStop: false, approvedApprovalIds: [], allowedRiskClasses: ['low', 'moderate'], maxCostMinor: 500};
const plan = (options = {}) => planRecovery({
  missionId, projectId, blocker: {code: 'provider_unavailable', evidenceRefs: [ref('blocked-provider', 'e')]},
  resourceSnapshot: snapshot(), alternatives: [alternative('reuse-local-memory')],
  verifierReviews: [review('reuse-local-memory')], policy, at: AT, ...options,
});

test('JEV recovery joins real resource evidence, a typed alternative, and an independent Verifier before recommending review', () => {
  const result = plan();
  assert.equal(result.version, JEV_RECOVERY_VERSION);
  assert.equal(result.decisionStatus, 'ready_for_review');
  assert.deepEqual(result.recommendedAlternativeIds, ['reuse-local-memory']);
  assert.equal(result.nextStep, 'owner_or_policy_gate_review');
  assert.equal(result.authorizesDispatch, false);
  assert.equal(result.assessments[0].status, 'PASS');
  assert.ok(result.assessments[0].evidenceRefs.some(item => item.id === 'review-reuse-local-memory'));
  assert.doesNotThrow(() => validateRecoveryDecision(result));
  assert.doesNotThrow(() => validateJevRecoveryLog([result]));
});

test('unknown, stale, mismatched, unapproved, or over-budget inputs cannot enter the recommendation list', () => {
  const stale = plan({resourceSnapshot: snapshot({capturedAt: '2026-09-24T11:50:00.000Z', validUntil: '2026-09-24T11:59:00.000Z'})});
  assert.equal(stale.decisionStatus, 'uncertain');
  assert.deepEqual(stale.recommendedAlternativeIds, []);
  assert.equal(stale.nextStep, 'refresh_resources_and_verifier_evidence');

  const unknownCost = plan({alternatives: [alternative('unknown-cost', {cost: {currency: 'USD', amountMinor: null}})], verifierReviews: [review('unknown-cost')]});
  assert.equal(unknownCost.assessments[0].status, 'INCONCLUSIVE');
  assert.deepEqual(unknownCost.recommendedAlternativeIds, []);

  const overBudget = plan({alternatives: [alternative('expensive', {cost: {currency: 'USD', amountMinor: 900}})], verifierReviews: [review('expensive')]});
  assert.ok(overBudget.assessments[0].reasons.includes('budget_exceeded'));
  assert.deepEqual(overBudget.recommendedAlternativeIds, []);

  const needsApproval = plan({alternatives: [alternative('needs-approval', {approvalId: 'approval-1'})], verifierReviews: [review('needs-approval')]});
  assert.ok(needsApproval.assessments[0].reasons.includes('approval_missing'));
  assert.deepEqual(needsApproval.recommendedAlternativeIds, []);

  const emergency = plan({policy: {...policy, emergencyStop: true}});
  assert.equal(emergency.nextStep, 'hold_until_emergency_stop_cleared');
  assert.deepEqual(emergency.recommendedAlternativeIds, []);
});

test('independent Verifier fail or uncertainty blocks an otherwise available alternative', () => {
  const failed = plan({verifierReviews: [review('reuse-local-memory', {objectiveFit: 'FAIL'})]});
  assert.ok(failed.assessments[0].reasons.includes('objective_fit_failed'));
  assert.deepEqual(failed.recommendedAlternativeIds, []);

  const uncertain = plan({verifierReviews: [review('reuse-local-memory', {preconditions: 'INCONCLUSIVE'})]});
  assert.equal(uncertain.decisionStatus, 'uncertain');
  assert.deepEqual(uncertain.recommendedAlternativeIds, []);
});

test('JEV recovery refuses secrets, cross-mission references, and tampered audit fingerprints', () => {
  assert.throws(() => plan({alternatives: [alternative('secret', {evidenceRefs: [{type: 'token', id: 'sk-private', sha256: 'f'.repeat(64)}]})], verifierReviews: [review('secret')]}), JevRecoveryError);
  assert.throws(() => plan({resourceSnapshot: snapshot({missionId: '33333333-3333-4333-8333-333333333333'})}), JevRecoveryError);
  const result = plan();
  assert.throws(() => validateRecoveryDecision({...result, nextStep: 'dispatch'}), JevRecoveryError);
  assert.throws(() => validateJevRecoveryLog([result, result]), JevRecoveryError);
});
