import crypto from 'node:crypto';
import {planRecovery, validateRecoveryDecision, assertNoRecoverySecrets} from './jev-recovery.mjs';
import {validateJevRecoveryVerificationRequest, validateJevRecoveryVerificationResult} from './jev-recovery-verifier.mjs';

export const RECOVERY_ONE_OF_CIRCUIT_VERSION = 'recovery-one-of-qaoa-openqasm3-v1';
export const RECOVERY_ONE_OF_SELECTION_VERSION = 'recovery-one-of-selection-v1';
export const RECOVERY_ONE_OF_MIN_SHOTS = 128;
export const RECOVERY_ONE_OF_MAX_SHOTS = 8192;

const CIRCUIT_FIELDS = Object.freeze([
  'version','missionId','projectId','decisionFingerprint','verificationRequestFingerprint','verificationResultFingerprint',
  'inputFingerprint','variableOrder','objectiveCosts','budgetCurrency','penalty','qubo','ising','qaoa','qubitMap',
  'classicalBitMap','entanglerLayers','gateCounts','depth','qasm','qasmSha256','classicalFallbackAlternativeId','authorizesDispatch','fingerprint',
]);
const SELECTION_FIELDS = Object.freeze([
  'version','missionId','projectId','decisionFingerprint','inputFingerprint','circuitFingerprint','circuitSha256',
  'bitOrder','requestedShots','observedShots','validShots','rejectedShots','winnerAlternativeId',
  'selectedAlternativeId','selectionSource','classicalFallbackAlternativeId','rawCounts','rawCountsFingerprint','authorizesDispatch','fingerprint',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const int = value => Number.isSafeInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const fingerprint = value => sha256(canonical(value));
const fail = (code, message = code) => { throw new RecoveryOneOfError(code, message); };

export class RecoveryOneOfError extends Error {
  constructor(code, message) { super(`Recovery QPU circuit: ${message}`); this.name = 'RecoveryOneOfError'; this.code = code; }
}

function validateParameters(parameters) {
  if (!exact(parameters, ['gamma','beta','shots']) || !finite(parameters.gamma) || parameters.gamma < 0 || parameters.gamma > 2 * Math.PI
      || !finite(parameters.beta) || parameters.beta < 0 || parameters.beta > Math.PI
      || !Number.isSafeInteger(parameters.shots) || parameters.shots < RECOVERY_ONE_OF_MIN_SHOTS || parameters.shots > RECOVERY_ONE_OF_MAX_SHOTS) {
    fail('invalid_qaoa_parameters', `gamma must be 0..2π, beta 0..π and shots ${RECOVERY_ONE_OF_MIN_SHOTS}..${RECOVERY_ONE_OF_MAX_SHOTS}.`);
  }
}

function checkedDecisionContext({request, result, decision}) {
  validateJevRecoveryVerificationRequest(request);
  validateJevRecoveryVerificationResult(result, request);
  validateRecoveryDecision(decision);
  if (decision.missionId !== request.missionId || decision.projectId !== request.projectId
      || decision.blocker.code !== request.blocker.code
      || fingerprint(decision.blocker.evidenceRefs) !== fingerprint(request.blocker.evidenceRefs)
      || !decision.assessedAt || decision.resourceSnapshot.missionId !== request.missionId
      || decision.resourceSnapshot.projectId !== request.projectId) fail('context_identity_mismatch');

  // Re-create the pre-verifier decision. This proves the stored verifier result
  // reviewed the exact source candidates the original JEV decision contained.
  const initial = planRecovery({missionId:request.missionId,projectId:request.projectId,blocker:request.blocker,
    resourceSnapshot:request.resourceSnapshot,alternatives:request.alternatives,verifierReviews:[],policy:request.policy,at:request.createdAt});
  if (initial.fingerprint !== request.initialDecisionFingerprint) fail('initial_decision_mismatch');

  // Re-create the current, post-verifier decision from the immutable request,
  // persisted review and exact resource snapshot stored with the decision.
  const policy = {...request.policy, emergencyStop:request.policy.emergencyStop
    || decision.nextStep === 'hold_until_emergency_stop_cleared'};
  const current = planRecovery({missionId:request.missionId,projectId:request.projectId,blocker:request.blocker,
    resourceSnapshot:decision.resourceSnapshot,alternatives:request.alternatives,verifierReviews:result.reviews,
    policy,at:decision.assessedAt});
  if (current.fingerprint !== decision.fingerprint) fail('decision_replay_mismatch');
  if (decision.authorizesDispatch !== false || decision.decisionStatus !== 'ready_for_review') fail('decision_not_selectable');

  const ids = decision.recommendedAlternativeIds;
  if (ids.length < 2 || ids.length > 4) fail('classical_fallback_required', 'Only 2–4 independently reviewed, policy-eligible alternatives use a QPU selector.');
  const selected = ids.map(id => request.alternatives.find(alternative => alternative.id === id));
  if (selected.some(alternative => !alternative)) fail('unknown_recommended_alternative');
  if (new Set(selected.map(alternative=>alternative.riskClass)).size!==1) {
    fail('classical_fallback_required','QPU selection is limited to alternatives with the same policy-eligible risk class.');
  }
  if (new Set(selected.map(alternative=>alternative.cost.amountMinor)).size<2) {
    fail('classical_fallback_required','The declared objective does not distinguish these alternatives; use the deterministic JEV order.');
  }
  return {policy, alternatives:selected};
}

function qaoaModel({alternatives, budgetLimitMinor}) {
  const riskRank = {low:0, moderate:1, high:2};
  const rankWeight = 1001;
  const objectiveCosts = alternatives.map(alternative => {
    const rank = riskRank[alternative.riskClass];
    const amount = alternative.cost.amountMinor;
    if (rank === undefined || !int(amount)) fail('ineligible_objective');
    const normalizedCost = budgetLimitMinor > 0 ? Math.round(amount * 1000 / budgetLimitMinor) : 0;
    if (!Number.isSafeInteger(normalizedCost) || normalizedCost < 0 || normalizedCost > 1000) fail('cost_normalization_invalid');
    return {alternativeId:alternative.id,riskRank:rank,normalizedCost,objectiveCost:rank * rankWeight + normalizedCost,
      currency:alternative.cost.currency,amountMinor:amount};
  });

  // Minimize risk rank first, then declared cost within the same risk rank.
  // JEV has already removed unsafe, unapproved, stale or unverified options.
  const penalty = Math.max(...objectiveCosts.map(item => item.objectiveCost)) + 1;
  const linear = objectiveCosts.map(item => item.objectiveCost - penalty);
  const quadratic = [];
  for (let left=0; left<linear.length; left++) for (let right=left+1; right<linear.length; right++) {
    quadratic.push({left,right,coefficient:2*penalty});
  }
  const constant = penalty;

  // x=(1-Z)/2. These coefficients implement the exact one-hot penalty QUBO
  // and its Ising equivalent. The constant contributes only global phase.
  const isingLinear = linear.map((coefficient,index) => ({index,coefficient:
    -coefficient/2 - quadratic.filter(term => term.left===index || term.right===index).reduce((sum,term) => sum+term.coefficient/4,0)}));
  const isingQuadratic = quadratic.map(term => ({left:term.left,right:term.right,coefficient:term.coefficient/4}));
  const isingConstant = constant + linear.reduce((sum,coefficient) => sum+coefficient/2,0)
    + quadratic.reduce((sum,term) => sum+term.coefficient/4,0);
  return {objectiveCosts,penalty,qubo:{constant,linear,quadratic},ising:{constant:isingConstant,linear:isingLinear,quadratic:isingQuadratic}};
}

function numberText(value) {
  if (!Number.isFinite(value)) fail('invalid_gate_angle');
  const rounded = Number(value.toPrecision(15));
  return Object.is(rounded,-0) ? '0' : String(rounded);
}

function colorEntanglers(terms) {
  const layers=[];
  for (const term of terms) {
    let layer=layers.find(candidate=>candidate.every(existing=>existing.left!==term.left&&existing.right!==term.left
      &&existing.left!==term.right&&existing.right!==term.right));
    if (!layer) { layer=[]; layers.push(layer); }
    layer.push({left:term.left,right:term.right});
  }
  return layers;
}

function openQasm3({variableOrder,ising,qaoa,entanglerLayers}) {
  const n = variableOrder.length;
  const lines = ['OPENQASM 3.0;','include "stdgates.inc";',`qubit[${n}] q;`,`bit[${n}] c;`];
  for (let i=0;i<n;i++) lines.push(`h q[${i}];`);
  lines.push('barrier q;');
  for (const term of ising.linear) lines.push(`rz(${numberText(2*qaoa.gamma*term.coefficient)}) q[${term.index}];`);
  lines.push('barrier q;');
  for (const layer of entanglerLayers) {
    // OpenQASM 3 stdgates.inc does not define rzz. Decompose
    // exp(-i θ Z⊗Z/2) as CX(left,right) · RZ(θ,right) · CX(left,right).
    for (const term of layer) lines.push(`cx q[${term.left}], q[${term.right}];`);
    lines.push('barrier q;');
    for (const term of layer) {
      const coefficient=ising.quadratic.find(item=>item.left===term.left&&item.right===term.right).coefficient;
      lines.push(`rz(${numberText(2*qaoa.gamma*coefficient)}) q[${term.right}];`);
    }
    lines.push('barrier q;');
    for (const term of layer) lines.push(`cx q[${term.left}], q[${term.right}];`);
    lines.push('barrier q;');
  }
  for (let i=0;i<n;i++) lines.push(`rx(${numberText(2*qaoa.beta)}) q[${i}];`);
  lines.push('barrier q;');
  for (let i=0;i<n;i++) lines.push(`c[${i}] = measure q[${i}];`);
  return lines.join('\n')+'\n';
}

function compileRecoveryOneOf({request,result,decision,parameters}) {
  validateParameters(parameters);
  const {alternatives} = checkedDecisionContext({request,result,decision});
  const variableOrder = decision.recommendedAlternativeIds;
  const model = qaoaModel({alternatives,budgetLimitMinor:decision.resourceSnapshot.budget.limitMinor});
  const entanglerLayers = colorEntanglers(model.ising.quadratic);
  const qaoa = {algorithm:'qaoa-p1-one-hot-penalty-v1',gamma:parameters.gamma,beta:parameters.beta,shots:parameters.shots};
  const qasm = openQasm3({variableOrder,ising:model.ising,qaoa,entanglerLayers});
  const qubitMap = variableOrder.map((alternativeId,index) => ({alternativeId,qubitIndex:index}));
  const classicalBitMap = variableOrder.map((alternativeId,index) => ({alternativeId,classicalBitIndex:index,measuresQubitIndex:index}));
  const core = {
    version:RECOVERY_ONE_OF_CIRCUIT_VERSION,missionId:decision.missionId,projectId:decision.projectId,
    decisionFingerprint:decision.fingerprint,verificationRequestFingerprint:result.requestFingerprint,
    verificationResultFingerprint:result.fingerprint,
    inputFingerprint:fingerprint({request,result,decision,parameters}),variableOrder:[...variableOrder],
    objectiveCosts:model.objectiveCosts,budgetCurrency:decision.resourceSnapshot.budget.currency,penalty:model.penalty,
    qubo:model.qubo,ising:model.ising,qaoa,qubitMap,classicalBitMap,entanglerLayers,
    gateCounts:{h:variableOrder.length,rz:variableOrder.length+model.ising.quadratic.length,cx:2*model.ising.quadratic.length,
      rx:variableOrder.length,measure:variableOrder.length},
    depth:4+3*entanglerLayers.length,qasm,qasmSha256:sha256(qasm),classicalFallbackAlternativeId:variableOrder[0],authorizesDispatch:false,
  };
  return {...core,fingerprint:fingerprint(core)};
}

export function buildRecoveryOneOfCircuit(context) {
  const circuit = compileRecoveryOneOf(context);
  validateRecoveryOneOfCircuit(circuit,context);
  return circuit;
}

export function validateRecoveryOneOfCircuit(circuit,context) {
  if (!exact(circuit,CIRCUIT_FIELDS) || circuit.version!==RECOVERY_ONE_OF_CIRCUIT_VERSION || !UUID.test(circuit.missionId)
      || !UUID.test(circuit.projectId) || !HASH.test(circuit.decisionFingerprint) || !HASH.test(circuit.verificationRequestFingerprint)
      || !HASH.test(circuit.verificationResultFingerprint) || !HASH.test(circuit.inputFingerprint) || !HASH.test(circuit.qasmSha256)
      || !HASH.test(circuit.fingerprint) || typeof circuit.qasm!=='string' || circuit.qasm.length>50000 || circuit.authorizesDispatch!==false) {
    fail('invalid_circuit_record');
  }
  const expected = compileRecoveryOneOf(context);
  if (canonical(circuit)!==canonical(expected)) fail('circuit_fingerprint_mismatch');
  assertNoRecoverySecrets(circuit,'recoveryOneOfCircuit');
  return true;
}

export function decodeRecoveryOneOfCounts({circuit,counts,bitOrder},context) {
  validateRecoveryOneOfCircuit(circuit,context);
  return selectionFromCounts({circuit,counts,bitOrder});
}

function selectionFromCounts({circuit,counts,bitOrder}) {
  if (!['c0-leftmost','c0-rightmost'].includes(bitOrder) || !Array.isArray(counts) || counts.length<1
      || counts.length>2**circuit.variableOrder.length || counts.some(entry=>!exact(entry,['bitstring','count'])
        || typeof entry.bitstring!=='string' || !new RegExp(`^[01]{${circuit.variableOrder.length}}$`).test(entry.bitstring)
        || !Number.isSafeInteger(entry.count) || entry.count<1) || new Set(counts.map(entry=>entry.bitstring)).size!==counts.length) {
    fail('invalid_qpu_counts');
  }
  const observedShots = counts.reduce((sum,item)=>sum+item.count,0);
  if (!Number.isSafeInteger(observedShots) || observedShots!==circuit.qaoa.shots) fail('shot_count_mismatch');
  const oneHot = new Map(circuit.variableOrder.map(id=>[id,0]));
  let validShots=0;
  for (const entry of counts) {
    const bits = bitOrder==='c0-leftmost'?entry.bitstring:[...entry.bitstring].reverse().join('');
    const ones=[];
    for(let i=0;i<bits.length;i++)if(bits[i]==='1')ones.push(i);
    if(ones.length!==1)continue;
    validShots+=entry.count;
    const id=circuit.classicalBitMap.find(map=>map.classicalBitIndex===ones[0])?.alternativeId;
    if(!id)fail('measurement_mapping_invalid');
    oneHot.set(id,oneHot.get(id)+entry.count);
  }
  const winnerAlternativeId = validShots===0?null:circuit.variableOrder
    .map((alternativeId,index)=>({alternativeId,index,count:oneHot.get(alternativeId)}))
    .filter(item=>item.count>0).sort((left,right)=>right.count-left.count||left.index-right.index)[0].alternativeId;
  const selectedAlternativeId = winnerAlternativeId??circuit.classicalFallbackAlternativeId;
  const selectionSource = winnerAlternativeId?'qpu_counts':'classical_fallback';
  const core = {
    version:RECOVERY_ONE_OF_SELECTION_VERSION,missionId:circuit.missionId,projectId:circuit.projectId,
    decisionFingerprint:circuit.decisionFingerprint,inputFingerprint:circuit.inputFingerprint,
    circuitFingerprint:circuit.fingerprint,circuitSha256:circuit.qasmSha256,bitOrder,requestedShots:circuit.qaoa.shots,
    observedShots,validShots,rejectedShots:observedShots-validShots,winnerAlternativeId,selectedAlternativeId,selectionSource,
    classicalFallbackAlternativeId:circuit.classicalFallbackAlternativeId,rawCounts:counts.map(entry=>({bitstring:entry.bitstring,count:entry.count})),
    rawCountsFingerprint:fingerprint({bitOrder,counts}),authorizesDispatch:false,
  };
  return {...core,fingerprint:fingerprint(core)};
}

export function validateRecoveryOneOfSelection(selection,circuit) {
  if (!exact(circuit,CIRCUIT_FIELDS) || !Array.isArray(circuit.variableOrder) || circuit.variableOrder.length<2 || circuit.variableOrder.length>4
      || !exact(circuit.qaoa,['algorithm','gamma','beta','shots']) || circuit.qaoa.algorithm!=='qaoa-p1-one-hot-penalty-v1'
      || !Array.isArray(circuit.classicalBitMap) || !Array.isArray(circuit.qubitMap) || typeof circuit.qasm!=='string'
      || sha256(circuit.qasm)!==circuit.qasmSha256
      || !HASH.test(circuit.fingerprint) || circuit.authorizesDispatch!==false) fail('invalid_circuit_reference');
  validateParameters({gamma:circuit.qaoa.gamma,beta:circuit.qaoa.beta,shots:circuit.qaoa.shots});
  const {fingerprint:suppliedCircuitFingerprint,...circuitCore}=circuit;
  if (fingerprint(circuitCore)!==suppliedCircuitFingerprint) fail('circuit_fingerprint_mismatch');
  if (!exact(selection,SELECTION_FIELDS) || selection.version!==RECOVERY_ONE_OF_SELECTION_VERSION || selection.missionId!==circuit.missionId
      || selection.projectId!==circuit.projectId || selection.decisionFingerprint!==circuit.decisionFingerprint
      || selection.inputFingerprint!==circuit.inputFingerprint || selection.circuitFingerprint!==circuit.fingerprint
      || selection.circuitSha256!==circuit.qasmSha256 || !['c0-leftmost','c0-rightmost'].includes(selection.bitOrder)
      || !Number.isSafeInteger(selection.requestedShots) || selection.requestedShots!==circuit.qaoa.shots
      || !int(selection.observedShots) || selection.observedShots!==selection.requestedShots || !int(selection.validShots)
      || selection.validShots>selection.observedShots || selection.rejectedShots!==selection.observedShots-selection.validShots
      || !(selection.winnerAlternativeId===null||circuit.variableOrder.includes(selection.winnerAlternativeId))
      || !circuit.variableOrder.includes(selection.selectedAlternativeId)
      || !['qpu_counts','classical_fallback'].includes(selection.selectionSource)
      || (selection.selectionSource==='qpu_counts'&&(!selection.winnerAlternativeId||selection.selectedAlternativeId!==selection.winnerAlternativeId||selection.validShots===0))
      || (selection.selectionSource==='classical_fallback'&&(selection.winnerAlternativeId!==null||selection.validShots!==0||selection.selectedAlternativeId!==circuit.classicalFallbackAlternativeId))
      || selection.classicalFallbackAlternativeId!==circuit.classicalFallbackAlternativeId || !HASH.test(selection.rawCountsFingerprint)
      || !HASH.test(selection.fingerprint) || selection.authorizesDispatch!==false) fail('invalid_selection_record');
  const expected=selectionFromCounts({circuit,counts:selection.rawCounts,bitOrder:selection.bitOrder});
  if(canonical(selection)!==canonical(expected))fail('selection_fingerprint_mismatch');
  return true;
}
