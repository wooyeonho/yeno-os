import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planRecovery} from '../runtime/lib/jev-recovery.mjs';
import {buildJevRecoveryVerificationResult} from '../runtime/lib/jev-recovery-verifier.mjs';
import {optimizeRecoveryOneOf} from '../runtime/lib/quantum-statevector.mjs';
import {validateRecoveryOneOfSelection} from '../runtime/lib/recovery-one-of-qpu.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'build-artifacts', 'living-20260927');
const missionId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const at = '2026-09-24T12:00:00.000Z';
const ref = (id, digit) => ({type: 'artifact', id, sha256: digit.repeat(64)});

const resourceSnapshot = {version: 1, missionId, projectId, capturedAt: at, validUntil: '2026-09-24T12:10:00.000Z',
  scope: {projectIds: [projectId], actionTypes: ['reconcile']},
  budget: {currency: 'USD', limitMinor: 1000, reservedMinor: 100, spentMinor: 100},
  resources: [{id: 'local-index', capabilityIds: ['memory.read'], status: 'available', projectIds: [projectId],
    checkedAt: at, validUntil: '2026-09-24T12:05:00.000Z', evidenceRefs: [ref('index-health', 'a')]}],
  evidenceRefs: [ref('mission-goal', 'b')]};
const alternatives = [100, 200, 300].map((amountMinor, index) => ({
  id: `alternative-${index + 1}`, missionId, projectId, actionType: 'reconcile', requiredResourceIds: ['local-index'],
  requiredCapabilityIds: ['memory.read'], evidenceRefs: [ref(`input-${index + 1}`, 'c')],
  cost: {currency: 'USD', amountMinor}, riskClass: 'low', sideEffects: ['read_private'], reversible: true, approvalId: null,
}));
const blocker = {code: 'provider_unavailable', evidenceRefs: [ref('blocked-provider', 'e')]};
const policy = {emergencyStop: false, approvedApprovalIds: [], allowedRiskClasses: ['low'], maxCostMinor: 500};
const initial = planRecovery({missionId, projectId, blocker, resourceSnapshot, alternatives, verifierReviews: [], policy, at});
const request = {version: 1, missionId, projectId, blockedJobId: '33333333-3333-4333-8333-333333333333',
  initialDecisionFingerprint: initial.fingerprint, projectVersion: 1, projectStatus: 'active',
  goal: 'Recover the interrupted local task.', successCriterion: 'Complete the next safe step with a checked artifact.',
  blocker, resourceSnapshot, alternatives, policy, createdAt: at};
const draft = {alternatives: alternatives.map(alternative => ({alternativeId: alternative.id, objectiveFit: 'PASS',
  preconditions: 'PASS', evidenceRefs: [alternative.evidenceRefs[0]],
  reason: 'The cited input supports this reversible next step.'}))};
const result = buildJevRecoveryVerificationResult({draft, request,
  verifierJobId: '44444444-4444-4444-8444-444444444444', provider: 'local', model: 'fixture-only', checkedAt: at,
  outputArtifactRef: ref('55555555-5555-4555-8555-555555555555', 'f')});
const decision = planRecovery({missionId, projectId, blocker, resourceSnapshot, alternatives,
  verifierReviews: result.reviews, policy, at});
const optimization = optimizeRecoveryOneOf({request, result, decision}, {gridSize: 8, shots: 1024, seed: 91});
const selectedContext = {request, result, decision, parameters: {gamma: optimization.best.gamma,
  beta: optimization.best.beta, shots: 1024}};
const {buildRecoveryOneOfCircuit} = await import('../runtime/lib/recovery-one-of-qpu.mjs');
const circuit = buildRecoveryOneOfCircuit(selectedContext);
validateRecoveryOneOfSelection(optimization.selection, circuit);
if (optimization.best.feasibleProbability < 0.6) throw new Error('Q1 feasibility target missed');
fs.mkdirSync(output, {recursive: true});
const report = {evidenceClass: 'SYNTHETIC_CONTEXT_OPEN_SOURCE_LOCAL_SIMULATION',
  backend: 'quantum-circuit@0.9.251', circuitSha256: optimization.best.circuitSha256,
  countsOrigin: 'local_statevector_simulator',
  gridPoints: optimization.sweep.length, shots: 1024, best: optimization.best,
  counts: optimization.counts, selection: optimization.selection, authorizesDispatch: false};
fs.writeFileSync(path.join(output, 'q1-quantum.json'), JSON.stringify(report, null, 2) + '\n');
const rows = ['gamma,beta,feasibleProbability,circuitSha256',
  ...optimization.sweep.map(item => `${item.gamma},${item.beta},${item.feasibleProbability},${item.circuitSha256}`)];
fs.writeFileSync(path.join(output, 'q1-sweep.csv'), rows.join('\n') + '\n');
process.stdout.write(JSON.stringify({backend: report.backend, gridPoints: report.gridPoints,
  feasibleProbability: report.best.feasibleProbability, uniformBaseline: report.best.uniformBaseline,
  observedShots: report.selection.observedShots, validShots: report.selection.validShots,
  authorizesDispatch: report.authorizesDispatch}) + '\n');
